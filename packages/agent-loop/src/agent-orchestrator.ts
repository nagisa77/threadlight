import { randomUUID } from "node:crypto";

import { AgentLoop } from "./agent-loop.js";
import type {
  Agent,
  AgentEvent,
  AgentOrchestratorOptions,
  AgentRunCheckpoint,
  AgentRuntimeSnapshot,
  AgentTaskSnapshot,
  AgentTreeEvent,
  AgentTreeSnapshot,
  AgentTreeUpdateReason,
  ModelConversationMessage,
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
  TokenUsage,
} from "./types.js";

const SPAWN_AGENT_TOOL = "spawn_agent";
const FOLLOW_UP_AGENT_TOOL = "follow_up_agent";
const RETRY_AGENT_TOOL = "retry_agent";
const CHECK_AGENTS_TOOL = "check_agents";
const WAIT_FOR_AGENTS_TOOL = "wait_for_agents";
const STEER_AGENT_TOOL = "steer_agent";
const INTERRUPT_AGENT_TOOL = "interrupt_agent";
const CLOSE_AGENT_TOOL = "close_agent";
const COLLABORATION_TOOLS = new Set([
  SPAWN_AGENT_TOOL,
  FOLLOW_UP_AGENT_TOOL,
  RETRY_AGENT_TOOL,
  CHECK_AGENTS_TOOL,
  WAIT_FOR_AGENTS_TOOL,
  STEER_AGENT_TOOL,
  INTERRUPT_AGENT_TOOL,
  CLOSE_AGENT_TOOL,
]);
const MAX_PERSISTED_OUTPUT = 20_000;
const MAX_TRANSCRIPT_FIELD = 20_000;
const DEFAULT_AGENT_WAIT_TIMEOUT_MS = 30_000;
const MAX_AGENT_WAIT_TIMEOUT_MS = 300_000;
const MAILBOX_UPDATE_REASONS = new Set<AgentTreeUpdateReason>([
  "created",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "followed_up",
  "closed",
  "steered",
]);

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
  modelState?: unknown;
  checkpointStep?: number;
  checkpointPhase?: AgentRunCheckpoint["phase"];
  execution?: Promise<void>;
  history?: readonly ModelConversationMessage[];
}

interface SpawnOptions {
  retryOf?: string;
  followUpOf?: string;
  agentThreadId?: string;
  modelState?: unknown;
  history?: readonly ModelConversationMessage[];
}

interface AgentMailboxEvent {
  agentId: string;
  agentThreadId: string;
  reason: AgentTreeUpdateReason;
}

interface AgentMailboxWaiter {
  threadIds: ReadonlySet<string>;
  resolve(event: AgentMailboxEvent): void;
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
  private readonly mailboxWaiters = new Set<AgentMailboxWaiter>();
  private readonly rootId = randomUUID();
  private readonly maxConcurrent: number;
  private readonly maxAgents: number;
  private readonly wallNow: () => Date;
  private rootSignal?: AbortSignal;
  private rootAgent?: Agent;
  private closed = false;
  private runtimeCheckpointWrites: Promise<void> = Promise.resolve();

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

  get runtimeSnapshot(): AgentRuntimeSnapshot {
    return {
      version: 1,
      rootId: this.rootId,
      maxConcurrent: this.maxConcurrent,
      updatedAt: this.wallNow().toISOString(),
      agents: [...this.records.values()].map((record) => ({
        task: cloneSnapshot(record.snapshot),
        ...(record.profile ? { profileName: record.profile.name } : {}),
        pendingInput: [...record.pendingInput],
        collected: record.collected,
        ...(record.modelState === undefined
          ? {}
          : { modelState: record.modelState }),
        ...(record.checkpointStep === undefined
          ? {}
          : { checkpointStep: record.checkpointStep }),
        ...(record.checkpointPhase === undefined
          ? {}
          : { checkpointPhase: record.checkpointPhase }),
      })),
    };
  }

