import { randomUUID } from "node:crypto";

import { AgentLoop } from "./agent-loop.js";
import type {
  Agent,
  AgentEvent,
  AgentOrchestratorOptions,
  AgentTaskSnapshot,
  AgentTreeEvent,
  AgentTreeSnapshot,
  AgentTreeUpdateReason,
  RunController,
  RunControllerContext,
  RunControllerModelDirective,
  RunControllerToolDecision,
  RunOptions,
  RunResult,
  SubagentProfile,
  Tool,
  ToolCall,
  ToolResult,
} from "./types.js";

const SPAWN_AGENT_TOOL = "spawn_agent";
const WAIT_FOR_AGENTS_TOOL = "wait_for_agents";
const MAX_PERSISTED_OUTPUT = 20_000;
const MAX_TRANSCRIPT_FIELD = 20_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface AgentTaskRecord {
  snapshot: AgentTaskSnapshot;
  profile?: SubagentProfile;
  controller: AbortController;
  completion: Deferred<AgentTaskSnapshot>;
  pendingInput: string[];
  collected: boolean;
}

/**
 * A single provider-neutral multi-agent run.
 *
 * The orchestrator owns scheduling and lifecycle semantics. Providers still
 * receive ordinary independent AgentLoop requests and keep their opaque state
 * scoped to each run.
 */
export class AgentOrchestrator {
  private readonly profiles = new Map<string, SubagentProfile>();
  private readonly records = new Map<string, AgentTaskRecord>();
  private readonly queue: string[] = [];
  private readonly running = new Set<string>();
  private readonly childPromises = new Set<Promise<void>>();
  private readonly rootId = randomUUID();
  private readonly maxConcurrent: number;
  private readonly maxAgents: number;
  private readonly wallNow: () => Date;
  private rootSignal?: AbortSignal;
  private rootAgent?: Agent;
  private closed = false;

  constructor(
    private readonly loop: AgentLoop,
    private readonly options: AgentOrchestratorOptions,
  ) {
    if (options.profiles.length === 0) {
      throw new Error(
        "AgentOrchestrator requires at least one subagent profile",
      );
    }
    for (const profile of options.profiles) {
      if (!profile.name.trim())
        throw new Error("Subagent profile name is required");
      if (this.profiles.has(profile.name)) {
        throw new Error(`Duplicate subagent profile: ${profile.name}`);
      }
      this.profiles.set(profile.name, profile);
    }
    this.maxConcurrent = positiveInteger(options.maxConcurrent, 3);
    this.maxAgents = positiveInteger(options.maxAgents, 8);
    this.wallNow = options.wallNow ?? (() => new Date());
  }

  get snapshot(): AgentTreeSnapshot {
    return {
      rootId: this.rootId,
      maxConcurrent: this.maxConcurrent,
      agents: [...this.records.values()].map(({ snapshot }) =>
        cloneSnapshot(snapshot),
      ),
    };
  }

  async run(rootAgent: Agent, input: string): Promise<RunResult> {
    if (this.rootAgent) throw new Error("AgentOrchestrator can only run once");
    this.rootAgent = rootAgent;
    this.rootSignal = this.options.signal;
    const root = this.createRootRecord(rootAgent, input);
    const tools = [
      ...(rootAgent.tools ?? []),
      this.spawnTool(),
      this.waitTool(),
    ];
    assertUniqueToolNames(tools);
    const orchestratedAgent: Agent = {
      ...rootAgent,
      instructions: `${rootAgent.instructions}\n\n${delegationInstructions(
        [...this.profiles.values()],
        this.maxConcurrent,
      )}`,
      tools,
    };
    const controller = new OrchestrationRunController(
      this,
      this.options.controller,
    );

    try {
      const result = await this.loop.run(orchestratedAgent, input, {
        ...rootRunOptions(this.options),
        controller,
        onEvent: (event) => {
          this.updateFromAgentEvent(root, event);
          this.options.onEvent?.(event);
        },
      });
      this.completeRecord(root, result);
      this.closed = true;
      return {
        ...result,
        usage: this.childRecords().reduce(
          (usage, { snapshot }) => addUsage(usage, snapshot.usage),
          { ...result.usage },
        ),
      };
    } catch (error) {
      this.failRecord(root, error);
      throw error;
    } finally {
      this.closed = true;
      this.cancelRemaining("Parent agent stopped");
      await Promise.allSettled([...this.childPromises]);
    }
  }

