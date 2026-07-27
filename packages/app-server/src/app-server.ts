import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type {
  Agent,
  AgentEvent,
  AgentLoop,
  Tool,
} from "@threadlight/agent-loop";
import {
  appendActivityDetail,
  formatComputerToolInput,
  formatComputerToolResult,
} from "@threadlight/protocol";

import type {
  ConversationActivityData,
  AttachmentData,
  ConversationMessageData,
  ConversationProgressData,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  ProcessSnapshotData,
  SendMessage,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
} from "./protocol.js";
import {
  MemoryConversationStore,
  type ConversationStore,
  type StoredConversation,
} from "./conversation-store.js";

interface ThreadState {
  agent: Agent;
  conversation: StoredConversation;
  progress: MutableConversationProgress[];
  runtime?: ThreadRuntime;
  activeTurn?: {
    id: string;
    controller: AbortController;
  };
}

interface MutableConversationProgress {
  text: string;
  activities: ConversationActivityData[];
}

export interface ProcessController {
  status(sessionId: string): ProcessSnapshotData | Promise<ProcessSnapshotData>;
  read(sessionId: string): ProcessSnapshotData | Promise<ProcessSnapshotData>;
  wait(
    sessionId: string,
    timeoutMs?: number,
  ): ProcessSnapshotData | Promise<ProcessSnapshotData>;
  kill(sessionId: string): ProcessSnapshotData | Promise<ProcessSnapshotData>;
}

interface SharedAppServerOptions {
  loop: AgentLoop;
  send: SendMessage;
  conversationStore?: ConversationStore;
  processes?: ProcessController;
  threadRuntimeFactory?: ThreadRuntimeFactory;
  now?: () => Date;
  attachmentRoot?: string;
  turnCleanup?(context: TurnCleanupContext): void | Promise<void>;
}

export type AgentFactory = () => Agent | Promise<Agent>;

export interface TurnCleanupContext {
  threadId: string;
  turnId: string;
  runId?: string;
}

export interface ThreadRuntime {
  tools?: readonly Tool[];
  dispose?(): void | Promise<void>;
}

export type ThreadRuntimeFactory = () =>
  | ThreadRuntime
  | Promise<ThreadRuntime>;

export type AppServerOptions = SharedAppServerOptions &
  (
    | { agent: Agent; agentFactory?: never }
    | { agent?: never; agentFactory: AgentFactory }
  );

export class AppServer {
  private readonly loop: AgentLoop;
  private readonly agentFactory: AgentFactory;
  private readonly send: SendMessage;
  private readonly conversationStore: ConversationStore;
  private readonly processes?: ProcessController;
  private readonly threadRuntimeFactory?: ThreadRuntimeFactory;
  private readonly now: () => Date;
  private readonly attachmentRoot?: string;
  private readonly turnCleanup?: SharedAppServerOptions["turnCleanup"];
  private readonly threads = new Map<string, ThreadState>();
  private initialized = false;

  constructor(options: AppServerOptions) {
    this.loop = options.loop;
    this.agentFactory = options.agentFactory ?? (() => options.agent);
    this.send = options.send;
    this.conversationStore =
      options.conversationStore ?? new MemoryConversationStore();
    this.processes = options.processes;
    this.threadRuntimeFactory = options.threadRuntimeFactory;
    this.now = options.now ?? (() => new Date());
    this.attachmentRoot = options.attachmentRoot
      ? resolve(options.attachmentRoot)
      : undefined;
    this.turnCleanup = options.turnCleanup;
  }