  async run(rootAgent: Agent, input: string): Promise<RunResult> {
    if (this.rootAgent) throw new Error("AgentOrchestrator can only run once");
    this.rootAgent = rootAgent;
    this.rootSignal = this.options.signal;
    const root = this.createRootRecord(rootAgent, input);
    await this.flushRuntimeCheckpoints();
    const tools = [
      ...(rootAgent.tools ?? []),
      this.spawnTool(),
      this.followUpTool(),
      this.retryTool(),
      this.checkTool(),
      this.waitTool(),
      this.steerTool(),
      this.interruptTool(),
      this.closeTool(),
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
      const runOptions = rootRunOptions(this.options);
      const result = await this.loop.run(orchestratedAgent, input, {
        ...runOptions,
        controller,
        onCheckpoint: async (checkpoint) => {
          this.recordCheckpoint(root, checkpoint);
          await runOptions.onCheckpoint?.(checkpoint);
          await this.flushRuntimeCheckpoints();
        },
        onEvent: (event) => {
          this.updateFromAgentEvent(root, event);
          this.options.onEvent?.(event);
        },
      });
      this.completeRecord(root, result);
      this.closed = true;
      await this.flushRuntimeCheckpoints();
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
      await this.flushRuntimeCheckpoints();
    }
  }

  flushRuntimeCheckpoints(): Promise<void> {
    return this.runtimeCheckpointWrites;
  }

  cancel(agentId: string): boolean {
    const record = this.currentChildRecord(agentId);
    if (
      !record ||
      record.snapshot.closedAt !== undefined ||
      isTerminal(record.snapshot.status)
    ) {
      return false;
    }
    record.controller.abort(new Error("Agent stopped by user"));
    if (record.snapshot.status === "queued") {
      this.removeFromQueue(record.snapshot.id);
    }
    this.detachChildExecution(record);
    this.cancelRecord(record, "Stopped by user");
    this.scheduleRuntimeCheckpoint();
    this.pump();
    return true;
  }

  steer(agentId: string, input: string): boolean {
    const instruction = input.trim();
    const record = this.currentChildRecord(agentId);
    if (
      !instruction ||
      !record ||
      record.snapshot.closedAt !== undefined ||
      isTerminal(record.snapshot.status)
    ) {
      return false;
    }
    record.pendingInput.push(instruction);
    this.patchRecord(record, "steered", {
      latestActivity: "Direction updated",
    });
    this.scheduleRuntimeCheckpoint();
    return true;
  }

  retry(agentId: string): AgentTaskSnapshot | undefined {
    const direct = this.records.get(agentId);
    const previous =
      direct?.snapshot.parentId === this.rootId
        ? direct
        : this.currentChildRecord(agentId);
    if (
      this.closed ||
      !previous?.profile ||
      previous.snapshot.closedAt !== undefined ||
      this.threadHasActiveRun(previous) ||
      !isTerminal(previous.snapshot.status)
    ) {
      return;
    }
    return this.spawn(previous.profile.name, previous.snapshot.task, {
      retryOf: previous.snapshot.id,
      agentThreadId: agentThreadId(previous),
    });
  }

  followUp(agentId: string, input: string): AgentTaskSnapshot | undefined {
    const instruction = input.trim();
    const previous = this.currentChildRecord(agentId);
    if (
      this.closed ||
      !instruction ||
      !previous?.profile ||
      previous.snapshot.closedAt !== undefined ||
      this.threadHasActiveRun(previous) ||
      !isTerminal(previous.snapshot.status)
    ) {
      return;
    }
    return this.spawn(previous.profile.name, instruction, {
      followUpOf: previous.snapshot.id,
      agentThreadId: agentThreadId(previous),
      modelState: previous.modelState,
      history: this.childThreadHistory(previous),
    });
  }

  interrupt(agentId: string): boolean {
    const record = this.currentChildRecord(agentId);
    if (
      !record ||
      record.snapshot.closedAt !== undefined ||
      isTerminal(record.snapshot.status)
    ) {
      return false;
    }
    record.controller.abort(new Error("Agent interrupted by parent"));
    if (record.snapshot.status === "queued") {
      this.removeFromQueue(record.snapshot.id);
    }
    this.detachChildExecution(record);
    this.interruptRecord(record, "Interrupted by parent agent");
    this.pump();
    return true;
  }