  cancel(agentId: string): boolean {
    const record = this.records.get(agentId);
    if (
      !record ||
      agentId === this.rootId ||
      isTerminal(record.snapshot.status)
    ) {
      return false;
    }
    record.controller.abort(new Error("Agent stopped by user"));
    if (record.snapshot.status === "queued") {
      this.removeFromQueue(agentId);
    }
    this.cancelRecord(record, "Stopped by user");
    this.pump();
    return true;
  }

  steer(agentId: string, input: string): boolean {
    const instruction = input.trim();
    const record = this.records.get(agentId);
    if (
      !instruction ||
      !record ||
      agentId === this.rootId ||
      isTerminal(record.snapshot.status)
    ) {
      return false;
    }
    record.pendingInput.push(instruction);
    this.patchRecord(record, "steered", {
      latestActivity: "Direction updated",
    });
    return true;
  }

  retry(agentId: string): AgentTaskSnapshot | undefined {
    const previous = this.records.get(agentId);
    if (
      this.closed ||
      !previous?.profile ||
      !isTerminal(previous.snapshot.status)
    ) {
      return;
    }
    return this.spawn(previous.profile.name, previous.snapshot.task, agentId);
  }

  hasActiveWriter(): boolean {
    return [...this.running].some((id) => {
      const profile = this.records.get(id)?.profile;
      return profile?.toolAccess === "all";
    });
  }

  completionBlocker(): string | undefined {
    const children = this.childRecords();
    const active = children.filter(
      ({ snapshot }) => !isTerminal(snapshot.status),
    );
    if (active.length > 0) {
      return `Subagents are still active (${active
        .map(({ snapshot }) => snapshot.name)
        .join(", ")}). Call ${WAIT_FOR_AGENTS_TOOL} before finishing.`;
    }
    const uncollected = children.filter(({ collected }) => !collected);
    if (uncollected.length > 0) {
      return `Subagent results have not been collected (${uncollected
        .map(({ snapshot }) => snapshot.name)
        .join(
          ", ",
        )}). Call ${WAIT_FOR_AGENTS_TOOL} and use their findings before finishing.`;
    }
  }

  rootWriteDecision(
    call: ToolCall,
    tool: Tool | undefined,
  ): RunControllerToolDecision | undefined {
    if (
      call.name === SPAWN_AGENT_TOOL ||
      call.name === WAIT_FOR_AGENTS_TOOL ||
      !this.hasActiveWriter() ||
      tool?.mutability === "read"
    ) {
      return;
    }
    return {
      allowed: false,
      message:
        "A write-capable subagent currently owns the workspace. Wait for it to finish before running another write-capable tool.",
    };
  }

  syncRootTools(contextTools: readonly Tool[]): void {
    const source = this.rootAgent?.tools ?? [];
    const target = contextTools as Tool[];
    const names = new Set(target.map(({ name }) => name));
    for (const tool of source) {
      if (names.has(tool.name)) continue;
      target.push(tool);
      names.add(tool.name);
    }
  }

  private createRootRecord(agent: Agent, task: string): AgentTaskRecord {
    const now = this.wallNow().toISOString();
    const record = this.createRecord({
      id: this.rootId,
      name: agent.name,
      role: "root",
      task,
      status: "running",
      phase: "thinking",
      createdAt: now,
      startedAt: now,
      elapsedMs: 0,
      latestActivity: "Planning",
      activities: [],
      transcript: [],
    });
    this.emit(record, "created");
    return record;
  }

  private spawn(
    profileName: string,
    task: string,
    retryOf?: string,
  ): AgentTaskSnapshot {
    if (this.closed) throw new Error("The multi-agent run has ended");
    if (this.childRecords().length >= this.maxAgents) {
      throw new Error(`Subagent limit reached (${this.maxAgents})`);
    }
    const profile = this.profiles.get(profileName);
    if (!profile) throw new Error(`Unknown subagent profile: ${profileName}`);
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error("Subagent task is required");
    const id = randomUUID();
    const record = this.createRecord(
      {
        id,
        parentId: this.rootId,
        ...(retryOf ? { retryOf } : {}),
        name: profile.name,
        role: profile.name,
        task: normalizedTask,
        status: "queued",
        phase: "queued",
        createdAt: this.wallNow().toISOString(),
        elapsedMs: 0,
        latestActivity: "Queued",
        activities: [],
        transcript: [],
      },
      profile,
    );
    this.queue.push(id);
    this.emit(record, "created");
    this.pump();
    return cloneSnapshot(record.snapshot);
  }

