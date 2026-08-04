import { randomUUID } from "node:crypto";

import type {
  HostTerminalClientMessage,
  HostTerminalServerMessage,
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalWorkspaceScope,
} from "@threadlight/protocol";
import WebSocket, { type RawData } from "ws";

export interface RemoteTerminalClientOptions {
  endpoint: string;
  token: string;
  send(event: TerminalSessionEvent): void;
  connectTimeoutMs?: number;
  openTimeoutMs?: number;
}

interface PendingOpen {
  resolve(session: TerminalSessionInfo): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const REMOTE_DISCONNECT_EXIT_CODE = 255;
const MAX_SERVER_MESSAGE_BYTES = 1024 * 1024;

export class RemoteTerminalClient {
  private socket?: WebSocket;
  private connecting?: Promise<WebSocket>;
  private readonly sessions = new Set<string>();
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private disposed = false;

  constructor(private readonly options: RemoteTerminalClientOptions) {
    if (!options.token.trim()) {
      throw new Error("Threadlight Host token is required.");
    }
  }

  async create(request: {
    projectId: string;
    threadId?: string;
    workspace?: TerminalWorkspaceScope;
    cols: number;
    rows: number;
  }): Promise<TerminalSessionInfo> {
    const socket = await this.connect();
    const requestId = randomUUID();
    return new Promise<TerminalSessionInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpens.delete(requestId);
        reject(new Error("Remote terminal creation timed out."));
      }, this.options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
      this.pendingOpens.set(requestId, { resolve, reject, timer });
      try {
        this.send(socket, {
          type: "open",
          requestId,
          projectId: request.projectId,
          ...(request.threadId ? { threadId: request.threadId } : {}),
          ...(request.workspace ? { workspace: request.workspace } : {}),
          cols: request.cols,
          rows: request.rows,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingOpens.delete(requestId);
        reject(asError(error));
      }
    });
  }