  close(agentId: string): boolean {
    const records = this.childThreadRecords(agentId);
    if (
      records.length === 0 ||
      records.every(({ snapshot }) => snapshot.closedAt)
    ) {
      return false;
    }
    const closedAt = this.wallNow().toISOString();
    for (const record of records) {
      record.collected = true;
      if (!isTerminal(record.snapshot.status)) {
        record.controller.abort(new Error("Agent thread closed by parent"));
        if (record.snapshot.status === "queued") {
          this.removeFromQueue(record.snapshot.id);
        }
        this.detachChildExecution(record);
        this.cancelRecord(record, "Closed by parent agent");
      }
      this.patchRecord(record, "closed", {
        closedAt,
        latestActivity: "Closed",
      });
    }
    this.scheduleRuntimeCheckpoint();
    this.pump();
    return true;
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
    const uncollected = children.filter(
      ({ collected, snapshot }) => !collected && !snapshot.closedAt,
    );
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
      COLLABORATION_TOOLS.has(call.name) ||
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
      agentThreadId: this.rootId,
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
    this.scheduleRuntimeCheckpoint();
    return record;
  }

  private spawn(
    profileName: string,
    task: string,
    options: SpawnOptions = {},
  ): AgentTaskSnapshot {
    if (this.closed) throw new Error("The multi-agent run has ended");
    if (
      !options.agentThreadId &&
      this.openAgentThreadCount() >= this.maxAgents
    ) {
      throw new Error(`Subagent limit reached (${this.maxAgents})`);
    }
    const profile = this.profiles.get(profileName);
    if (!profile) throw new Error(`Unknown subagent profile: ${profileName}`);
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error("Subagent task is required");
    const id = randomUUID();
    const threadId = options.agentThreadId ?? id;
    const record = this.createRecord(
      {
        id,
        parentId: this.rootId,
        agentThreadId: threadId,
        ...(options.retryOf ? { retryOf: options.retryOf } : {}),
        ...(options.followUpOf ? { followUpOf: options.followUpOf } : {}),
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
    record.modelState = options.modelState;
    record.history = options.history;
    this.queue.push(id);
    this.emit(record, options.followUpOf ? "followed_up" : "created");
    this.scheduleRuntimeCheckpoint();
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
      const record = this.records.get(id);
      const profile = record?.profile;
      if (!record || !profile) return false;
      const sameThreadIsRunning = [...this.running].some((runningId) => {
        const running = this.records.get(runningId);
        return running && agentThreadId(running) === agentThreadId(record);
      });
      return (
        !sameThreadIsRunning && (profile.toolAccess !== "all" || !writerActive)
      );
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
    this.scheduleRuntimeCheckpoint();
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
    const delegatedCheckpoint = childOptions?.onCheckpoint;
    const promise = this.loop
      .run(childAgent, record.snapshot.task, {
        ...childOptions,
        signal,
        ...((record.history?.length ?? 0) > 0
          ? {
              history: [
                ...(childOptions?.history ?? []),
                ...(record.history ?? []),
              ],
            }
          : {}),
        ...(record.modelState === undefined
          ? {}
          : { modelState: record.modelState }),
        takeAdditionalInput: async () => {
          const input = record.pendingInput.shift();
          if (input !== undefined) {
            this.scheduleRuntimeCheckpoint();
            await this.flushRuntimeCheckpoints();
          }
          return input;
        },
        onCheckpoint: async (checkpoint) => {
          this.recordCheckpoint(record, checkpoint);
          await delegatedCheckpoint?.(checkpoint);
          await this.flushRuntimeCheckpoints();
        },
        onEvent: (event) => this.updateFromAgentEvent(record, event),
      })
      .then(async (result) => {
        this.completeRecord(record, result);
        await this.flushRuntimeCheckpoints();
      })
      .catch(async (error: unknown) => {
        if (record.controller.signal.aborted || this.rootSignal?.aborted) {
          this.cancelRecord(record, errorMessage(error));
        } else {
          this.failRecord(record, error);
        }
        await this.flushRuntimeCheckpoints();
      })
      .finally(() => {
        this.running.delete(record.snapshot.id);
        this.childPromises.delete(promise);
        if (record.execution === promise) record.execution = undefined;
        this.pump();
      });
    record.execution = promise;
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
                ...(event.usage
                  ? { usage: normalizedTokenUsage(event.usage) }
                  : {}),
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
                ...(event.result.error?.code
                  ? { errorCode: event.result.error.code }
                  : {}),
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
    record.modelState = result.modelState;
    this.scheduleRuntimeCheckpoint();
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
    this.scheduleRuntimeCheckpoint();
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
    this.scheduleRuntimeCheckpoint();
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  private interruptRecord(record: AgentTaskRecord, reason: string): void {
    if (isTerminal(record.snapshot.status)) return;
    const completedAt = this.wallNow().toISOString();
    this.patchRecord(record, "interrupted", {
      status: "interrupted",
      phase: "done",
      completedAt,
      latestActivity: "Interrupted",
      error: reason,
      summary: reason,
      activities: record.snapshot.activities.map((activity) =>
        activity.status === "running"
          ? { ...activity, status: "failed" as const }
          : activity,
      ),
      transcript: record.snapshot.transcript.map((entry) =>
        entry.status === "running"
          ? {
              ...entry,
              status: "failed" as const,
              completedAt,
            }
          : entry,
      ),
    });
    this.scheduleRuntimeCheckpoint();
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
    if (MAILBOX_UPDATE_REASONS.has(reason)) {
      this.wakeMailbox(record, reason);
    }
  }

  private wakeMailbox(
    record: AgentTaskRecord,
    reason: AgentTreeUpdateReason,
  ): void {
    const event = {
      agentId: record.snapshot.id,
      agentThreadId: agentThreadId(record),
      reason,
    };
    for (const waiter of [...this.mailboxWaiters]) {
      if (waiter.threadIds.has(event.agentThreadId)) waiter.resolve(event);
    }
  }

  private recordCheckpoint(
    record: AgentTaskRecord,
    checkpoint: AgentRunCheckpoint,
  ): void {
    record.modelState = checkpoint.modelState;
    record.checkpointStep = checkpoint.step;
    record.checkpointPhase = checkpoint.phase;
    record.snapshot = {
      ...record.snapshot,
      usage: { ...checkpoint.usage },
    };
    this.scheduleRuntimeCheckpoint();
  }

  private scheduleRuntimeCheckpoint(): void {
    const persist = this.options.onRuntimeCheckpoint;
    if (!persist) return;
    const checkpoint = this.runtimeSnapshot;
    this.runtimeCheckpointWrites = this.runtimeCheckpointWrites.then(() =>
      persist(checkpoint),
    );
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
        const snapshot = this.spawn(
          stringArgument(values.role, "role"),
          stringArgument(values.task, "task"),
        );
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private followUpTool(): Tool {
    return {
      name: FOLLOW_UP_AGENT_TOOL,
      description:
        "Continue an idle subagent thread with a new task while preserving its provider model state. Returns a new linked turn ID in the same agent thread.",
      parameters: {
        type: "object",
        properties: {
          agentId: {
            type: "string",
            description: "Agent or agent-thread ID returned by spawn/follow-up",
          },
          input: {
            type: "string",
            minLength: 1,
            description: "The next task or question for the same agent",
          },
        },
        required: ["agentId", "input"],
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        const snapshot = this.followUp(
          agentId,
          stringArgument(values.input, "input"),
        );
        if (!snapshot) {
          throw new Error(
            `Agent ${agentId} is active, closed, or unavailable for follow-up`,
          );
        }
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private retryTool(): Tool {
    return {
      name: RETRY_AGENT_TOOL,
      description:
        "Retry a finished or interrupted agent turn from fresh provider state while keeping it linked to the same agent thread.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        const snapshot = this.retry(agentId);
        if (!snapshot) {
          throw new Error(
            `Agent ${agentId} is active, closed, or unavailable for retry`,
          );
        }
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private checkTool(): Tool {
    return {
      name: CHECK_AGENTS_TOOL,
      description:
        "Inspect the latest state of selected subagents without waiting. Returns current status snapshots for deciding whether to wait, follow up, or interrupt.",
      parameters: collaborationTargetsParameters(
        "Subagent IDs to inspect; omit to inspect every current subagent thread",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const requested = optionalAgentIds(values.agentIds);
        const records = requested
          ? this.resolveCurrentChildRecords(requested)
          : this.currentChildRecords();
        return collaborationStatus(records);
      },
    };
  }

  private waitTool(): Tool {
    return {
      name: WAIT_FOR_AGENTS_TOOL,
      description:
        "Wait until a selected subagent has a meaningful update or the bounded timeout expires. Returns partial status snapshots, so one stuck provider or tool cannot block the parent indefinitely.",
      parameters: {
        type: "object",
        properties: {
          agentIds: {
            type: "array",
            items: { type: "string" },
            description: "Subagent IDs to wait for; omit to wait for all",
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
            maximum: MAX_AGENT_WAIT_TIMEOUT_MS,
            description: `Maximum wait in milliseconds; defaults to ${DEFAULT_AGENT_WAIT_TIMEOUT_MS}`,
          },
        },
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_, context) => {
        const values = objectArguments(arguments_);
        const requested = optionalAgentIds(values.agentIds);
        const timeoutMs = waitTimeoutArgument(values.timeoutMs);
        let records = this.waitRecords(requested);
        let wakeReason:
          "all_terminal" | "results_available" | "agent_updated" | "timeout";
        let mailboxEvent: AgentMailboxEvent | undefined;

        if (records.every(({ snapshot }) => isTerminal(snapshot.status))) {
          wakeReason = "all_terminal";
        } else if (
          records.some(({ snapshot }) => isTerminal(snapshot.status))
        ) {
          wakeReason = "results_available";
        } else if (records.length === 0) {
          wakeReason = "all_terminal";
        } else {
          const wake = await this.waitForMailbox(
            new Set(records.map(agentThreadId)),
            timeoutMs,
            context.signal,
          );
          wakeReason = wake.reason;
          if (wake.reason === "agent_updated") mailboxEvent = wake.event;
          await Promise.resolve();
          records = this.waitRecords(requested);
        }

        for (const record of records) {
          if (isTerminal(record.snapshot.status)) record.collected = true;
        }
        this.scheduleRuntimeCheckpoint();
        await this.flushRuntimeCheckpoints();
        const status = collaborationStatus(records);
        return {
          wakeReason,
          timedOut: wakeReason === "timeout",
          timeoutMs,
          ...(mailboxEvent ? { mailboxEvent } : {}),
          ...status,
        };
      },
    };
  }

  private steerTool(): Tool {
    return {
      name: STEER_AGENT_TOOL,
      description:
        "Add direction or a constraint to a queued or running subagent. The message is delivered at the next safe model/tool boundary.",
      parameters: collaborationInputParameters(
        "Direction or constraint for the active agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        if (!this.steer(agentId, stringArgument(values.input, "input"))) {
          throw new Error(`Agent ${agentId} is not available for steering`);
        }
        await this.flushRuntimeCheckpoints();
        return { agentId, accepted: true };
      },
    };
  }

  private interruptTool(): Tool {
    return {
      name: INTERRUPT_AGENT_TOOL,
      description:
        "Interrupt the current turn of an agent without closing its thread. A later follow-up may continue from the latest persisted model state.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        if (!this.interrupt(agentId)) {
          throw new Error(`Agent ${agentId} is not running or queued`);
        }
        await this.flushRuntimeCheckpoints();
        return { agentId, interrupted: true };
      },
    };
  }

  private closeTool(): Tool {
    return {
      name: CLOSE_AGENT_TOOL,
      description:
        "Permanently close an agent thread, interrupting active work and discarding any uncollected requirement. Closed threads cannot receive follow-ups.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        if (!this.close(agentId)) {
          throw new Error(`Agent ${agentId} is already closed or unknown`);
        }
        await this.flushRuntimeCheckpoints();
        return { agentId, closed: true };
      },
    };
  }

  private childRecords(): AgentTaskRecord[] {
    return [...this.records.values()].filter(
      ({ snapshot }) => snapshot.parentId === this.rootId,
    );
  }

  private childThreadRecords(agentId: string): AgentTaskRecord[] {
    const direct = this.records.get(agentId);
    const threadId =
      direct?.snapshot.parentId === this.rootId
        ? agentThreadId(direct)
        : agentId;
    return this.childRecords().filter(
      (record) => agentThreadId(record) === threadId,
    );
  }

  private currentChildRecord(agentId: string): AgentTaskRecord | undefined {
    return this.childThreadRecords(agentId).at(-1);
  }

  private currentChildRecords(): AgentTaskRecord[] {
    const records = new Map<string, AgentTaskRecord>();
    for (const record of this.childRecords()) {
      records.set(agentThreadId(record), record);
    }
    return [...records.values()];
  }

  private resolveCurrentChildRecords(
    agentIds: readonly string[],
  ): AgentTaskRecord[] {
    const records = agentIds.map((id) => {
      const record = this.currentChildRecord(id);
      if (!record) throw new Error(`Unknown subagent: ${id}`);
      return record;
    });
    return uniqueAgentRecords(records);
  }

  private waitRecords(
    agentIds: readonly string[] | undefined,
  ): AgentTaskRecord[] {
    return agentIds
      ? this.resolveCurrentChildRecords(agentIds)
      : this.childRecords().filter(
          ({ collected, snapshot }) => !collected && !snapshot.closedAt,
        );
  }

  private waitForMailbox(
    threadIds: ReadonlySet<string>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<
    | { reason: "agent_updated"; event: AgentMailboxEvent }
    | { reason: "timeout" }
  > {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (
        wake:
          | { reason: "agent_updated"; event: AgentMailboxEvent }
          | { reason: "timeout" },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.mailboxWaiters.delete(waiter);
        resolve(wake);
      };
      const waiter: AgentMailboxWaiter = {
        threadIds,
        resolve: (event) => finish({ reason: "agent_updated", event }),
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.mailboxWaiters.delete(waiter);
        reject(signal.reason);
      };
      const timer = setTimeout(() => finish({ reason: "timeout" }), timeoutMs);
      this.mailboxWaiters.add(waiter);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  private threadHasActiveRun(record: AgentTaskRecord): boolean {
    return this.childThreadRecords(agentThreadId(record)).some(
      ({ snapshot }) => !isTerminal(snapshot.status),
    );
  }

  private openAgentThreadCount(): number {
    return new Set(
      this.childRecords()
        .filter(({ snapshot }) => snapshot.closedAt === undefined)
        .map(agentThreadId),
    ).size;
  }

  private childThreadHistory(
    record: AgentTaskRecord,
  ): readonly ModelConversationMessage[] {
    return this.childThreadRecords(agentThreadId(record)).flatMap(
      ({ snapshot }) =>
        snapshot.output
          ? [
              { role: "user" as const, text: snapshot.task },
              { role: "assistant" as const, text: snapshot.output },
            ]
          : [],
    );
  }

  private cancelRemaining(reason: string): void {
    for (const record of this.childRecords()) {
      if (isTerminal(record.snapshot.status)) continue;
      record.controller.abort(new Error(reason));
      if (record.snapshot.status === "queued") {
        this.removeFromQueue(record.snapshot.id);
      }
      this.detachChildExecution(record);
      this.cancelRecord(record, reason);
    }
    this.pump();
  }

  private detachChildExecution(record: AgentTaskRecord): void {
    this.running.delete(record.snapshot.id);
    if (record.execution) this.childPromises.delete(record.execution);
    record.execution = undefined;
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
    onRuntimeCheckpoint: _onRuntimeCheckpoint,
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
    ...COLLABORATION_TOOLS,
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
    `At most ${maxConcurrent} subagents run concurrently. Start independent tasks with ${SPAWN_AGENT_TOOL}, continue useful parent work, then use ${CHECK_AGENTS_TOOL} for a non-blocking status snapshot or ${WAIT_FOR_AGENTS_TOOL} for a bounded mailbox wait before using their findings or finishing.`,
    `Use ${STEER_AGENT_TOOL} to add direction to active work. Use ${FOLLOW_UP_AGENT_TOOL} to continue a finished or interrupted agent with its preserved model state.`,
    `Use ${RETRY_AGENT_TOOL} to rerun a finished or interrupted turn from fresh provider state while retaining its thread linkage.`,
    `Use ${INTERRUPT_AGENT_TOOL} to stop only the current turn while keeping the thread reusable. Use ${CLOSE_AGENT_TOOL} only when no more work or results are needed from that thread.`,
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
    transcript: snapshot.transcript.map((entry) => ({
      ...entry,
      ...(entry.kind === "model" && entry.usage
        ? { usage: { ...entry.usage } }
        : {}),
    })),
  };
}

function agentThreadId(record: AgentTaskRecord): string {
  return record.snapshot.agentThreadId ?? record.snapshot.id;
}

function collaborationTargetParameters(): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "Agent or stable agent-thread ID",
      },
    },
    required: ["agentId"],
    additionalProperties: false,
  };
}

function collaborationTargetsParameters(
  description: string,
): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      agentIds: {
        type: "array",
        items: { type: "string" },
        description,
      },
    },
    additionalProperties: false,
  };
}

