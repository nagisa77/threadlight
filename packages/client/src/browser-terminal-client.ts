import type {
  HostTerminalClientMessage,
  HostTerminalServerMessage,
  TerminalSessionEvent,
  TerminalSessionInfo,
} from "@threadlight/protocol";

import { createBrowserUuid } from "./browser-uuid.js";

export interface BrowserSocketEvent {
  data?: unknown;
}

export interface BrowserSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: BrowserSocketEvent) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: BrowserSocketEvent) => void,
  ): void;
}

export interface BrowserTerminalClientOptions {
  endpoint: string;
  token: string;
  send(event: TerminalSessionEvent): void;
  createSocket?: (
    url: string,
    protocols: readonly string[],
  ) => BrowserSocket;
  connectTimeoutMs?: number;
  openTimeoutMs?: number;
}

interface PendingOpen {
  resolve(session: TerminalSessionInfo): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const SOCKET_OPEN = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const REMOTE_DISCONNECT_EXIT_CODE = 255;

export class BrowserTerminalClient {
  private socket?: BrowserSocket;
  private connecting?: Promise<BrowserSocket>;
  private readonly sessions = new Set<string>();
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private disposed = false;

  constructor(private readonly options: BrowserTerminalClientOptions) {
    if (!options.token.trim()) {
      throw new Error("Threadlight Host token is required.");
    }
  }

  async create(request: {
    projectId: string;
    threadId?: string;
    cols: number;
    rows: number;
  }): Promise<TerminalSessionInfo> {
    const socket = await this.connect();
    const requestId = createBrowserUuid();
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

  write(sessionId: string, data: string): void {
    if (!this.sessions.has(sessionId) || !this.isOpen()) return;
    this.send(this.socket!, { type: "input", sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (!this.sessions.has(sessionId) || !this.isOpen()) return;
    this.send(this.socket!, { type: "resize", sessionId, cols, rows });
  }

  close(sessionId: string): void {
    if (!this.sessions.delete(sessionId) || !this.isOpen()) return;
    this.send(this.socket!, { type: "close", sessionId });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error("Remote terminal connection closed."));
    this.socket?.close(1000, "Threadlight web client closed");
    this.socket = undefined;
    this.connecting = undefined;
    this.sessions.clear();
  }

  private connect(): Promise<BrowserSocket> {
    if (this.disposed) {
      return Promise.reject(
        new Error("Remote terminal connection is closed."),
      );
    }
    if (this.isOpen()) return Promise.resolve(this.socket!);
    if (this.connecting) return this.connecting;

    const createSocket =
      this.options.createSocket ?? defaultBrowserSocketFactory;
    const socket = createSocket(
      terminalWebSocketUrl(this.options.endpoint),
      browserTerminalProtocols(this.options.token),
    );
    this.socket = socket;
    const receive = (event: BrowserSocketEvent) =>
      this.receive(event.data);
    const disconnected = () => this.disconnected(socket);
    socket.addEventListener("message", receive);
    socket.addEventListener("close", disconnected);

    this.connecting = new Promise<BrowserSocket>((resolve, reject) => {
      const timer = setTimeout(
        () => failed(new Error("Remote terminal connection timed out.")),
        this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      );
      const opened = () => {
        cleanup();
        resolve(socket);
      };
      const errored = () =>
        failed(new Error("Remote terminal connection was rejected."));
      const closed = () =>
        failed(new Error("Remote terminal connection closed."));
      const failed = (error: Error) => {
        cleanup();
        socket.close();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", errored);
        socket.removeEventListener("close", closed);
      };
      socket.addEventListener("open", opened);
      socket.addEventListener("error", errored);
      socket.addEventListener("close", closed);
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") {
      this.socket?.close(1002, "Invalid terminal message");
      return;
    }
    let message: HostTerminalServerMessage;
    try {
      message = parseServerMessage(data);
    } catch {
      this.socket?.close(1002, "Invalid terminal message");
      return;
    }
    if (message.type === "opened") {
      const pending = this.pendingOpens.get(message.requestId);
      if (!pending) {
        if (this.isOpen()) {
          this.send(this.socket!, {
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
    if (message.type === "exit") this.sessions.delete(message.sessionId);
    this.options.send(message);
  }

  private disconnected(socket: BrowserSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.connecting = undefined;
    if (this.disposed) return;
    this.failPending(new Error("Remote terminal connection was lost."));
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

  private send(
    socket: BrowserSocket,
    message: HostTerminalClientMessage,
  ): void {
    socket.send(JSON.stringify(message));
  }

  private isOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN;
  }
}

export function browserTerminalProtocols(token: string): readonly string[] {
  return [
    "threadlight.v1",
    `threadlight.token.${encodeBase64Url(token)}`,
  ];
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

function defaultBrowserSocketFactory(
  url: string,
  protocols: readonly string[],
): BrowserSocket {
  const Socket = (globalThis as {
    WebSocket?: new (
      url: string,
      protocols?: string | string[],
    ) => BrowserSocket;
  }).WebSocket;
  if (!Socket) throw new Error("This browser does not support WebSocket.");
  return new Socket(url, [...protocols]);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const group =
      (first << 16) |
      ((second ?? 0) << 8) |
      (third ?? 0);
    output += alphabet[(group >> 18) & 63];
    output += alphabet[(group >> 12) & 63];
    if (second !== undefined) output += alphabet[(group >> 6) & 63];
    if (third !== undefined) output += alphabet[group & 63];
  }
  return output;
}

function parseServerMessage(data: string): HostTerminalServerMessage {
  const value = JSON.parse(data) as unknown;
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
      typeof session?.id !== "string" ||
      typeof session.shell !== "string"
    ) {
      throw new Error("Invalid remote terminal open response");
    }
    return {
      type: "opened",
      requestId: message.requestId,
      session: { id: session.id, shell: session.shell },
    };
  }
  if (
    message.type === "data" &&
    typeof message.sessionId === "string" &&
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
    typeof message.exitCode === "number"
  ) {
    return {
      type: "exit",
      sessionId: message.sessionId,
      exitCode: message.exitCode,
    };
  }
  if (message.type === "error" && typeof message.message === "string") {
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
  throw new Error("Invalid remote terminal message");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
