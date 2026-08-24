import { randomUUID } from "node:crypto";

import { AgentLoop } from "./agent-loop.js";
import {
  CHECK_AGENTS_TOOL,
  CLOSE_AGENT_TOOL,
  COLLABORATION_TOOLS,
  DEFAULT_AGENT_WAIT_TIMEOUT_MS,
  MAX_AGENT_WAIT_TIMEOUT_MS,
  FOLLOWUP_TASK_TOOL,
  FOLLOW_UP_AGENT_TOOL,
  INTERRUPT_AGENT_TOOL,
  RETRY_AGENT_TOOL,
  SEND_MESSAGE_TOOL,
  SPAWN_AGENT_TOOL,
  STEER_AGENT_TOOL,
  WAIT_FOR_AGENTS_TOOL,
  collaborationInputParameters,
  collaborationMessageParameters,
  collaborationTargetParameters,
  collaborationTargetsParameters,
  delegationInstructions,
  assertUniqueToolNames,
  normalizedTaskName,
  objectArguments,
  optionalAgentIds,
  stringArgument,
  taskNameArgument,
  waitTimeoutArgument,
} from "./collaboration-contract.js";
import {
  addUsage,
  cloneSnapshot,
  ensureModelTranscript,
  modelTranscriptId,
  modelRetryProgress,
  normalizedTokenUsage,
  serializeTranscriptValue,
  summarize,
  transcriptField,
  truncate,
  updateTranscript,
} from "./orchestration-transcript.js";
import { ToolExecutionError } from "./tool-error.js";
import { CollaborationToolFactory } from "./orchestrator-tools.js";
import { createChildAgent } from "./orchestrator-context.js";
import { AgentTaskRegistry } from "./agent-task-registry.js";
import { AgentTaskState } from "./agent-task-state.js";
import {
  OrchestrationRunController,
  agentDepth,
  combineSignals,
  deferred,
  elapsedSince,
  errorMessage,
  formatAgentMessage,
  lifecycleError,
  parentAgentPath,
  positiveInteger,
  removeFromQueue,
  rootRunOptions,
} from "./orchestrator-runtime.js";