function optionalAgentIds(value: unknown): string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("agentIds must be an array");
  return value.map((id) => stringArgument(id, "agentIds"));
}

function waitTimeoutArgument(value: unknown): number {
  if (value === undefined) return DEFAULT_AGENT_WAIT_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_AGENT_WAIT_TIMEOUT_MS
  ) {
    throw new Error(
      `timeoutMs must be an integer between 1 and ${MAX_AGENT_WAIT_TIMEOUT_MS}`,
    );
  }
  return value;
}

function uniqueAgentRecords(
  records: readonly AgentTaskRecord[],
): AgentTaskRecord[] {
  return [
    ...new Map(records.map((record) => [record.snapshot.id, record])).values(),
  ];
}

function collaborationStatus(records: readonly AgentTaskRecord[]): {
  agents: Array<{
    id: string;
    agentThreadId: string;
    role: string;
    task: string;
    status: AgentTaskSnapshot["status"];
    phase: AgentTaskSnapshot["phase"];
    latestActivity?: string;
    output?: string;
    error?: string;
    closed: boolean;
  }>;
  activeAgentIds: string[];
  terminalAgentIds: string[];
} {
  const agents = records.map(({ snapshot }) => ({
    id: snapshot.id,
    agentThreadId: snapshot.agentThreadId ?? snapshot.id,
    role: snapshot.role,
    task: snapshot.task,
    status: snapshot.status,
    phase: snapshot.phase,
    ...(snapshot.latestActivity
      ? { latestActivity: snapshot.latestActivity }
      : {}),
    ...(snapshot.output ? { output: snapshot.output } : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
    closed: snapshot.closedAt !== undefined,
  }));
  return {
    agents,
    activeAgentIds: agents
      .filter(({ status }) => !isTerminal(status))
      .map(({ id }) => id),
    terminalAgentIds: agents
      .filter(({ status }) => isTerminal(status))
      .map(({ id }) => id),
  };
}

function collaborationInputParameters(
  inputDescription: string,
): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "Agent or stable agent-thread ID",
      },
      input: {
        type: "string",
        minLength: 1,
        description: inputDescription,
      },
    },
    required: ["agentId", "input"],
    additionalProperties: false,
  };
}

function normalizedTokenUsage(usage: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
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
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
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
