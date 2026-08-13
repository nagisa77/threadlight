import { randomUUID } from "node:crypto";

import { AgentLoop } from "./agent-loop.js";
import { ToolExecutionError } from "./tool-error.js";
import type {
  Agent,
  AgentEvent,
  AgentLifecycleErrorCode,
  AgentOrchestratorOptions,
  AgentRunCheckpoint,
  AgentRuntimeSnapshot,
  AgentTaskMessage,
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
  ResumableAgentThread,
  SubagentProfile,
  Tool,
  ToolCall,
  ToolResult,
  TokenUsage,
} from "./types.js";

const SPAWN_AGENT_TOOL = "spawn_agent";
const SEND_MESSAGE_TOOL = "send_message";
const FOLLOWUP_TASK_TOOL = "followup_task";
const FOLLOW_UP_AGENT_TOOL = "follow_up_agent";
const RETRY_AGENT_TOOL = "retry_agent";
const CHECK_AGENTS_TOOL = "check_agents";
const WAIT_FOR_AGENTS_TOOL = "wait_for_agents";
const STEER_AGENT_TOOL = "steer_agent";
const INTERRUPT_AGENT_TOOL = "interrupt_agent";
const CLOSE_AGENT_TOOL = "close_agent";
const COLLABORATION_TOOLS = new Set([
  SPAWN_AGENT_TOOL,
  SEND_MESSAGE_TOOL,
  FOLLOWUP_TASK_TOOL,
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
  "messaged",
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
  callerId?: string;
  parentId?: string;
  name?: string;
  agentPath?: string;
  retryOf?: string;
  followUpOf?: string;
  agentThreadId?: string;
  modelState?: unknown;
  history?: readonly ModelConversationMessage[];
  message?: AgentTaskMessage;
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

interface AgentLifecycleTarget {
  threadId: string;
  records: AgentTaskRecord[];
  resumable?: ResumableAgentThread;
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
  private readonly resumableThreads = new Map<string, ResumableAgentThread>();
  private readonly resumableTaskThreads = new Map<string, string>();
  private readonly threadClosures = new Map<string, string>();
  private readonly records = new Map<string, AgentTaskRecord>();
  private readonly queue: string[] = [];
  private readonly running = new Set<string>();
  private readonly detachedWriters = new Set<string>();
  private readonly childPromises = new Set<Promise<void>>();
  private readonly mailboxWaiters = new Set<AgentMailboxWaiter>();
  private readonly rootId = randomUUID();
  private readonly maxConcurrent: number;
  private readonly maxAgents: number;
  private readonly maxDepth: number;
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
    for (const thread of options.resumableThreads ?? []) {
      const threadId = thread.agentThreadId.trim();
      if (!threadId) throw new Error("Resumable agent thread ID is required");
      if (this.resumableThreads.has(threadId)) {
        throw new Error(`Duplicate resumable agent thread: ${threadId}`);
      }
      const latestThreadId =
        thread.latestTask.agentThreadId ?? thread.latestTask.id;
      if (latestThreadId !== threadId) {
        throw new Error(
          `Resumable agent task ${thread.latestTask.id} belongs to thread ${latestThreadId}, not ${threadId}`,
        );
      }
      const restored = {
        ...thread,
        agentThreadId: threadId,
        taskIds: [...thread.taskIds],
        latestTask: cloneSnapshot(thread.latestTask),
        history: thread.history.map((message) => ({ ...message })),
      };
      this.resumableThreads.set(threadId, restored);
      if (thread.latestTask.closedAt) {
        this.threadClosures.set(threadId, thread.latestTask.closedAt);
      }
      for (const taskId of new Set([...thread.taskIds, thread.latestTask.id])) {
        const existing = this.resumableTaskThreads.get(taskId);
        if (existing && existing !== threadId) {
          throw new Error(
            `Resumable agent task ${taskId} belongs to multiple threads`,
          );
        }
        this.resumableTaskThreads.set(taskId, threadId);
      }
    }
    this.maxConcurrent = positiveInteger(options.maxConcurrent, 3);
    this.maxAgents = positiveInteger(options.maxAgents, 8);
    this.maxDepth = positiveInteger(options.maxDepth, 3);
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
      ...(this.threadClosures.size === 0
        ? {}
        : {
            closedAgentThreads: [...this.threadClosures].map(
              ([agentThreadId, closedAt]) => ({ agentThreadId, closedAt }),
            ),
          }),
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
      ...this.collaborationTools(this.rootId),
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
      this.rootId,
      this.rootId,
      true,
      this.options.controller,
    );

    try {
      const runOptions = rootRunOptions(this.options);
      const result = await this.loop.run(orchestratedAgent, input, {
        ...runOptions,
        controller,
        takeAdditionalInput: async () => {
          const message = root.pendingInput.shift();
          if (message !== undefined) {
            this.scheduleRuntimeCheckpoint();
            await this.flushRuntimeCheckpoints();
            return message;
          }
          return runOptions.takeAdditionalInput?.();
        },
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
        usage: this.nonRootRecords().reduce(
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
    let record: AgentTaskRecord | undefined;
    try {
      record = this.currentAgentRecord(this.rootId, agentId);
    } catch (error) {
      if (error instanceof ToolExecutionError) return false;
      throw error;
    }
    if (
      !record ||
      record.snapshot.closedAt !== undefined ||
      isTerminal(record.snapshot.status)
    ) {
      return false;
    }
    this.cancelSubtree(record, "Stopped by user");
    this.scheduleRuntimeCheckpoint();
    this.pump();
    return true;
  }

  steer(agentId: string, input: string): boolean {
    try {
      this.steerOrThrow(agentId, input);
      return true;
    } catch (error) {
      if (error instanceof ToolExecutionError) return false;
      throw error;
    }
  }

  private steerOrThrow(agentId: string, input: string): void {
    this.steerFromOrThrow(this.rootId, agentId, input);
  }

  private steerFromOrThrow(
    callerThreadId: string,
    agentId: string,
    input: string,
  ): void {
    const instruction = input.trim();
    if (!instruction) throw new Error("Agent direction is required");
    const target = this.lifecycleTarget(callerThreadId, agentId, "steering");
    this.assertLifecycleAuthority(callerThreadId, target, agentId, "steering");
    this.assertThreadOpen(target, agentId, "steering");
    const record = target.records.at(-1);
    if (!record || isTerminal(record.snapshot.status)) {
      throw lifecycleError("agent_not_attached", agentId, "steering");
    }
    record.pendingInput.push(instruction);
    this.patchRecord(record, "steered", {
      latestActivity: "Direction updated",
    });
    this.scheduleRuntimeCheckpoint();
  }

  retry(agentId: string): AgentTaskSnapshot | undefined {
    try {
      return this.retryOrThrow(agentId);
    } catch (error) {
      if (error instanceof ToolExecutionError) return;
      throw error;
    }
  }

  private retryOrThrow(agentId: string): AgentTaskSnapshot {
    return this.retryFromOrThrow(this.rootId, agentId);
  }

  private retryFromOrThrow(
    callerThreadId: string,
    agentId: string,
  ): AgentTaskSnapshot {
    const target = this.lifecycleTarget(callerThreadId, agentId, "retry");
    this.assertLifecycleAuthority(callerThreadId, target, agentId, "retry");
    this.assertThreadContinuable(target, agentId, "retry");
    const previous = target.records.at(-1);
    const latestTask = previous?.snapshot ?? target.resumable?.latestTask;
    const profileName =
      previous?.profile?.name ?? target.resumable?.profileName;
    if (!latestTask || !profileName || !this.profiles.has(profileName)) {
      throw lifecycleError(
        "agent_state_unavailable",
        agentId,
        "retry",
        "its persisted profile is unavailable",
      );
    }
    const parentId =
      latestTask.parentId && this.currentRecordForThread(latestTask.parentId)
        ? latestTask.parentId
        : callerThreadId;
    return this.spawn(profileName, latestTask.task, {
      callerId: callerThreadId,
      parentId,
      name: latestTask.name,
      ...(parentId === latestTask.parentId && latestTask.agentPath
        ? { agentPath: latestTask.agentPath }
        : {}),
      retryOf: latestTask.id,
      agentThreadId: target.threadId,
    });
  }

  followUp(agentId: string, input: string): AgentTaskSnapshot | undefined {
    try {
      return this.followUpOrThrow(agentId, input);
    } catch (error) {
      if (error instanceof ToolExecutionError) return;
      throw error;
    }
  }

  private followUpOrThrow(agentId: string, input: string): AgentTaskSnapshot {
    return this.followUpFromOrThrow(this.rootId, agentId, input);
  }

  private followUpFromOrThrow(
    callerThreadId: string,
    agentId: string,
    input: string,
    message?: AgentTaskMessage,
  ): AgentTaskSnapshot {
    const instruction = input.trim();
    if (!instruction) throw new Error("Agent follow-up input is required");
    const target = this.lifecycleTarget(callerThreadId, agentId, "follow-up");
    this.assertLifecycleAuthority(callerThreadId, target, agentId, "follow-up");
    this.assertThreadContinuable(target, agentId, "follow-up");
    const previous = target.records.at(-1);
    const latestTask = previous?.snapshot ?? target.resumable?.latestTask;
    const profileName =
      previous?.profile?.name ?? target.resumable?.profileName;
    const modelState = previous?.modelState ?? target.resumable?.modelState;
    const history = previous
      ? this.childThreadHistory(previous)
      : (target.resumable?.history ?? []);
    if (!latestTask || !profileName || !this.profiles.has(profileName)) {
      throw lifecycleError(
        "agent_state_unavailable",
        agentId,
        "follow-up",
        "its persisted profile is unavailable",
      );
    }
    if (!previous && modelState === undefined && history.length === 0) {
      throw lifecycleError(
        "agent_state_unavailable",
        agentId,
        "follow-up",
        "neither opaque model state nor conversation history is available",
      );
    }
    const parentId =
      latestTask.parentId && this.currentRecordForThread(latestTask.parentId)
        ? latestTask.parentId
        : callerThreadId;
    return this.spawn(profileName, instruction, {
      callerId: callerThreadId,
      parentId,
      name: latestTask.name,
      ...(parentId === latestTask.parentId && latestTask.agentPath
        ? { agentPath: latestTask.agentPath }
        : {}),
      followUpOf: latestTask.id,
      agentThreadId: target.threadId,
      modelState,
      history,
      ...(message ? { message } : {}),
    });
  }

  interrupt(agentId: string): boolean {
    try {
      this.interruptOrThrow(agentId);
      return true;
    } catch (error) {
      if (error instanceof ToolExecutionError) return false;
      throw error;
    }
  }

  private interruptOrThrow(agentId: string): void {
    this.interruptFromOrThrow(this.rootId, agentId);
  }

  private interruptFromOrThrow(callerThreadId: string, agentId: string): void {
    const target = this.lifecycleTarget(
      callerThreadId,
      agentId,
      "interruption",
    );
    this.assertLifecycleAuthority(
      callerThreadId,
      target,
      agentId,
      "interruption",
    );
    this.assertThreadOpen(target, agentId, "interruption");
    const record = target.records.at(-1);
    if (!record || isTerminal(record.snapshot.status)) {
      throw lifecycleError("agent_not_attached", agentId, "interruption");
    }
    for (const member of this.subtreeActiveRecords(target.threadId)) {
      member.controller.abort(new Error("Agent interrupted by collaborator"));
      if (member.snapshot.status === "queued") {
        this.removeFromQueue(member.snapshot.id);
      }
      this.detachChildExecution(member);
      this.interruptRecord(member, "Interrupted by collaborator");
    }
    this.pump();
  }

  close(agentId: string): boolean {
    try {
      this.closeOrThrow(agentId);
      return true;
    } catch (error) {
      if (error instanceof ToolExecutionError) return false;
      throw error;
    }
  }

  private closeOrThrow(agentId: string): void {
    this.closeFromOrThrow(this.rootId, agentId);
  }

  private closeFromOrThrow(callerThreadId: string, agentId: string): void {
    const target = this.lifecycleTarget(callerThreadId, agentId, "close");
    this.assertLifecycleAuthority(callerThreadId, target, agentId, "close");
    this.assertThreadOpen(target, agentId, "close");
    if (
      target.records.length === 0 &&
      target.resumable &&
      !isTerminal(target.resumable.latestTask.status)
    ) {
      throw lifecycleError("agent_not_attached", agentId, "close");
    }
    const closedAt = this.wallNow().toISOString();
    const subtree = this.subtreeThreadIds(target.threadId);
    for (const threadId of subtree) this.threadClosures.set(threadId, closedAt);
    for (const record of this.nonRootRecords().filter((candidate) =>
      subtree.has(agentThreadId(candidate)),
    )) {
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
  }

  hasActiveWriter(exceptTaskId?: string): boolean {
    return [...this.running, ...this.detachedWriters].some((id) => {
      if (id === exceptTaskId) return false;
      const profile = this.records.get(id)?.profile;
      return profile?.toolAccess === "all";
    });
  }

  completionBlocker(callerThreadId: string, root: boolean): string | undefined {
    const children = root
      ? this.nonRootRecords()
      : this.directChildRecords(callerThreadId);
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

  writeDecision(
    callerTaskId: string,
    call: ToolCall,
    tool: Tool | undefined,
  ): RunControllerToolDecision | undefined {
    if (
      COLLABORATION_TOOLS.has(call.name) ||
      !this.hasActiveWriter(callerTaskId) ||
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
      agentPath: "/root",
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
      messages: [],
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
    const parentId = options.parentId ?? this.rootId;
    const callerId = options.callerId ?? parentId;
    const parent = this.currentRecordForThread(parentId);
    const caller = this.currentRecordForThread(callerId);
    if (!parent) {
      throw lifecycleError("agent_not_attached", parentId, "delegation");
    }
    if (!caller) {
      throw lifecycleError("agent_not_attached", callerId, "delegation");
    }
    if (callerId !== this.rootId && this.running.size >= this.maxConcurrent) {
      throw new Error(
        `No delegation slot is available (${this.maxConcurrent} active); finish or interrupt another agent before starting nested work`,
      );
    }
    const parentDepth = agentDepth(parent.snapshot.agentPath);
    if (!options.agentThreadId && parentDepth >= this.maxDepth) {
      throw new Error(
        `Agent delegation depth limit reached (${this.maxDepth})`,
      );
    }
    if (
      caller.profile?.toolAccess === "all" &&
      profile.toolAccess === "all" &&
      !isTerminal(caller.snapshot.status)
    ) {
      throw lifecycleError(
        "agent_write_conflict",
        callerId,
        "delegation",
        "a write-capable agent cannot wait on another write-capable child while it owns the workspace",
      );
    }
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error("Subagent task is required");
    const id = randomUUID();
    const threadId = options.agentThreadId ?? id;
    const name = options.agentThreadId
      ? (options.name ?? profile.name)
      : options.name
        ? this.assertChildNameAvailable(parentId, options.name)
        : this.availableChildName(parentId, profile.name);
    const agentPath =
      options.agentPath ?? `${parent.snapshot.agentPath ?? "/root"}/${name}`;
    const record = this.createRecord(
      {
        id,
        parentId,
        agentThreadId: threadId,
        agentPath,
        ...(options.retryOf ? { retryOf: options.retryOf } : {}),
        ...(options.followUpOf ? { followUpOf: options.followUpOf } : {}),
        name,
        role: profile.name,
        task: normalizedTask,
        status: "queued",
        phase: "queued",
        createdAt: this.wallNow().toISOString(),
        elapsedMs: 0,
        latestActivity: "Queued",
        activities: [],
        messages: options.message ? [options.message] : [],
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
      const sameThreadHasDetachedWriter = [...this.detachedWriters].some(
        (detachedId) => {
          const detached = this.records.get(detachedId);
          return detached && agentThreadId(detached) === agentThreadId(record);
        },
      );
      return (
        !sameThreadIsRunning &&
        !sameThreadHasDetachedWriter &&
        (profile.toolAccess !== "all" || !writerActive)
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
      parentId: record.snapshot.parentId ?? this.rootId,
      profile,
    });
    const signal = combineSignals(this.rootSignal, record.controller.signal);
    const childAgent: Agent = {
      name: record.snapshot.name,
      instructions: [
        rootAgent.instructions,
        "SUBAGENT ROLE",
        profile.instructions,
        `AGENT IDENTITY\nYou are ${record.snapshot.agentPath ?? record.snapshot.name}. Your stable thread ID is ${agentThreadId(record)}.`,
        delegationInstructions([...this.profiles.values()], this.maxConcurrent),
        "Work only on the delegated task. Do not ask the user questions. You may delegate bounded subtasks and exchange messages when that materially helps. Return a concise result with concrete evidence for your parent agent.",
      ].join("\n\n"),
      model: profile.model ?? rootAgent.model,
      provider: profile.provider ?? rootAgent.provider,
      tools: childTools(
        rootAgent.tools ?? [],
        profile,
        this.collaborationTools(agentThreadId(record)),
      ),
      maxSteps: profile.maxSteps ?? rootAgent.maxSteps,
    };
    const delegatedCheckpoint = childOptions?.onCheckpoint;
    const controller = new OrchestrationRunController(
      this,
      agentThreadId(record),
      record.snapshot.id,
      false,
      childOptions?.controller,
    );
    const promise = this.loop
      .run(childAgent, record.snapshot.task, {
        ...childOptions,
        controller,
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
        this.detachedWriters.delete(record.snapshot.id);
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

  private collaborationTools(callerThreadId: string): Tool[] {
    return [
      this.spawnTool(callerThreadId),
      this.sendMessageTool(callerThreadId),
      this.followupTaskTool(callerThreadId),
      this.followUpTool(callerThreadId),
      this.retryTool(callerThreadId),
      this.checkTool(callerThreadId),
      this.waitTool(callerThreadId),
      this.steerTool(callerThreadId),
      this.interruptTool(callerThreadId),
      this.closeTool(callerThreadId),
    ];
  }

  private spawnTool(callerThreadId: string): Tool {
    return {
      name: SPAWN_AGENT_TOOL,
      description:
        "Start a direct child-agent task. Returns immediately so independent tasks can run concurrently.",
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
          taskName: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9_-]{0,63}$",
            description:
              "Optional stable sibling-unique name used for addressing, such as api_review",
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
          {
            callerId: callerThreadId,
            parentId: callerThreadId,
            ...(values.taskName === undefined
              ? {}
              : { name: taskNameArgument(values.taskName) }),
          },
        );
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private sendMessageTool(callerThreadId: string): Tool {
    return {
      name: SEND_MESSAGE_TOOL,
      description:
        "Send a message to a queued or running agent. Delivery happens at the next safe model/tool boundary without starting a new turn.",
      parameters: collaborationMessageParameters(
        "Message, evidence, question, or correction for the active agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const target = stringArgument(values.target, "target");
        const message = this.sendMessageOrThrow(
          callerThreadId,
          target,
          stringArgument(values.message, "message"),
        );
        await this.flushRuntimeCheckpoints();
        return { accepted: true, message };
      },
    };
  }

  private followupTaskTool(callerThreadId: string): Tool {
    return {
      name: FOLLOWUP_TASK_TOOL,
      description:
        "Wake an idle agent with follow-up work in the same stable thread, preserving opaque provider state and visible history.",
      parameters: collaborationMessageParameters(
        "The next task or question for the idle agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const target = stringArgument(values.target, "target");
        const text = stringArgument(values.message, "message");
        const message = this.agentMessage(
          callerThreadId,
          target,
          text,
          "follow_up",
        );
        const snapshot = this.followUpFromOrThrow(
          callerThreadId,
          target,
          text,
          message,
        );
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private followUpTool(callerThreadId: string): Tool {
    return {
      name: FOLLOW_UP_AGENT_TOOL,
      description:
        "Compatibility alias for continuing an idle agent thread with preserved provider state.",
      parameters: collaborationInputParameters(
        "The next task or question for the same agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        const snapshot = this.followUpFromOrThrow(
          callerThreadId,
          agentId,
          stringArgument(values.input, "input"),
        );
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private retryTool(callerThreadId: string): Tool {
    return {
      name: RETRY_AGENT_TOOL,
      description:
        "Retry a finished or interrupted agent turn from fresh provider state while keeping the same stable agent thread.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        const snapshot = this.retryFromOrThrow(callerThreadId, agentId);
        await this.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private checkTool(callerThreadId: string): Tool {
    return {
      name: CHECK_AGENTS_TOOL,
      description:
        "Inspect selected agents without waiting. Omit IDs to inspect this caller's direct children.",
      parameters: collaborationTargetsParameters(
        "Agent IDs, names, or canonical paths; omit for direct children",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const requested = optionalAgentIds(values.agentIds);
        const records = requested
          ? this.resolveCurrentAgentRecords(callerThreadId, requested)
          : this.currentDirectChildRecords(callerThreadId);
        return collaborationStatus(records);
      },
    };
  }

  private waitTool(callerThreadId: string): Tool {
    return {
      name: WAIT_FOR_AGENTS_TOOL,
      description:
        "Wait for selected agents or, by default, this caller's direct children. The wait is bounded and returns partial status snapshots.",
      parameters: {
        type: "object",
        properties: {
          agentIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Agent IDs, names, or canonical paths; omit for direct children",
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
        let records = this.waitRecords(callerThreadId, requested);
        let wakeReason:
          "all_terminal" | "results_available" | "agent_updated" | "timeout";
        let mailboxEvent: AgentMailboxEvent | undefined;

        if (
          records.length === 0 ||
          records.every(({ snapshot }) => isTerminal(snapshot.status))
        ) {
          wakeReason = "all_terminal";
        } else if (
          records.some(({ snapshot }) => isTerminal(snapshot.status))
        ) {
          wakeReason = "results_available";
        } else {
          const wake = await this.waitForMailbox(
            new Set(records.map(agentThreadId)),
            timeoutMs,
            context.signal,
          );
          wakeReason = wake.reason;
          if (wake.reason === "agent_updated") mailboxEvent = wake.event;
          await Promise.resolve();
          records = this.waitRecords(callerThreadId, requested);
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

  private steerTool(callerThreadId: string): Tool {
    return {
      name: STEER_AGENT_TOOL,
      description:
        "Add direction or a constraint to a queued or running agent at its next safe boundary.",
      parameters: collaborationInputParameters(
        "Direction or constraint for the active agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        this.steerFromOrThrow(
          callerThreadId,
          agentId,
          stringArgument(values.input, "input"),
        );
        await this.flushRuntimeCheckpoints();
        return { agentId, accepted: true };
      },
    };
  }

  private interruptTool(callerThreadId: string): Tool {
    return {
      name: INTERRUPT_AGENT_TOOL,
      description:
        "Interrupt an agent's current turn and active descendants without closing their reusable threads.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        this.interruptFromOrThrow(callerThreadId, agentId);
        await this.flushRuntimeCheckpoints();
        return { agentId, interrupted: true };
      },
    };
  }

  private closeTool(callerThreadId: string): Tool {
    return {
      name: CLOSE_AGENT_TOOL,
      description:
        "Permanently close an agent thread and its descendant threads. Closed threads reject future collaboration actions.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        this.closeFromOrThrow(callerThreadId, agentId);
        await this.flushRuntimeCheckpoints();
        return { agentId, closed: true };
      },
    };
  }

  private nonRootRecords(): AgentTaskRecord[] {
    return [...this.records.values()].filter(
      ({ snapshot }) => snapshot.id !== this.rootId,
    );
  }

  private recordsForThread(threadId: string): AgentTaskRecord[] {
    return [...this.records.values()].filter(
      (record) => agentThreadId(record) === threadId,
    );
  }

  private currentRecordForThread(
    threadId: string,
  ): AgentTaskRecord | undefined {
    return this.recordsForThread(threadId).at(-1);
  }

  private directChildRecords(parentThreadId: string): AgentTaskRecord[] {
    return this.nonRootRecords().filter(
      ({ snapshot }) => snapshot.parentId === parentThreadId,
    );
  }

  private currentDirectChildRecords(parentThreadId: string): AgentTaskRecord[] {
    const records = new Map<string, AgentTaskRecord>();
    for (const record of this.directChildRecords(parentThreadId)) {
      records.set(agentThreadId(record), record);
    }
    return [...records.values()];
  }

  private currentAgentRecord(
    callerThreadId: string,
    reference: string,
  ): AgentTaskRecord | undefined {
    const target = this.lifecycleTarget(
      callerThreadId,
      reference,
      "agent lookup",
    );
    return target.records.at(-1);
  }

  private resolveCurrentAgentRecords(
    callerThreadId: string,
    agentIds: readonly string[],
  ): AgentTaskRecord[] {
    const records = agentIds.map((id) => {
      const target = this.lifecycleTarget(
        callerThreadId,
        id,
        "status inspection",
      );
      this.assertThreadOpen(target, id, "status inspection");
      const record = target.records.at(-1);
      if (!record) {
        throw lifecycleError("agent_not_attached", id, "status inspection");
      }
      return record;
    });
    return uniqueAgentRecords(records);
  }

  private waitRecords(
    callerThreadId: string,
    agentIds: readonly string[] | undefined,
  ): AgentTaskRecord[] {
    return agentIds
      ? this.resolveCurrentAgentRecords(callerThreadId, agentIds)
      : this.directChildRecords(callerThreadId).filter(
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

  private threadHasActiveRunById(threadId: string): boolean {
    const currentActive = this.recordsForThread(threadId).some(
      ({ snapshot }) => !isTerminal(snapshot.status),
    );
    if (currentActive) return true;
    const resumable = this.resumableThreads.get(threadId);
    return resumable ? !isTerminal(resumable.latestTask.status) : false;
  }

  private lifecycleTarget(
    callerThreadId: string,
    agentId: string,
    operation: string,
  ): AgentLifecycleTarget {
    const threadId = this.resolveThreadId(callerThreadId, agentId, operation);
    const records = this.recordsForThread(threadId);
    const resumable = this.resumableThreads.get(threadId);
    if (!threadId) {
      throw lifecycleError("agent_not_found", agentId, operation);
    }
    return {
      threadId,
      records,
      ...(resumable ? { resumable } : {}),
    };
  }

  private resolveThreadId(
    callerThreadId: string,
    reference: string,
    operation: string,
  ): string {
    const directRecord = this.records.get(reference);
    if (directRecord) return agentThreadId(directRecord);
    if (this.recordsForThread(reference).length > 0) return reference;
    const persistedThread =
      this.resumableTaskThreads.get(reference) ??
      (this.resumableThreads.has(reference) ? reference : undefined);
    if (persistedThread) return persistedThread;

    const addressable = new Map<
      string,
      { threadId: string; snapshot: AgentTaskSnapshot }
    >();
    for (const thread of this.resumableThreads.values()) {
      addressable.set(thread.agentThreadId, {
        threadId: thread.agentThreadId,
        snapshot: thread.latestTask,
      });
    }
    for (const record of this.currentLogicalRecords()) {
      const threadId = agentThreadId(record);
      addressable.set(threadId, { threadId, snapshot: record.snapshot });
    }
    const candidates = [...addressable.values()];
    const byPath = candidates.filter(
      ({ snapshot }) => snapshot.agentPath === reference,
    );
    if (byPath.length === 1) return byPath[0]!.threadId;

    const directChildren = this.currentDirectChildRecords(callerThreadId);
    const byRelativeName = directChildren.filter(
      ({ snapshot }) => snapshot.name === reference,
    );
    if (byRelativeName.length === 1) return agentThreadId(byRelativeName[0]!);

    const byGlobalName = candidates.filter(
      ({ snapshot }) => snapshot.name === reference,
    );
    if (byGlobalName.length === 1) return byGlobalName[0]!.threadId;
    if (
      byPath.length > 1 ||
      byRelativeName.length > 1 ||
      byGlobalName.length > 1
    ) {
      throw lifecycleError("agent_ambiguous", reference, operation);
    }
    throw lifecycleError("agent_not_found", reference, operation);
  }

  private currentLogicalRecords(): AgentTaskRecord[] {
    const records = new Map<string, AgentTaskRecord>();
    for (const record of this.records.values()) {
      records.set(agentThreadId(record), record);
    }
    return [...records.values()];
  }

  private assertThreadOpen(
    target: AgentLifecycleTarget,
    agentId: string,
    operation: string,
  ): void {
    if (this.threadClosedAt(target.threadId)) {
      throw lifecycleError("agent_closed", agentId, operation);
    }
    if (this.closed) {
      throw lifecycleError("agent_not_attached", agentId, operation);
    }
  }

  private assertLifecycleAuthority(
    callerThreadId: string,
    target: AgentLifecycleTarget,
    agentId: string,
    operation: string,
  ): void {
    const latest =
      target.records.at(-1)?.snapshot ?? target.resumable?.latestTask;
    const directChild = latest?.parentId === callerThreadId;
    if (
      target.threadId === this.rootId ||
      (callerThreadId !== this.rootId && !directChild)
    ) {
      throw lifecycleError(
        "agent_not_attached",
        agentId,
        operation,
        "lifecycle controls are limited to the caller's direct children",
      );
    }
  }

  private assertThreadContinuable(
    target: AgentLifecycleTarget,
    agentId: string,
    operation: string,
  ): void {
    this.assertThreadOpen(target, agentId, operation);
    if (this.threadHasActiveRunById(target.threadId)) {
      throw lifecycleError("agent_busy", agentId, operation);
    }
  }

  private threadClosedAt(threadId: string): string | undefined {
    return (
      this.threadClosures.get(threadId) ??
      this.recordsForThread(threadId).find(
        ({ snapshot }) => snapshot.closedAt !== undefined,
      )?.snapshot.closedAt ??
      this.resumableThreads.get(threadId)?.latestTask.closedAt
    );
  }

  private openAgentThreadCount(): number {
    const threadIds = new Set<string>();
    for (const thread of this.resumableThreads.values()) {
      if (!this.threadClosedAt(thread.agentThreadId)) {
        threadIds.add(thread.agentThreadId);
      }
    }
    for (const record of this.nonRootRecords()) {
      const threadId = agentThreadId(record);
      if (!this.threadClosedAt(threadId)) threadIds.add(threadId);
    }
    return threadIds.size;
  }

  private childThreadHistory(
    record: AgentTaskRecord,
  ): readonly ModelConversationMessage[] {
    const records = this.recordsForThread(agentThreadId(record));
    return [
      ...(records[0]?.history ?? []),
      ...records.flatMap(({ snapshot }) =>
        snapshot.output
          ? [
              { role: "user" as const, text: snapshot.task },
              { role: "assistant" as const, text: snapshot.output },
            ]
          : [],
      ),
    ];
  }

  private availableChildName(parentThreadId: string, base: string): string {
    const normalized = normalizedTaskName(base);
    const names = this.childNames(parentThreadId);
    if (!names.has(normalized)) return normalized;
    let suffix = 2;
    while (names.has(`${normalized}-${suffix}`)) suffix += 1;
    return `${normalized}-${suffix}`;
  }

  private assertChildNameAvailable(
    parentThreadId: string,
    name: string,
  ): string {
    if (this.childNames(parentThreadId).has(name)) {
      throw new Error(
        `Agent task name ${name} is already in use under ${this.callerLabel(parentThreadId)}`,
      );
    }
    return name;
  }

  private childNames(parentThreadId: string): Set<string> {
    const names = new Set(
      this.currentDirectChildRecords(parentThreadId).map(
        ({ snapshot }) => snapshot.name,
      ),
    );
    const parentPath =
      this.currentRecordForThread(parentThreadId)?.snapshot.agentPath;
    if (!parentPath) return names;
    for (const thread of this.resumableThreads.values()) {
      const task = thread.latestTask;
      if (this.threadClosedAt(thread.agentThreadId) || !task.agentPath)
        continue;
      if (parentAgentPath(task.agentPath) === parentPath) names.add(task.name);
    }
    return names;
  }

  private callerLabel(threadId: string): string {
    return (
      this.currentRecordForThread(threadId)?.snapshot.agentPath ?? threadId
    );
  }

  private agentMessage(
    callerThreadId: string,
    targetReference: string,
    text: string,
    delivery: AgentTaskMessage["delivery"],
  ): AgentTaskMessage {
    const caller = this.currentRecordForThread(callerThreadId);
    if (!caller) {
      throw lifecycleError(
        "agent_not_attached",
        callerThreadId,
        "message delivery",
      );
    }
    const targetThreadId = this.resolveThreadId(
      callerThreadId,
      targetReference,
      "message delivery",
    );
    if (targetThreadId === callerThreadId) {
      throw new Error("An agent cannot send a collaboration message to itself");
    }
    return {
      id: randomUUID(),
      fromAgentId: caller.snapshot.id,
      fromAgentThreadId: callerThreadId,
      fromAgentName: caller.snapshot.name,
      toAgentThreadId: targetThreadId,
      text,
      createdAt: this.wallNow().toISOString(),
      delivery,
    };
  }

  private sendMessageOrThrow(
    callerThreadId: string,
    targetReference: string,
    text: string,
  ): AgentTaskMessage {
    const target = this.lifecycleTarget(
      callerThreadId,
      targetReference,
      "message delivery",
    );
    this.assertThreadOpen(target, targetReference, "message delivery");
    const record = target.records.at(-1);
    if (!record || isTerminal(record.snapshot.status)) {
      throw lifecycleError(
        "agent_not_attached",
        targetReference,
        "active message delivery",
        "use followup_task to wake an idle agent",
      );
    }
    const message = this.agentMessage(
      callerThreadId,
      targetReference,
      text,
      "active",
    );
    record.pendingInput.push(formatAgentMessage(message));
    this.patchRecord(record, "messaged", {
      latestActivity: `Message from ${message.fromAgentName}`,
      messages: [...(record.snapshot.messages ?? []), message],
    });
    this.scheduleRuntimeCheckpoint();
    return message;
  }

  private subtreeThreadIds(threadId: string): Set<string> {
    const descendants = new Set([threadId]);
    const candidates = [
      ...this.currentLogicalRecords().map(({ snapshot }) => snapshot),
      ...[...this.resumableThreads.values()].map(
        ({ latestTask }) => latestTask,
      ),
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of candidates) {
        const candidateThreadId = candidate.agentThreadId ?? candidate.id;
        if (
          candidate.parentId &&
          descendants.has(candidate.parentId) &&
          !descendants.has(candidateThreadId)
        ) {
          descendants.add(candidateThreadId);
          changed = true;
        }
      }
    }
    return descendants;
  }

  private subtreeActiveRecords(threadId: string): AgentTaskRecord[] {
    const subtree = this.subtreeThreadIds(threadId);
    return this.nonRootRecords().filter(
      (record) =>
        subtree.has(agentThreadId(record)) &&
        !isTerminal(record.snapshot.status),
    );
  }

  private cancelSubtree(record: AgentTaskRecord, reason: string): void {
    for (const member of this.subtreeActiveRecords(agentThreadId(record))) {
      member.controller.abort(new Error(reason));
      if (member.snapshot.status === "queued") {
        this.removeFromQueue(member.snapshot.id);
      }
      this.detachChildExecution(member);
      this.cancelRecord(member, reason);
    }
  }

  private cancelRemaining(reason: string): void {
    for (const record of this.nonRootRecords()) {
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
    if (
      this.running.has(record.snapshot.id) &&
      record.profile?.toolAccess === "all"
    ) {
      this.detachedWriters.add(record.snapshot.id);
    }
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
    private readonly callerThreadId: string,
    private readonly callerTaskId: string,
    private readonly root: boolean,
    private readonly delegate?: RunController,
  ) {}

  beforeModel(
    context: RunControllerContext,
  ): Promise<RunControllerModelDirective> {
    return Promise.resolve(this.delegate?.beforeModel?.(context) ?? {}).then(
      (directive) => {
        if (this.root) this.orchestrator.syncRootTools(context.tools);
        return directive;
      },
    );
  }

  async beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): Promise<RunControllerToolDecision> {
    const ownership = this.orchestrator.writeDecision(
      this.callerTaskId,
      call,
      tool,
    );
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
    return (
      delegated ??
      this.orchestrator.completionBlocker(this.callerThreadId, this.root)
    );
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
    maxDepth: _maxDepth,
    resumableThreads: _resumableThreads,
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
  collaborationTools: readonly Tool[],
): readonly Tool[] {
  const excluded = new Set(profile.excludedTools ?? []);
  const base = tools.filter(
    (tool) =>
      !COLLABORATION_TOOLS.has(tool.name) &&
      !excluded.has(tool.name) &&
      (profile.toolAccess === "all" || tool.mutability === "read"),
  );
  const collaboration = collaborationTools.filter(
    (tool) => !excluded.has(tool.name),
  );
  const combined = [...base, ...collaboration];
  assertUniqueToolNames(combined);
  return combined;
}

function delegationInstructions(
  profiles: readonly SubagentProfile[],
  maxConcurrent: number,
): string {
  return [
    "MULTI-AGENT DELEGATION",
    "Delegate only concrete, independent work that benefits from parallel execution or focused context. Keep small sequential work in the parent agent.",
    `At most ${maxConcurrent} agents run concurrently. Start direct children with ${SPAWN_AGENT_TOOL}, continue useful work, then use ${CHECK_AGENTS_TOOL} for status or ${WAIT_FOR_AGENTS_TOOL} for a bounded wait before using their findings or finishing.`,
    `Give spawned work a stable taskName when another agent may need to address it. Targets accept task IDs, stable thread IDs, caller-relative task names, or canonical paths such as /root/research/api_review.`,
    `Use ${SEND_MESSAGE_TOOL} for a running agent and ${FOLLOWUP_TASK_TOOL} to wake an idle agent in its existing context. Use ${STEER_AGENT_TOOL} for parent-style direction.`,
    `Use ${FOLLOW_UP_AGENT_TOOL} only as the legacy alias for ${FOLLOWUP_TASK_TOOL}; use ${SPAWN_AGENT_TOOL} for independent work.`,
    `Use ${RETRY_AGENT_TOOL} to rerun a finished or interrupted turn from fresh provider state while retaining its thread linkage.`,
    `Agent threads persist for the whole parent conversation: finishing a child turn does not delete or close its thread. Use ${INTERRUPT_AGENT_TOOL} to stop only the current turn while keeping the thread reusable. Use ${CLOSE_AGENT_TOOL} only when no more work or results are needed from that thread.`,
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
    ...(snapshot.messages
      ? { messages: snapshot.messages.map((message) => ({ ...message })) }
      : {}),
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
    agentPath?: string;
    parentId?: string;
    name: string;
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
    ...(snapshot.agentPath ? { agentPath: snapshot.agentPath } : {}),
    ...(snapshot.parentId ? { parentId: snapshot.parentId } : {}),
    name: snapshot.name,
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

function collaborationMessageParameters(
  messageDescription: string,
): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "Agent task ID, stable thread ID, caller-relative task name, or canonical path",
      },
      message: {
        type: "string",
        minLength: 1,
        description: messageDescription,
      },
    },
    required: ["target", "message"],
    additionalProperties: false,
  };
}

function taskNameArgument(value: unknown): string {
  const name = stringArgument(value, "taskName");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(
      "taskName must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores, or hyphens",
    );
  }
  return name;
}

function normalizedTaskName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "agent";
}

function agentDepth(path: string | undefined): number {
  if (!path) return 0;
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

function parentAgentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/root" : path.slice(0, index);
}

function formatAgentMessage(message: AgentTaskMessage): string {
  return [
    `Message from ${message.fromAgentName} (${message.fromAgentThreadId}):`,
    message.text,
  ].join("\n");
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

function lifecycleError(
  code: AgentLifecycleErrorCode,
  agentId: string,
  operation: string,
  detail?: string,
): ToolExecutionError {
  const message =
    code === "agent_busy"
      ? `Agent ${agentId} already has an active run and is unavailable for ${operation}`
      : code === "agent_ambiguous"
        ? `Agent reference ${agentId} is ambiguous for ${operation}; use its stable thread ID or canonical path`
        : code === "agent_closed"
          ? `Agent ${agentId} is closed and unavailable for ${operation}`
          : code === "agent_not_found"
            ? `Agent ${agentId} was not found for ${operation}`
            : code === "agent_state_unavailable"
              ? `Agent ${agentId} state is unavailable for ${operation}${detail ? `: ${detail}` : ""}`
              : code === "agent_write_conflict"
                ? `Agent ${agentId} cannot perform ${operation}${detail ? `: ${detail}` : ""}`
                : `Agent ${agentId} is not attached to the current orchestrator for ${operation}${detail ? `: ${detail}` : ""}`;
  return new ToolExecutionError(message, {
    code,
    retryable: code === "agent_busy" || code === "agent_not_attached",
  });
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