import {
  agentThreadId,
  isTerminal,
  uniqueAgentRecords,
} from "./orchestrator-records.js";
import type {
  AgentLifecycleTarget,
  AgentMailboxEvent,
  AgentMailboxWaiter,
  AgentTaskRecord,
  Deferred,
  SpawnOptions,
} from "./orchestrator-types.js";
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
        ...(record.contextTokens !== undefined && {
          contextTokens: record.contextTokens,
        }),
        ...(record.contextHistory && { contextHistory: record.contextHistory }),
        ...(record.fullOutput === undefined
          ? {}
          : { fullOutput: record.fullOutput }),
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
            this.taskState().scheduleRuntimeCheckpoint();
            await this.flushRuntimeCheckpoints();
            return message;
          }
          return runOptions.takeAdditionalInput?.();
        },
        onCheckpoint: async (checkpoint) => {
          this.taskState().recordCheckpoint(root, checkpoint);
          await runOptions.onCheckpoint?.(checkpoint);
          await this.flushRuntimeCheckpoints();
        },
        onEvent: (event) => {
          this.updateFromAgentEvent(root, event);
          this.options.onEvent?.(event);
        },
      });
      this.taskState().completeRecord(root, result);
      this.closed = true;
      await this.flushRuntimeCheckpoints();
      return {
        ...result,
        usage: this.taskRegistry()
          .nonRootRecords()
          .reduce((usage, { snapshot }) => addUsage(usage, snapshot.usage), {
            ...result.usage,
          }),
      };
    } catch (error) {
      this.taskState().failRecord(root, error);
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
      record = this.taskRegistry().currentAgentRecord(this.rootId, agentId);
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
    this.taskState().scheduleRuntimeCheckpoint();
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
    const target = this.taskRegistry().lifecycleTarget(
      callerThreadId,
      agentId,
      "steering",
    );
    this.taskRegistry().assertLifecycleAuthority(
      callerThreadId,
      target,
      agentId,
      "steering",
    );
    this.taskRegistry().assertThreadOpen(target, agentId, "steering");
    const record = target.records.at(-1);
    if (!record || isTerminal(record.snapshot.status)) {
      throw lifecycleError("agent_not_attached", agentId, "steering");
    }
    record.pendingInput.push(instruction);
    this.taskState().patchRecord(record, "steered", {
      latestActivity: "Direction updated",
    });
    this.taskState().scheduleRuntimeCheckpoint();
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
    const target = this.taskRegistry().lifecycleTarget(
      callerThreadId,
      agentId,
      "retry",
    );
    this.taskRegistry().assertLifecycleAuthority(
      callerThreadId,
      target,
      agentId,
      "retry",
    );
    this.taskRegistry().assertThreadContinuable(target, agentId, "retry");
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
      latestTask.parentId &&
      this.taskRegistry().currentRecordForThread(latestTask.parentId)
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
    const target = this.taskRegistry().lifecycleTarget(
      callerThreadId,
      agentId,
      "follow-up",
    );
    this.taskRegistry().assertFollowUpAuthority(
      callerThreadId,
      target,
      agentId,
    );
    this.taskRegistry().assertThreadContinuable(target, agentId, "follow-up");
    const previous = target.records.at(-1);
    const latestTask = previous?.snapshot ?? target.resumable?.latestTask;
    const profileName =
      previous?.profile?.name ?? target.resumable?.profileName;
    const modelState = previous?.modelState ?? target.resumable?.modelState;
    const contextTokens =
      previous?.contextTokens ?? target.resumable?.contextTokens;
    const history = previous
      ? this.taskRegistry().childThreadHistory(previous)
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
      latestTask.parentId &&
      this.taskRegistry().currentRecordForThread(latestTask.parentId)
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
      contextTokens,
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
    const target = this.taskRegistry().lifecycleTarget(
      callerThreadId,
      agentId,
      "interruption",
    );
    this.taskRegistry().assertLifecycleAuthority(
      callerThreadId,
      target,
      agentId,
      "interruption",
    );
    this.taskRegistry().assertThreadOpen(target, agentId, "interruption");
    const record = target.records.at(-1);
    if (!record || isTerminal(record.snapshot.status)) {
      throw lifecycleError("agent_not_attached", agentId, "interruption");
    }
    for (const member of this.taskRegistry().subtreeActiveRecords(
      target.threadId,
    )) {
      member.controller.abort(new Error("Agent interrupted by collaborator"));
      if (member.snapshot.status === "queued") {
        removeFromQueue(this.queue, member.snapshot.id);
      }
      this.detachChildExecution(member);
      this.taskState().interruptRecord(member, "Interrupted by collaborator");
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
    const target = this.taskRegistry().lifecycleTarget(
      callerThreadId,
      agentId,
      "close",
    );
    this.taskRegistry().assertLifecycleAuthority(
      callerThreadId,
      target,
      agentId,
      "close",
    );
    this.taskRegistry().assertThreadOpen(target, agentId, "close");
    if (
      target.records.length === 0 &&
      target.resumable &&
      !isTerminal(target.resumable.latestTask.status)
    ) {
      throw lifecycleError("agent_not_attached", agentId, "close");
    }
    const closedAt = this.wallNow().toISOString();
    const subtree = this.taskRegistry().subtreeThreadIds(target.threadId);
    for (const threadId of subtree) this.threadClosures.set(threadId, closedAt);
    for (const record of this.taskRegistry()
      .nonRootRecords()
      .filter((candidate) => subtree.has(agentThreadId(candidate)))) {
      record.collected = true;
      if (!isTerminal(record.snapshot.status)) {
        record.controller.abort(new Error("Agent thread closed by parent"));
        if (record.snapshot.status === "queued") {
          removeFromQueue(this.queue, record.snapshot.id);
        }
        this.detachChildExecution(record);
        this.taskState().cancelRecord(record, "Closed by parent agent");
      }
      this.taskState().patchRecord(record, "closed", {
        closedAt,
        latestActivity: "Closed",
      });
    }
    this.taskState().scheduleRuntimeCheckpoint();
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
      ? this.taskRegistry().nonRootRecords()
      : this.taskRegistry().directChildRecords(callerThreadId);
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
    const record = this.taskState().createRecord({
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
    this.taskState().emit(record, "created");
    this.taskState().scheduleRuntimeCheckpoint();
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
      this.taskRegistry().openAgentThreadCount() >= this.maxAgents
    ) {
      throw new Error(`Subagent limit reached (${this.maxAgents})`);
    }
    const profile = this.profiles.get(profileName);
    if (!profile) throw new Error(`Unknown subagent profile: ${profileName}`);
    const parentId = options.parentId ?? this.rootId;
    const callerId = options.callerId ?? parentId;
    const parent = this.taskRegistry().currentRecordForThread(parentId);
    const caller = this.taskRegistry().currentRecordForThread(callerId);
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
        ? this.taskRegistry().assertChildNameAvailable(parentId, options.name)
        : this.taskRegistry().availableChildName(parentId, profile.name);
    const agentPath =
      options.agentPath ?? `${parent.snapshot.agentPath ?? "/root"}/${name}`;
    const record = this.taskState().createRecord(
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
    record.contextTokens = options.contextTokens;
    record.history = options.history;
    this.queue.push(id);
    this.taskState().emit(
      record,
      options.followUpOf ? "followed_up" : "created",
    );
    this.taskState().scheduleRuntimeCheckpoint();
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
    this.taskState().patchRecord(record, "started", {
      status: "running",
      phase: "thinking",
      startedAt,
      latestActivity: "Thinking",
    });
    this.taskState().scheduleRuntimeCheckpoint();
    const childOptions = this.options.createChildRunOptions?.({
      agentId: record.snapshot.id,
      parentId: record.snapshot.parentId ?? this.rootId,
      profile,
      contextTokens: record.contextTokens,
    });
    const signal = combineSignals(this.rootSignal, record.controller.signal);
    const leaf =
      profile.leaf === true ||
      agentDepth(record.snapshot.agentPath) >= this.maxDepth;
    const childAgent = createChildAgent({
      rootAgent,
      profile,
      name: record.snapshot.name,
      agentIdentity: record.snapshot.agentPath ?? record.snapshot.name,
      agentThreadId: agentThreadId(record),
      leaf,
      instructionCapsule: childOptions?.instructionCapsule,
      profiles: [...this.profiles.values()],
      maxConcurrent: this.maxConcurrent,
      collaborationTools: this.collaborationTools(agentThreadId(record)),
    });
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
            this.taskState().scheduleRuntimeCheckpoint();
            await this.flushRuntimeCheckpoints();
          }
          return input;
        },
        onCheckpoint: async (checkpoint) => {
          this.taskState().recordCheckpoint(record, checkpoint);
          await delegatedCheckpoint?.(checkpoint);
          await this.flushRuntimeCheckpoints();
        },
        onEvent: (event) => this.updateFromAgentEvent(record, event),
      })
      .then(async (result) => {
        this.taskState().completeRecord(record, result);
        await this.flushRuntimeCheckpoints();
      })
      .catch(async (error: unknown) => {
        if (record.controller.signal.aborted || this.rootSignal?.aborted) {
          this.taskState().cancelRecord(record, errorMessage(error));
        } else {
          this.taskState().failRecord(record, error);
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
      this.taskState().patchRecord(record, "progress", { runId: event.runId });
      return;
    }
    if (event.type === "model.started") {
      const transcript = ensureModelTranscript(
        record.snapshot.transcript,
        event.step,
        this.wallNow().toISOString(),
      );
      this.taskState().patchRecord(record, "progress", {
        phase: "thinking",
        latestActivity: "Thinking",
        transcript,
      });
      return;
    }
    if (event.type === "model.retrying") {
      this.taskState().patchRecord(
        record,
        "progress",
        modelRetryProgress(record.snapshot, event),
      );
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
                text: transcriptField(`${entry.text}${event.delta}`),
                ...(event.ttftMs === undefined ? {} : { ttftMs: event.ttftMs }),
                ...(event.outputVisibility
                  ? { outputVisibility: event.outputVisibility }
                  : {}),
              }
            : entry,
      );
      this.taskState().patchRecord(record, "progress", {
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
                text: transcriptField(event.text),
                completedAt,
                ...(event.durationMs === undefined
                  ? {}
                  : { durationMs: event.durationMs }),
                ...(event.ttftMs === undefined ? {} : { ttftMs: event.ttftMs }),
                ...(event.usage
                  ? { usage: normalizedTokenUsage(event.usage) }
                  : {}),
                ...(event.outputVisibility
                  ? { outputVisibility: event.outputVisibility }
                  : {}),
              }
            : entry,
      );
      this.taskState().patchRecord(record, "progress", {
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
          arguments: transcriptField(
            serializeTranscriptValue(event.call.arguments),
          ),
          startedAt: this.wallNow().toISOString(),
        },
      ];
      this.taskState().patchRecord(record, "progress", {
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
                output: transcriptField(event.result.output),
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
      this.taskState().patchRecord(record, "progress", {
        phase: "thinking",
        latestActivity: event.result.name,
        activities,
        transcript,
      });
    }
  }

  private taskState(): AgentTaskState {
    return new AgentTaskState({
      records: this.records,
      wallNow: this.wallNow,
      snapshot: this.snapshot,
      runtimeSnapshot: this.runtimeSnapshot,
      mailboxWaiters: this.mailboxWaiters,
      onAgentTreeEvent: this.options.onAgentTreeEvent,
      queueRuntimeCheckpoint: (checkpoint) => {
        const persist = this.options.onRuntimeCheckpoint;
        if (!persist) return;
        this.runtimeCheckpointWrites = this.runtimeCheckpointWrites.then(() =>
          persist(checkpoint),
        );
      },
    });
  }

  private collaborationTools(callerThreadId: string): Tool[] {
    return new CollaborationToolFactory({
      profileNames: [...this.profiles.keys()],
      spawn: (role, task, options) => this.spawn(role, task, options),
      flushRuntimeCheckpoints: () => this.flushRuntimeCheckpoints(),
      sendMessageOrThrow: (caller, target, text) =>
        this.taskRegistry().sendMessageOrThrow(caller, target, text),
      agentMessage: (caller, target, text, kind) =>
        this.taskRegistry().agentMessage(caller, target, text, kind),
      followUpFromOrThrow: (caller, target, text, message) =>
        this.followUpFromOrThrow(caller, target, text, message),
      retryFromOrThrow: (caller, target) =>
        this.retryFromOrThrow(caller, target),
      resolveCurrentAgentRecords: (caller, ids) =>
        this.taskRegistry().resolveCurrentAgentRecords(caller, ids),
      readAgentResultOrThrow: (caller, target) =>
        this.taskRegistry().readAgentResultOrThrow(caller, target),
      currentDirectChildRecords: (caller) =>
        this.taskRegistry().currentDirectChildRecords(caller),
      waitRecords: (caller, ids) =>
        this.taskRegistry().waitRecords(caller, ids),
      waitForMailbox: (ids, timeout, signal) =>
        this.taskRegistry().waitForMailbox(ids, timeout, signal),
      scheduleRuntimeCheckpoint: () =>
        this.taskState().scheduleRuntimeCheckpoint(),
      steerFromOrThrow: (caller, target, input) =>
        this.steerFromOrThrow(caller, target, input),
      interruptFromOrThrow: (caller, target) =>
        this.interruptFromOrThrow(caller, target),
      closeFromOrThrow: (caller, target) =>
        this.closeFromOrThrow(caller, target),
    }).tools(callerThreadId);
  }

  private taskRegistry(): AgentTaskRegistry {
    return new AgentTaskRegistry({
      records: this.records,
      rootId: this.rootId,
      resumableThreads: this.resumableThreads,
      resumableTaskThreads: this.resumableTaskThreads,
      threadClosures: this.threadClosures,
      wallNow: this.wallNow,
      maxDepth: this.maxDepth,
      mailboxWaiters: this.mailboxWaiters,
      closed: this.closed,
      profiles: this.profiles,
      emit: (record, reason) => this.taskState().emit(record, reason),
      patchRecord: (record, reason, patch) =>
        this.taskState().patchRecord(record, reason, patch),
      scheduleRuntimeCheckpoint: () =>
        this.taskState().scheduleRuntimeCheckpoint(),
    });
  }

  private cancelSubtree(record: AgentTaskRecord, reason: string): void {
    for (const member of this.taskRegistry().subtreeActiveRecords(
      agentThreadId(record),
    )) {
      member.controller.abort(new Error(reason));
      if (member.snapshot.status === "queued") {
        removeFromQueue(this.queue, member.snapshot.id);
      }
      this.detachChildExecution(member);
      this.taskState().cancelRecord(member, reason);
    }
  }

  private cancelRemaining(reason: string): void {
    for (const record of this.taskRegistry().nonRootRecords()) {
      if (isTerminal(record.snapshot.status)) continue;
      record.controller.abort(new Error(reason));
      if (record.snapshot.status === "queued") {
        removeFromQueue(this.queue, record.snapshot.id);
      }
      this.detachChildExecution(record);
      this.taskState().cancelRecord(record, reason);
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
}