  async receive(message: JsonRpcRequest): Promise<void> {
    const id = message.id;

    try {
      if (!this.initialized && message.method !== "initialize") {
        throw new RpcError(-32002, "Server is not initialized");
      }

      const result = await this.dispatch(message.method, message.params);
      if (id !== undefined) this.reply(id, result);
    } catch (error) {
      if (id === undefined) return;

      const rpcError =
        error instanceof RpcError
          ? error
          : new RpcError(
              -32603,
              error instanceof Error ? error.message : String(error),
            );

      this.replyError(id, rpcError);
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        this.initialized = true;
        return { name: "threadlight", protocolVersion: "0.1" };
      case "thread/start":
        return this.startThread();
      case "thread/resume":
        return this.resumeThread(params);
      case "thread/delete":
        return this.deleteThread(params);
      case "turn/start":
        return this.startTurn(params);
      case "turn/interrupt":
        return this.interruptTurn(params);
      case "process/status":
        return this.processRequest(params, "status");
      case "process/read":
        return this.processRequest(params, "read");
      case "process/wait":
        return this.processRequest(params, "wait");
      case "process/kill":
        return this.processRequest(params, "kill");
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async startThread(): Promise<{ threadId: string }> {
    const threadId = randomUUID();
    const timestamp = this.now().toISOString();
    const conversation: StoredConversation = {
      version: 1,
      threadId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    this.threads.set(
      threadId,
      await this.createThreadState(conversation),
    );
    return { threadId };
  }

  private async resumeThread(
    params: unknown,
  ): Promise<{ threadId: string; messages: readonly ConversationMessageData[] }> {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    let thread = this.threads.get(threadId);
    if (!thread) {
      const conversation = await this.conversationStore.load(threadId);
      if (conversation) {
        thread = await this.createThreadState(conversation);
        this.threads.set(threadId, thread);
      }
    }
    if (!thread) {
      throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    }
    return { threadId, messages: thread.conversation.messages };
  }

  private async deleteThread(
    params: unknown,
  ): Promise<{ deleted: boolean }> {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    const thread = this.threads.get(threadId);
    if (thread?.activeTurn) {
      throw new RpcError(-32003, "Cannot delete a thread with an active turn");
    }

    const deletedFromStore = await this.conversationStore.delete(threadId);
    if (thread) await this.disposeThreadRuntime(thread);
    this.threads.delete(threadId);
    return { deleted: !!thread || deletedFromStore };
  }

  async dispose(): Promise<void> {
    for (const thread of this.threads.values()) {
      thread.activeTurn?.controller.abort(
        new Error("App server is shutting down"),
      );
    }
    await Promise.all(
      [...this.threads.values()].map((thread) =>
        this.disposeThreadRuntime(thread),
      ),
    );
    this.threads.clear();
  }

  private async startTurn(params: unknown): Promise<{ turnId: string }> {
    const {
      threadId,
      input,
      attachments: attachmentValue,
    } = objectParams(params);
    requireString(threadId, "threadId");
    if (typeof input !== "string") {
      throw new RpcError(-32602, "input must be a string");
    }
    const attachments = parseAttachments(attachmentValue);
    for (const attachment of attachments) {
      this.requireLocalAttachment(attachment);
    }
    if (!input.trim() && attachments.length === 0) {
      throw new RpcError(-32602, "A turn requires text or an attachment");
    }

    const thread = this.threads.get(threadId);
    if (!thread) throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    if (thread.activeTurn) {
      throw new RpcError(-32003, "Thread already has an active turn");
    }

    const turnId = randomUUID();
    const controller = new AbortController();
    thread.activeTurn = { id: turnId, controller };
    thread.progress = [];
    const startedConversation = this.updateConversation(thread.conversation, [
      ...thread.conversation.messages,
      {
        id: randomUUID(),
        role: "user",
        text: input,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    ]);
    try {
      await this.conversationStore.save(startedConversation);
      thread.conversation = startedConversation;
    } catch (error) {
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
      throw error;
    }

    queueMicrotask(() => {
      void this.runTurn(
        threadId,
        turnId,
        input,
        attachments,
        thread,
        controller,
      );
    });

    return { turnId };
  }

  private interruptTurn(params: unknown): { interrupted: boolean } {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    const activeTurn = this.threads.get(threadId)?.activeTurn;
    if (!activeTurn) return { interrupted: false };

    activeTurn.controller.abort(new Error("Turn interrupted by client"));
    return { interrupted: true };
  }

  private requireLocalAttachment(attachment: AttachmentData): void {
    try {
      const path = realpathSync(attachment.path);
      if (!statSync(path).isFile()) throw new Error("not a file");
      if (this.attachmentRoot) {
        const root = realpathSync(this.attachmentRoot);
        if (!path.startsWith(`${root}${sep}`)) throw new Error("outside root");
      }
    } catch {
      throw new RpcError(
        -32602,
        this.attachmentRoot
          ? "attachment path must be an uploaded file in the active project"
          : "attachment path must be a readable local file",
      );
    }
  }

  private async processRequest(
    params: unknown,
    action: "status" | "read" | "wait" | "kill",
  ): Promise<ProcessSnapshotData> {
    if (!this.processes) {
      throw new RpcError(-32020, "Process management is not available");
    }
    const { sessionId, timeoutMs } = objectParams(params);
    requireString(sessionId, "sessionId");
    if (
      timeoutMs !== undefined &&
      (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1)
    ) {
      throw new RpcError(-32602, "timeoutMs must be a positive integer");
    }

    const snapshot =
      action === "wait"
        ? await this.processes.wait(
            sessionId,
            timeoutMs === undefined ? undefined : Number(timeoutMs),
          )
        : await this.processes[action](sessionId);
    await this.recordProcessSnapshot(snapshot);
    return snapshot;
  }

  private async recordProcessSnapshot(
    snapshot: ProcessSnapshotData,
  ): Promise<void> {
    for (const thread of this.threads.values()) {
      updateMutableProcessSnapshots(thread.progress, snapshot);
      const messages = updateStoredProcessSnapshots(
        thread.conversation.messages,
        snapshot,
      );
      if (messages === thread.conversation.messages) continue;
      const conversation = this.updateConversation(thread.conversation, messages);
      await this.conversationStore.save(conversation);
      thread.conversation = conversation;
    }
  }

  private async runTurn(
    threadId: string,
    turnId: string,
    input: string,
    attachments: readonly AttachmentData[],
    thread: ThreadState,
    controller: AbortController,
  ): Promise<void> {
    this.notify("turn/started", { threadId, turnId });
    let runId: string | undefined;
    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await this.cleanupTurn({ threadId, turnId, runId });
    };

    try {
      const result = await this.loop.run(thread.agent, input, {
        modelState: thread.conversation.modelState,
        attachments,
        signal: controller.signal,
        onEvent: (event) => {
          runId = event.runId;
          this.forwardEvent(threadId, turnId, thread, event);
        },
      });

      const completedConversation = this.updateConversation(
        thread.conversation,
        [
          ...thread.conversation.messages,
          {
            id: randomUUID(),
            role: "assistant",
            text: result.output,
            ...(thread.progress.length > 0
              ? { progress: snapshotProgress(thread.progress) }
              : {}),
          },
        ],
        { modelState: result.modelState },
      );
      await this.conversationStore.save(completedConversation);
      thread.conversation = completedConversation;
      await cleanup();
      this.notify("turn/completed", {
        threadId,
        turnId,
        output: result.output,
        usage: result.usage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      thread.conversation = this.updateConversation(thread.conversation, [
        ...thread.conversation.messages,
        {
          id: randomUUID(),
          role: "assistant",
          text: message,
          error: true,
          ...(thread.progress.length > 0
            ? { progress: snapshotProgress(thread.progress) }
            : {}),
        },
      ]);
      try {
        await this.conversationStore.save(thread.conversation);
      } catch (persistenceError) {
        process.stderr.write(
          `Could not persist failed conversation ${threadId}: ${String(persistenceError)}\n`,
        );
      }
      await cleanup();
      this.notify("turn/failed", {
        threadId,
        turnId,
        error: message,
      });
    } finally {
      await cleanup();
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
    }
  }

  private async cleanupTurn(context: TurnCleanupContext): Promise<void> {
    if (!this.turnCleanup) return;
    try {
      await this.turnCleanup(context);
    } catch (error) {
      process.stderr.write(
        `Could not clean up turn ${context.turnId}: ${String(error)}\n`,
      );
    }
  }

  private forwardEvent(
    threadId: string,
    turnId: string,
    thread: ThreadState,
    event: AgentEvent,
  ): void {
    updateProgress(thread.progress, event);
    this.notify("agent/event", {
      threadId,
      turnId,
      event: clientSafeAgentEvent(event),
    });
  }

  private updateConversation(
    conversation: StoredConversation,
    messages: readonly ConversationMessageData[],
    options?: { modelState: unknown },
  ): StoredConversation {
    const { modelState: _previousModelState, ...stored } = conversation;
    const modelState = options ? options.modelState : conversation.modelState;
    return {
      ...stored,
      updatedAt: this.now().toISOString(),
      messages,
      ...(modelState === undefined ? {} : { modelState }),
    };
  }

  private notify<Method extends ThreadlightNotificationMethod>(
    method: Method,
    params: ThreadlightNotificationMap[Method],
  ): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private async createThreadState(
    conversation: StoredConversation,
  ): Promise<ThreadState> {
    const baseAgent = await this.agentFactory();
    const runtime = await this.threadRuntimeFactory?.();
    try {
      return {
        agent: runtime ? attachRuntimeTools(baseAgent, runtime) : baseAgent,
        conversation,
        progress: [],
        ...(runtime ? { runtime } : {}),
      };
    } catch (error) {
      await runtime?.dispose?.();
      throw error;
    }
  }

  private async disposeThreadRuntime(thread: ThreadState): Promise<void> {
    const runtime = thread.runtime;
    thread.runtime = undefined;
    if (!runtime?.dispose) return;
    try {
      await runtime.dispose();
    } catch (error) {
      process.stderr.write(
        `Could not dispose thread runtime ${thread.conversation.threadId}: ${String(error)}\n`,
      );
    }
  }

  private reply(id: JsonRpcId, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private replyError(id: JsonRpcId, error: RpcError): void {
    const message: JsonRpcOutgoing = {
      jsonrpc: "2.0",
      id,
      error: { code: error.code, message: error.message },
    };
    this.send(message);
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function objectParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new RpcError(-32602, "params must be an object");
  }
  return params as Record<string, unknown>;
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcError(-32602, `${name} must be a non-empty string`);
  }
}

function parseAttachments(value: unknown): readonly AttachmentData[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isAttachment)) {
    throw new RpcError(-32602, "attachments must contain valid local files");
  }
  return value;
}

function isAttachment(value: unknown): value is AttachmentData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    (attachment.kind === "image" || attachment.kind === "file") &&
    typeof attachment.path === "string"
  );
}

function updateProgress(
  progress: MutableConversationProgress[],
  event: AgentEvent,
): void {
  if (event.type === "model.completed" && event.toolCalls.length > 0) {
    progress.push({ text: event.text, activities: [] });
    return;
  }

  if (event.type === "tool.started") {
    let step = progress.at(-1);
    if (!step) {
      step = { text: "", activities: [] };
      progress.push(step);
    }
    const detail = toolDetail(event.call.name, event.call.arguments);
    step.activities.push({
      id: event.call.id,
      name: event.call.name,
      status: "running",
      ...(detail ? { detail } : {}),
    });
    return;
  }
  if (event.type !== "tool.completed") return;

  const processSnapshot =
    event.result.name === "computer"
      ? undefined
      : parseProcessSnapshot(event.result.output);
  if (processSnapshot) {
    updateMutableProcessSnapshots(progress, processSnapshot);
  }
  const activity = progress
    .flatMap((step) => step.activities)
    .find((candidate) => candidate.id === event.result.callId);
  if (!activity) return;
  activity.status = event.result.isError
    ? "failed"
    : activity.name === "exec_command" && processSnapshot
      ? activityStatus(processSnapshot)
      : "completed";
  if (activity.name === "exec_command" && processSnapshot) {
    activity.process = processSnapshot;
  }
  if (
    activity.name !== "exec_command" &&
    activity.name !== "project_memory" &&
    activity.name !== "computer"
  ) {
    activity.detail = processSnapshot
      ? processDetail(processSnapshot)
      : truncate(event.result.output);
  }
  if (activity.name === "computer") {
    activity.detail = appendActivityDetail(
      activity.detail,
      formatComputerToolResult(event.result),
    );
  }
}

function updateMutableProcessSnapshots(
  progress: MutableConversationProgress[],
  snapshot: ProcessSnapshotData,
): boolean {
  let changed = false;
  for (const activity of progress.flatMap((step) => step.activities)) {
    if (activity.process?.sessionId !== snapshot.sessionId) continue;
    if (sameProcessSnapshot(activity.process, snapshot)) continue;
    activity.process = { ...snapshot };
    activity.status = activityStatus(snapshot);
    changed = true;
  }
  return changed;
}

function updateStoredProcessSnapshots(
  messages: readonly ConversationMessageData[],
  snapshot: ProcessSnapshotData,
): readonly ConversationMessageData[] {
  let changed = false;
  const next = messages.map((message) => {
    const progress = updateStoredProgress(message.progress, snapshot);
    const activities = updateStoredActivities(message.activities, snapshot);
    if (progress === message.progress && activities === message.activities) {
      return message;
    }
    changed = true;
    return {
      ...message,
      ...(progress === undefined ? {} : { progress }),
      ...(activities === undefined ? {} : { activities }),
    };
  });
  return changed ? next : messages;
}

function updateStoredProgress(
  progress: readonly ConversationProgressData[] | undefined,
  snapshot: ProcessSnapshotData,
): readonly ConversationProgressData[] | undefined {
  if (!progress) return progress;
  let changed = false;
  const next = progress.map((step) => {
    const activities = updateStoredActivities(step.activities, snapshot);
    if (activities === step.activities) return step;
    changed = true;
    return { ...step, activities: activities ?? step.activities };
  });
  return changed ? next : progress;
}

function updateStoredActivities(
  activities: readonly ConversationActivityData[] | undefined,
  snapshot: ProcessSnapshotData,
): readonly ConversationActivityData[] | undefined {
  if (!activities) return activities;
  let changed = false;
  const next = activities.map((activity) => {
    if (
      activity.process?.sessionId !== snapshot.sessionId ||
      sameProcessSnapshot(activity.process, snapshot)
    ) {
      return activity;
    }
    changed = true;
    return {
      ...activity,
      status: activityStatus(snapshot),
      process: { ...snapshot },
    };
  });
  return changed ? next : activities;
}

function parseProcessSnapshot(value: string): ProcessSnapshotData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }
  if (!isObject(parsed)) return;
  const status = parsed.status;
  if (
    typeof parsed.sessionId !== "string" ||
    typeof parsed.command !== "string" ||
    typeof parsed.cwd !== "string" ||
    (status !== "running" &&
      status !== "completed" &&
      status !== "failed" &&
      status !== "terminated") ||
    (parsed.exitCode !== null && typeof parsed.exitCode !== "number") ||
    (parsed.signal !== null && typeof parsed.signal !== "string") ||
    typeof parsed.stdout !== "string" ||
    typeof parsed.stderr !== "string" ||
    typeof parsed.truncated !== "boolean" ||
    typeof parsed.startedAt !== "string" ||
    (parsed.completedAt !== undefined && typeof parsed.completedAt !== "string")
  ) {
    return;
  }
  return parsed as unknown as ProcessSnapshotData;
}