  owns(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  write(sessionId: string, data: string): void {
    if (!this.sessions.has(sessionId)) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.send(socket, { type: "input", sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (!this.sessions.has(sessionId)) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.send(socket, { type: "resize", sessionId, cols, rows });
  }

  close(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) return;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.send(socket, { type: "close", sessionId });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error("Remote terminal connection closed."));
    const socket = this.socket;
    this.socket = undefined;
    this.connecting = undefined;
    if (socket) socket.terminate();
    this.sessions.clear();
  }

  private connect(): Promise<WebSocket> {
    if (this.disposed) {
      return Promise.reject(
        new Error("Remote terminal connection is closed."),
      );
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }
    if (this.connecting) return this.connecting;

    const socket = new WebSocket(terminalWebSocketUrl(this.options.endpoint), {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
      },
      handshakeTimeout:
        this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      maxPayload: MAX_SERVER_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on("message", (data) => this.receive(data));
    socket.on("close", () => this.disconnected(socket));
    socket.on("error", () => {
      // Opening failures reject through the promise below. Established
      // connections are finalized by the subsequent close event.
    });

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const connected = () => {
        cleanup();
        resolve(socket);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const unexpected = (
        _request: unknown,
        response: { statusCode?: number; resume(): void },
      ) => {
        response.resume();
        failed(
          new Error(
            `Remote terminal connection was rejected (${response.statusCode ?? "unknown"}).`,
          ),
        );
      };
      const cleanup = () => {
        socket.off("open", connected);
        socket.off("error", failed);
        socket.off("unexpected-response", unexpected);
      };
      socket.once("open", connected);
      socket.once("error", failed);
      socket.once("unexpected-response", unexpected);
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private receive(data: RawData): void {
    let message: HostTerminalServerMessage;
    try {
      message = parseServerMessage(data);
    } catch {
      const socket = this.socket;
      if (socket) socket.close(1002, "Invalid terminal message");
      return;
    }
    if (message.type === "opened") {
      const pending = this.pendingOpens.get(message.requestId);
      if (!pending) {
        const socket = this.socket;
        if (socket?.readyState === WebSocket.OPEN) {
          this.send(socket, {
            type: "close",
            sessionId: message.session.id,
          });
        }
        return;
      }
      clearTimeout(pending.timer);
      this.pendingOpens.delete(message.requestId);
      this.sessions.add(message.session.id);
      pending.resolve(message.session);
      return;
    }
    if (message.type === "error") {
      if (message.requestId) {
        const pending = this.pendingOpens.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingOpens.delete(message.requestId);
          pending.reject(new Error(message.message));
        }
      }
      if (message.sessionId && this.sessions.delete(message.sessionId)) {
        this.options.send({
          type: "data",
          sessionId: message.sessionId,
          data: `\r\n[Threadlight: ${message.message}]\r\n`,
        });
        this.options.send({
          type: "exit",
          sessionId: message.sessionId,
          exitCode: 1,
        });
      }
      return;
    }
    if (message.type === "exit") {
      this.sessions.delete(message.sessionId);
    }
    this.options.send(message);
  }

  private disconnected(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.connecting = undefined;
    const error = new Error("Remote terminal connection was lost.");
    this.failPending(error);
    for (const sessionId of this.sessions) {
      this.options.send({
        type: "data",
        sessionId,
        data: "\r\n[Threadlight: remote terminal connection lost]\r\n",
      });
      this.options.send({
        type: "exit",
        sessionId,
        exitCode: REMOTE_DISCONNECT_EXIT_CODE,
      });
    }
    this.sessions.clear();
  }

  private failPending(error: Error): void {
    for (const pending of this.pendingOpens.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingOpens.clear();
  }

  private send(socket: WebSocket, message: HostTerminalClientMessage): void {
    socket.send(JSON.stringify(message));
  }
}

function terminalWebSocketUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else throw new Error("Threadlight Host endpoint must use http or https.");
  url.pathname = "/v1/host/terminal";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseServerMessage(data: RawData): HostTerminalServerMessage {
  const value = JSON.parse(data.toString()) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid remote terminal message");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "opened") {
    const session =
      message.session &&
      typeof message.session === "object" &&
      !Array.isArray(message.session)
        ? (message.session as Record<string, unknown>)
        : undefined;
    if (
      typeof message.requestId !== "string" ||
      !message.requestId ||
      typeof session?.id !== "string" ||
      !session.id ||
      typeof session.shell !== "string" ||
      (session.cwd !== undefined && typeof session.cwd !== "string") ||
      (session.branch !== undefined && typeof session.branch !== "string")
    ) {
      throw new Error("Invalid remote terminal open response");
    }
    return {
      type: "opened",
      requestId: message.requestId,
      session: {
        id: session.id,
        shell: session.shell,
        ...(typeof session.cwd === "string" ? { cwd: session.cwd } : {}),
        ...(typeof session.branch === "string"
          ? { branch: session.branch }
          : {}),
      },
    };
  }
  if (
    message.type === "data" &&
    typeof message.sessionId === "string" &&
    message.sessionId &&
    typeof message.data === "string"
  ) {
    return {
      type: "data",
      sessionId: message.sessionId,
      data: message.data,
    };
  }
  if (
    message.type === "exit" &&
    typeof message.sessionId === "string" &&
    message.sessionId &&
    typeof message.exitCode === "number" &&
    Number.isInteger(message.exitCode)
  ) {
    return {
      type: "exit",
      sessionId: message.sessionId,
      exitCode: message.exitCode,
    };
  }
  if (
    message.type === "error" &&
    (message.requestId === undefined ||
      typeof message.requestId === "string") &&
    (message.sessionId === undefined ||
      typeof message.sessionId === "string") &&
    typeof message.message === "string"
  ) {
    return {
      type: "error",
      ...(typeof message.requestId === "string"
        ? { requestId: message.requestId }
        : {}),
      ...(typeof message.sessionId === "string"
        ? { sessionId: message.sessionId }
        : {}),
      message: message.message,
    };
  }
  throw new Error("Unknown remote terminal message");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