  private pump(): void {
    while (this.running.size < this.maxConcurrent) {
      const index = this.nextRunnableIndex();
      if (index < 0) return;
      const [id] = this.queue.splice(index, 1);
      const record = id ? this.records.get(id) : undefined;
      if (!record || record.snapshot.status !== "queued") continue;
      this.startChild(record);
    }
  }

  private nextRunnableIndex(): number {
    const writerActive = this.hasActiveWriter();
    return this.queue.findIndex((id) => {
      const profile = this.records.get(id)?.profile;
      return profile && (profile.toolAccess !== "all" || !writerActive);
    });
  }

  private startChild(record: AgentTaskRecord): void {
    const profile = record.profile;
    const rootAgent = this.rootAgent;
    if (!profile || !rootAgent) return;
    this.running.add(record.snapshot.id);
    const startedAt = this.wallNow().toISOString();
    this.patchRecord(record, "started", {
      status: "running",
      phase: "thinking",
      startedAt,
      latestActivity: "Thinking",
    });
    const childOptions = this.options.createChildRunOptions?.({
      agentId: record.snapshot.id,
      parentId: this.rootId,
      profile,
    });
    const signal = combineSignals(this.rootSignal, record.controller.signal);
    const childAgent: Agent = {
      name: profile.name,
      instructions: [
        rootAgent.instructions,
        "SUBAGENT ROLE",
        profile.instructions,
        "Work only on the delegated task. Do not ask the user questions. Return a concise result with concrete evidence for the parent agent.",
      ].join("\n\n"),
      model: profile.model ?? rootAgent.model,
      provider: profile.provider ?? rootAgent.provider,
      tools: childTools(rootAgent.tools ?? [], profile),
      maxSteps: profile.maxSteps ?? rootAgent.maxSteps,
    };
    const promise = this.loop
      .run(childAgent, record.snapshot.task, {
        ...childOptions,
        signal,
        takeAdditionalInput: () => record.pendingInput.shift(),
        onEvent: (event) => this.updateFromAgentEvent(record, event),
      })
      .then((result) => this.completeRecord(record, result))
      .catch((error: unknown) => {
        if (record.controller.signal.aborted || this.rootSignal?.aborted) {
          this.cancelRecord(record, errorMessage(error));
        } else {
          this.failRecord(record, error);
        }
      })
      .finally(() => {
        this.running.delete(record.snapshot.id);
        this.childPromises.delete(promise);
        this.pump();
      });
    this.childPromises.add(promise);
  }