function activityStatus(
  snapshot: ProcessSnapshotData,
): ConversationActivityData["status"] {
  return snapshot.status;
}

function processDetail(snapshot: ProcessSnapshotData): string {
  return `${snapshot.status} · ${snapshot.sessionId}`;
}

function sameProcessSnapshot(
  left: ProcessSnapshotData,
  right: ProcessSnapshotData,
): boolean {
  return (
    left.status === right.status &&
    left.exitCode === right.exitCode &&
    left.signal === right.signal &&
    left.stdout === right.stdout &&
    left.stderr === right.stderr &&
    left.truncated === right.truncated &&
    left.completedAt === right.completedAt
  );
}

function snapshotProgress(
  progress: readonly MutableConversationProgress[],
): ConversationProgressData[] {
  return progress.map((step) => ({
    text: step.text,
    activities: step.activities.map((activity) => ({ ...activity })),
  }));
}

function toolDetail(name: string, arguments_: unknown): string | undefined {
  if (!isObject(arguments_)) return;
  if (name === "exec_command") {
    const command = arguments_.command;
    return typeof command === "string" ? `$ ${command}` : undefined;
  }
  if (name === "project_memory") {
    return arguments_.action === "write"
      ? "Update .threadlight/MEMORY.md"
      : "Read .threadlight/MEMORY.md";
  }
  if (name === "computer" && Array.isArray(arguments_.actions)) {
    return formatComputerToolInput(arguments_);
  }
  return;
}

function clientSafeAgentEvent(event: AgentEvent): AgentEvent {
  if (
    event.type !== "tool.completed" ||
    event.result.name !== "computer" ||
    event.result.isError
  ) {
    return event;
  }
  return {
    ...event,
    result: {
      ...event.result,
      output: '{"type":"computer_screenshot","status":"captured"}',
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, limit = 1_200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function attachRuntimeTools(agent: Agent, runtime: ThreadRuntime): Agent {
  const tools = [...(agent.tools ?? []), ...(runtime.tools ?? [])];
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  return { ...agent, tools };
}
