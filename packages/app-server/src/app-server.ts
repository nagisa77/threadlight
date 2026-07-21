import { randomUUID } from "node:crypto";

import type {
  Agent,
  AgentEvent,
  AgentLoop,
  ApprovalRequest,
} from "@threadlight/agent-loop";

import type {
  ConversationActivityData,
  ConversationMessageData,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
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
  activities: ConversationActivityData[];
  activeTurn?: {
    id: string;
    controller: AbortController;
  };
}

interface PendingApproval {
  turnId: string;
  resolve: (approved: boolean) => void;
}

interface SharedAppServerOptions {
  loop: AgentLoop;
  send: SendMessage;
  autoApproveAll?: boolean;
  conversationStore?: ConversationStore;
  now?: () => Date;
}

export type AgentFactory = () => Agent | Promise<Agent>;

export type AppServerOptions = SharedAppServerOptions &
  (
    | { agent: Agent; agentFactory?: never }
    | { agent?: never; agentFactory: AgentFactory }
  );

export class AppServer {
  private readonly loop: AgentLoop;
  private readonly agentFactory: AgentFactory;
  private readonly send: SendMessage;
  private readonly autoApproveAll: boolean;
  private readonly conversationStore: ConversationStore;
  private readonly now: () => Date;
  private readonly threads = new Map<string, ThreadState>();
  private readonly approvals = new Map<string, PendingApproval>();
  private initialized = false;

  constructor(options: AppServerOptions) {
    this.loop = options.loop;
    this.agentFactory = options.agentFactory ?? (() => options.agent);
    this.send = options.send;
    this.autoApproveAll = options.autoApproveAll ?? false;
    this.conversationStore =
      options.conversationStore ?? new MemoryConversationStore();
    this.now = options.now ?? (() => new Date());
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
      case "approval/resolve":
        return this.resolveApproval(params);
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async startThread(): Promise<{ threadId: string }> {
    const agent = await this.agentFactory();
    const threadId = randomUUID();
    const timestamp = this.now().toISOString();
    const conversation: StoredConversation = {
      version: 1,
      threadId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    this.threads.set(threadId, { agent, conversation, activities: [] });
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
        thread = {
          agent: await this.agentFactory(),
          conversation,
          activities: [],
        };
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
    this.threads.delete(threadId);
    return { deleted: !!thread || deletedFromStore };
  }

  private async startTurn(params: unknown): Promise<{ turnId: string }> {
    const { threadId, input } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(input, "input");

    const thread = this.threads.get(threadId);
    if (!thread) throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    if (thread.activeTurn) {
      throw new RpcError(-32003, "Thread already has an active turn");
    }

    const turnId = randomUUID();
    const controller = new AbortController();
    thread.activeTurn = { id: turnId, controller };
    thread.activities = [];
    const startedConversation = this.updateConversation(thread.conversation, [
      ...thread.conversation.messages,
      {
        id: randomUUID(),
        role: "user",
        text: input,
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
      void this.runTurn(threadId, turnId, input, thread, controller);
    });

    return { turnId };
  }

  private interruptTurn(params: unknown): { interrupted: boolean } {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    const activeTurn = this.threads.get(threadId)?.activeTurn;
    if (!activeTurn) return { interrupted: false };

    activeTurn.controller.abort(new Error("Turn interrupted by client"));
    this.rejectApprovalsForTurn(activeTurn.id);
    return { interrupted: true };
  }

  private resolveApproval(params: unknown): { resolved: boolean } {
    const { requestId, approved } = objectParams(params);
    requireString(requestId, "requestId");
    if (typeof approved !== "boolean") {
      throw new RpcError(-32602, "approved must be a boolean");
    }

    const pending = this.approvals.get(requestId);
    if (!pending) return { resolved: false };

    this.approvals.delete(requestId);
    pending.resolve(approved);
    return { resolved: true };
  }

  private async runTurn(
    threadId: string,
    turnId: string,
    input: string,
    thread: ThreadState,
    controller: AbortController,
  ): Promise<void> {
    this.notify("turn/started", { threadId, turnId });

    try {
      const result = await this.loop.run(thread.agent, input, {
        modelState: thread.conversation.modelState,
        signal: controller.signal,
        onEvent: (event) => this.forwardEvent(threadId, turnId, thread, event),
        approve: (request) =>
          this.autoApproveAll
            ? Promise.resolve(true)
            : this.waitForApproval(turnId, request),
      });

      const completedConversation = this.updateConversation(
        thread.conversation,
        [
          ...thread.conversation.messages,
          {
            id: randomUUID(),
            role: "assistant",
            text: result.output,
            ...(thread.activities.length > 0
              ? { activities: [...thread.activities] }
              : {}),
          },
        ],
        { modelState: result.modelState },
      );
      await this.conversationStore.save(completedConversation);
      thread.conversation = completedConversation;
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
          ...(thread.activities.length > 0
            ? { activities: [...thread.activities] }
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
      this.notify("turn/failed", {
        threadId,
        turnId,
        error: message,
      });
    } finally {
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
      this.rejectApprovalsForTurn(turnId);
    }
  }

  private forwardEvent(
    threadId: string,
    turnId: string,
    thread: ThreadState,
    event: AgentEvent,
  ): void {
    updateActivities(thread.activities, event);
    this.notify("agent/event", { threadId, turnId, event });
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

  private waitForApproval(
    turnId: string,
    request: ApprovalRequest,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.approvals.set(request.id, { turnId, resolve });
    });
  }

  private rejectApprovalsForTurn(turnId: string): void {
    for (const [requestId, pending] of this.approvals) {
      if (pending.turnId !== turnId) continue;
      this.approvals.delete(requestId);
      pending.resolve(false);
    }
  }

  private notify<Method extends ThreadlightNotificationMethod>(
    method: Method,
    params: ThreadlightNotificationMap[Method],
  ): void {
    this.send({ jsonrpc: "2.0", method, params });
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

function updateActivities(
  activities: ConversationActivityData[],
  event: AgentEvent,
): void {
  if (event.type === "tool.started") {
    const detail = toolDetail(event.call.name, event.call.arguments);
    activities.push({
      id: event.call.id,
      name: event.call.name,
      status: "running",
      ...(detail ? { detail } : {}),
    });
    return;
  }
  if (event.type !== "tool.completed") return;

  const activity = activities.find(
    (candidate) => candidate.id === event.result.callId,
  );
  if (!activity) return;
  activity.status = event.result.isError ? "failed" : "completed";
  if (activity.name !== "exec_command") {
    activity.detail = truncate(event.result.output);
  }
}

function toolDetail(name: string, arguments_: unknown): string | undefined {
  if (name !== "exec_command" || !isObject(arguments_)) return;
  const command = arguments_.command;
  return typeof command === "string" ? `$ ${command}` : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, limit = 1_200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