  private updateFromAgentEvent(
    record: AgentTaskRecord,
    event: AgentEvent,
  ): void {
    if (isTerminal(record.snapshot.status)) return;
    if (event.type === "run.started") {
      this.patchRecord(record, "progress", { runId: event.runId });
      return;
    }
    if (event.type === "model.started") {
      const id = modelTranscriptId(event.step);
      const transcript = record.snapshot.transcript.some(
        (entry) => entry.id === id,
      )
        ? record.snapshot.transcript
        : [
            ...record.snapshot.transcript,
            {
              id,
              kind: "model" as const,
              step: event.step,
              status: "running" as const,
              text: "",
              startedAt: this.wallNow().toISOString(),
            },
          ];
      this.patchRecord(record, "progress", {
        phase: "thinking",
        latestActivity: "Thinking",
        transcript,
      });
      return;
    }
    if (event.type === "model.output_text.delta") {
      const id = modelTranscriptId(event.step);
      const transcript = updateTranscript(
        record.snapshot.transcript,
        id,
        (entry) =>
          entry.kind === "model"
            ? {
                ...entry,
                text: truncate(
                  `${entry.text}${event.delta}`,
                  MAX_TRANSCRIPT_FIELD,
                ),
                ...(event.outputVisibility
                  ? { outputVisibility: event.outputVisibility }
                  : {}),
              }
            : entry,
      );
      this.patchRecord(record, "progress", {
        phase: "thinking",
        latestActivity: "Thinking",
        transcript,
      });
      return;
    }
    if (event.type === "model.completed") {
      const id = modelTranscriptId(event.step);
      const completedAt = this.wallNow().toISOString();
      const transcript = updateTranscript(
        ensureModelTranscript(
          record.snapshot.transcript,
          event.step,
          completedAt,
        ),
        id,
        (entry) =>
          entry.kind === "model"
            ? {
                ...entry,
                status: "completed" as const,
                text: truncate(event.text, MAX_TRANSCRIPT_FIELD),
                completedAt,
                ...(event.durationMs === undefined
                  ? {}
                  : { durationMs: event.durationMs }),
                ...(event.outputVisibility
                  ? { outputVisibility: event.outputVisibility }
                  : {}),
              }
            : entry,
      );
      this.patchRecord(record, "progress", {
        phase: event.toolCalls.length > 0 ? "working" : "thinking",
        latestActivity:
          event.toolCalls.length > 0 ? "Preparing tools" : "Responding",
        transcript,
      });
      return;
    }
    if (event.type === "tool.started") {
      const activities = [
        ...record.snapshot.activities,
        {
          id: event.call.id,
          name: event.call.name,
          status: "running" as const,
        },
      ];
      const transcript = [
        ...record.snapshot.transcript,
        {
          id: event.call.id,
          kind: "tool" as const,
          name: event.call.name,
          status: "running" as const,
          arguments: truncate(
            serializeTranscriptValue(event.call.arguments),
            MAX_TRANSCRIPT_FIELD,
          ),
          startedAt: this.wallNow().toISOString(),
        },
      ];
      this.patchRecord(record, "progress", {
        phase: "working",
        latestActivity: event.call.name,
        activities,
        transcript,
      });
      return;
    }
    if (event.type === "tool.completed") {
      const activities = record.snapshot.activities.map((activity) =>
        activity.id === event.result.callId
          ? {
              ...activity,
              status: event.result.isError
                ? ("failed" as const)
                : ("completed" as const),
              ...(event.durationMs === undefined
                ? {}
                : { durationMs: event.durationMs }),
            }
          : activity,
      );
      const completedAt = this.wallNow().toISOString();
      const transcript = updateTranscript(
        record.snapshot.transcript,
        event.result.callId,
        (entry) =>
          entry.kind === "tool"
            ? {
                ...entry,
                status: event.result.isError
                  ? ("failed" as const)
                  : ("completed" as const),
                output: truncate(event.result.output, MAX_TRANSCRIPT_FIELD),
                ...(event.result.isError ? { isError: true } : {}),
                completedAt,
                ...(event.durationMs === undefined
                  ? {}
                  : { durationMs: event.durationMs }),
              }
            : entry,
      );
      this.patchRecord(record, "progress", {
        phase: "thinking",
        latestActivity: event.result.name,
        activities,
        transcript,
      });
    }
  }

  private completeRecord(record: AgentTaskRecord, result: RunResult): void {
    if (isTerminal(record.snapshot.status)) return;
    const output = truncate(result.output, MAX_PERSISTED_OUTPUT);
    this.patchRecord(record, "completed", {
      status: "completed",
      phase: "done",
      completedAt: this.wallNow().toISOString(),
      elapsedMs: result.durationMs,
      latestActivity: "Completed",
      summary: summarize(output),
      output,
      steps: result.steps,
      usage: { ...result.usage },
    });
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  private failRecord(record: AgentTaskRecord, error: unknown): void {
    if (isTerminal(record.snapshot.status)) return;
    const message = errorMessage(error);
    this.patchRecord(record, "failed", {
      status: "failed",
      phase: "done",
      completedAt: this.wallNow().toISOString(),
      latestActivity: "Failed",
      error: message,
      summary: message,
    });
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  private cancelRecord(record: AgentTaskRecord, reason: string): void {
    if (isTerminal(record.snapshot.status)) return;
    this.patchRecord(record, "cancelled", {
      status: "cancelled",
      phase: "done",
      completedAt: this.wallNow().toISOString(),
      latestActivity: "Stopped",
      error: reason,
      summary: reason,
    });
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  private patchRecord(
    record: AgentTaskRecord,
    reason: AgentTreeUpdateReason,
    patch: Partial<AgentTaskSnapshot>,
  ): void {
    record.snapshot = {
      ...record.snapshot,
      ...patch,
      elapsedMs:
        patch.elapsedMs ??
        elapsedSince(record.snapshot.startedAt, this.wallNow()),
    };
    this.emit(record, reason);
  }

  private createRecord(
    snapshot: AgentTaskSnapshot,
    profile?: SubagentProfile,
  ): AgentTaskRecord {
    const record: AgentTaskRecord = {
      snapshot,
      profile,
      controller: new AbortController(),
      completion: deferred<AgentTaskSnapshot>(),
      pendingInput: [],
      collected: false,
    };
    this.records.set(snapshot.id, record);
    return record;
  }

  private emit(record: AgentTaskRecord, reason: AgentTreeUpdateReason): void {
    const event: AgentTreeEvent = {
      type: "agent.tree.updated",
      changedAgentId: record.snapshot.id,
      reason,
      tree: this.snapshot,
    };
    this.options.onAgentTreeEvent?.(event);
  }

  private spawnTool(): Tool {
    return {
      name: SPAWN_AGENT_TOOL,
      description:
        "Start an independent subagent task. Returns immediately so multiple tasks can run concurrently.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            enum: [...this.profiles.keys()],
            description: "Configured subagent role",
          },
          task: {
            type: "string",
            minLength: 1,
            description: "Self-contained delegated task and expected result",
          },
        },
        required: ["role", "task"],
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        return this.spawn(
          stringArgument(values.role, "role"),
          stringArgument(values.task, "task"),
        );
      },
    };
  }

