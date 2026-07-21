import { randomUUID } from "node:crypto";

import type {
  Agent,
  AgentEvent,
  AgentLoop,
  ApprovalRequest,
} from "@threadlight/agent-loop";

import type {
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  SendMessage,
} from "./protocol.js";

interface ThreadState {
  modelState?: unknown;
  activeTurn?: {
    id: string;
    controller: AbortController;
  };
}

interface PendingApproval {
  turnId: string;
  resolve: (approved: boolean) => void;
}

export interface AppServerOptions {
  loop: AgentLoop;
  agent: Agent;
  send: SendMessage;
}

export class AppServer {
  private readonly loop: AgentLoop;
  private readonly agent: Agent;
  private readonly send: SendMessage;
  private readonly threads = new Map<string, ThreadState>();
  private readonly approvals = new Map<string, PendingApproval>();
  private initialized = false;

  constructor(options: AppServerOptions) {
    this.loop = options.loop;
    this.agent = options.agent;
    this.send = options.send;
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

  private startThread(): { threadId: string } {
    const threadId = randomUUID();
    this.threads.set(threadId, {});
    return { threadId };
  }

  private resumeThread(params: unknown): { threadId: string } {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    if (!this.threads.has(threadId)) {
      throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    }
    return { threadId };
  }

  private startTurn(params: unknown): { turnId: string } {
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
      const result = await this.loop.run(this.agent, input, {
        modelState: thread.modelState,
        signal: controller.signal,
        onEvent: (event) => this.forwardEvent(threadId, turnId, event),
        approve: (request) => this.waitForApproval(turnId, request),
      });

      thread.modelState = result.modelState;
      this.notify("turn/completed", {
        threadId,
        turnId,
        output: result.output,
        usage: result.usage,
      });
    } catch (error) {
      this.notify("turn/failed", {
        threadId,
        turnId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
      this.rejectApprovalsForTurn(turnId);
    }
  }

  private forwardEvent(
    threadId: string,
    turnId: string,
    event: AgentEvent,
  ): void {
    this.notify("agent/event", { threadId, turnId, event });
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

  private notify(method: string, params: unknown): void {
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