  private waitTool(): Tool {
    return {
      name: WAIT_FOR_AGENTS_TOOL,
      description:
        "Wait for selected subagents (or all subagents) and collect their results before synthesizing the final answer.",
      parameters: {
        type: "object",
        properties: {
          agentIds: {
            type: "array",
            items: { type: "string" },
            description: "Subagent IDs to wait for; omit to wait for all",
          },
        },
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_, context) => {
        const values = objectArguments(arguments_);
        const requested = Array.isArray(values.agentIds)
          ? values.agentIds.map((id) => stringArgument(id, "agentIds"))
          : this.childRecords().map(({ snapshot }) => snapshot.id);
        const records = requested.map((id) => {
          const record = this.records.get(id);
          if (!record || record.snapshot.parentId !== this.rootId) {
            throw new Error(`Unknown subagent: ${id}`);
          }
          return record;
        });
        for (const record of records) {
          if (!isTerminal(record.snapshot.status)) {
            this.patchRecord(record, "progress", {
              phase: record.snapshot.phase,
            });
          }
        }
        const results = await abortable(
          Promise.all(records.map(({ completion }) => completion.promise)),
          context.signal,
        );
        for (const record of records) record.collected = true;
        return {
          agents: results.map((result) => ({
            id: result.id,
            role: result.role,
            status: result.status,
            ...(result.output ? { output: result.output } : {}),
            ...(result.error ? { error: result.error } : {}),
          })),
        };
      },
    };
  }

  private childRecords(): AgentTaskRecord[] {
    return [...this.records.values()].filter(
      ({ snapshot }) => snapshot.parentId === this.rootId,
    );
  }

  private cancelRemaining(reason: string): void {
    for (const record of this.childRecords()) {
      if (isTerminal(record.snapshot.status)) continue;
      record.controller.abort(new Error(reason));
      if (record.snapshot.status === "queued") {
        this.removeFromQueue(record.snapshot.id);
        this.cancelRecord(record, reason);
      }
    }
  }

  private removeFromQueue(agentId: string): void {
    const index = this.queue.indexOf(agentId);
    if (index >= 0) this.queue.splice(index, 1);
  }
}

class OrchestrationRunController implements RunController {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly delegate?: RunController,
  ) {}

  beforeModel(
    context: RunControllerContext,
  ): Promise<RunControllerModelDirective> {
    return Promise.resolve(this.delegate?.beforeModel?.(context) ?? {}).then(
      (directive) => {
        this.orchestrator.syncRootTools(context.tools);
        return directive;
      },
    );
  }

  async beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): Promise<RunControllerToolDecision> {
    const ownership = this.orchestrator.rootWriteDecision(call, tool);
    if (ownership) return ownership;
    return (
      (await this.delegate?.beforeToolCall?.(call, tool, context)) ?? {
        allowed: true,
      }
    );
  }

  afterToolCall(
    call: ToolCall,
    result: ToolResult,
    context: RunControllerContext,
  ): void | Promise<void> {
    return this.delegate?.afterToolCall?.(call, result, context);
  }

  async validateCompletion(
    turn: { text: string },
    context: RunControllerContext,
  ): Promise<string | undefined> {
    const delegated = await this.delegate?.validateCompletion?.(turn, context);
    return delegated ?? this.orchestrator.completionBlocker();
  }

  resolveCompletionOutput(
    turn: { text: string },
    context: RunControllerContext,
  ): string | undefined | Promise<string | undefined> {
    return this.delegate?.resolveCompletionOutput?.(turn, context);
  }
}

function rootRunOptions(options: AgentOrchestratorOptions): RunOptions {
  const {
    profiles: _profiles,
    maxConcurrent: _maxConcurrent,
    maxAgents: _maxAgents,
    wallNow: _wallNow,
    onAgentTreeEvent: _onAgentTreeEvent,
    createChildRunOptions: _createChildRunOptions,
    controller: _controller,
    onEvent: _onEvent,
    ...runOptions
  } = options;
  return runOptions;
}

function childTools(
  tools: readonly Tool[],
  profile: SubagentProfile,
): readonly Tool[] {
  const excluded = new Set([
    SPAWN_AGENT_TOOL,
    WAIT_FOR_AGENTS_TOOL,
    ...(profile.excludedTools ?? []),
  ]);
  return tools.filter(
    (tool) =>
      !excluded.has(tool.name) &&
      (profile.toolAccess === "all" || tool.mutability === "read"),
  );
}

function delegationInstructions(
  profiles: readonly SubagentProfile[],
  maxConcurrent: number,
): string {
  return [
    "MULTI-AGENT DELEGATION",
    "Delegate only concrete, independent work that benefits from parallel execution or focused context. Keep small sequential work in the parent agent.",
    `At most ${maxConcurrent} subagents run concurrently. Start independent tasks with spawn_agent, continue useful parent work, then call wait_for_agents before using their findings or finishing.`,
    "Do not duplicate the same task across agents. Give each task enough context to be completed without asking the user.",
    "A write-capable subagent has exclusive workspace write ownership while active. The parent may continue read-only work and must wait before writing.",
    "Available roles:",
    ...profiles.map(
      (profile) =>
        `- ${profile.name} (${profile.toolAccess === "all" ? "write-capable" : "read-only"}): ${profile.description}`,
    ),
  ].join("\n");
}

function cloneSnapshot(snapshot: AgentTaskSnapshot): AgentTaskSnapshot {
  return {
    ...snapshot,
    ...(snapshot.usage ? { usage: { ...snapshot.usage } } : {}),
    activities: snapshot.activities.map((activity) => ({ ...activity })),
    transcript: snapshot.transcript.map((entry) => ({ ...entry })),
  };
}

function modelTranscriptId(step: number): string {
  return `model:${step}`;
}

function ensureModelTranscript(
  transcript: AgentTaskSnapshot["transcript"],
  step: number,
  startedAt: string,
): AgentTaskSnapshot["transcript"] {
  const id = modelTranscriptId(step);
  return transcript.some((entry) => entry.id === id)
    ? transcript
    : [
        ...transcript,
        {
          id,
          kind: "model",
          step,
          status: "running",
          text: "",
          startedAt,
        },
      ];
}

function updateTranscript(
  transcript: AgentTaskSnapshot["transcript"],
  id: string,
  update: (
    entry: AgentTaskSnapshot["transcript"][number],
  ) => AgentTaskSnapshot["transcript"][number],
): AgentTaskSnapshot["transcript"] {
  return transcript.map((entry) => (entry.id === id ? update(entry) : entry));
}

function serializeTranscriptValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function isTerminal(status: AgentTaskSnapshot["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(1, Math.floor(value));
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function combineSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): AbortSignal {
  return first ? AbortSignal.any([first, second]) : second;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function elapsedSince(startedAt: string | undefined, now: Date): number {
  if (!startedAt) return 0;
  return Math.max(0, now.getTime() - Date.parse(startedAt));
}

function objectArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function stringArgument(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function summarize(output: string): string {
  return truncate(output.replace(/\s+/g, " ").trim(), 240);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addUsage(
  total: RunResult["usage"],
  next: RunResult["usage"] | undefined,
): RunResult["usage"] {
  return {
    inputTokens: total.inputTokens + (next?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (next?.outputTokens ?? 0),
    totalTokens: total.totalTokens + (next?.totalTokens ?? 0),
  };
}

function assertUniqueToolNames(tools: readonly Tool[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name))
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    names.add(tool.name);
  }
}
