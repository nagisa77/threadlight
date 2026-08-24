import type {
  BrowserSessionEvent,
  BrowserSessionInfo,
  HostBrowserClientMessage,
  HostBrowserServerMessage,
} from "@threadlight/protocol";

import { createBrowserUuid } from "./browser-uuid.js";
import {
  browserTerminalProtocols,
  type BrowserSocket,
  type BrowserSocketEvent,
} from "./browser-terminal-client.js";

export interface BrowserStreamClientOptions {
  endpoint: string;
  token: string;
  send(event: BrowserSessionEvent): void;
  createSocket?: (url: string, protocols: readonly string[]) => BrowserSocket;
  connectTimeoutMs?: number;
  openTimeoutMs?: number;
}

interface PendingOpen {
  resolve(session: BrowserSessionInfo): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const SOCKET_OPEN = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_OPEN_TIMEOUT_MS = 30_000;

/** Browser/WebSocket client shared by Threadlight Web and desktop transports. */
export class BrowserStreamClient {
  private socket?: BrowserSocket;
  private connecting?: Promise<BrowserSocket>;
  private readonly sessions = new Set<string>();
  private readonly earlyEvents = new Map<string, BrowserSessionEvent[]>();
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private disposed = false;

  constructor(private readonly options: BrowserStreamClientOptions) {
    if (!options.token.trim()) {
      throw new Error("Threadlight Host token is required.");
    }
  }

  async create(request: {
    projectId: string;
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<BrowserSessionInfo> {
    const socket = await this.connect();
    const requestId = createBrowserUuid();
    return new Promise<BrowserSessionInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpens.delete(requestId);
        reject(new Error("Remote browser creation timed out."));
      }, this.options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
      this.pendingOpens.set(requestId, { resolve, reject, timer });
      try {
        this.send(socket, { type: "open", requestId, ...request });
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

  command(message: Exclude<HostBrowserClientMessage, { type: "open" }>): void {
    if (!this.sessions.has(message.sessionId) || !this.isOpen()) return;
    this.send(this.socket!, message);
    if (message.type === "close") this.sessions.delete(message.sessionId);
  }

  close(sessionId: string): void {
    this.command({ type: "close", sessionId });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error("Remote browser connection closed."));
    this.socket?.close(1000, "Threadlight browser client closed");
    this.socket = undefined;
    this.connecting = undefined;
    this.sessions.clear();
    this.earlyEvents.clear();
  }

  private connect(): Promise<BrowserSocket> {
    if (this.disposed) {
      return Promise.reject(new Error("Remote browser connection is closed."));
    }
    if (this.isOpen()) return Promise.resolve(this.socket!);
    if (this.connecting) return this.connecting;
    const createSocket =
      this.options.createSocket ?? defaultBrowserSocketFactory;
    const socket = createSocket(
      browserWebSocketUrl(this.options.endpoint),
      browserTerminalProtocols(this.options.token),
    );
    this.socket = socket;
    const receive = (event: BrowserSocketEvent) => this.receive(event.data);
    const disconnected = () => this.disconnected(socket);
    socket.addEventListener("message", receive);
    socket.addEventListener("close", disconnected);
    this.connecting = new Promise<BrowserSocket>((resolve, reject) => {
      const timer = setTimeout(
        () => failed(new Error("Remote browser connection timed out.")),
        this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      );
      const opened = () => {
        cleanup();
        resolve(socket);
      };
      const errored = () =>
        failed(new Error("Remote browser connection was rejected."));
      const closed = () =>
        failed(new Error("Remote browser connection closed."));
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
      this.socket?.close(1002, "Invalid browser message");
      return;
    }
    let message: HostBrowserServerMessage;
    try {
      message = parseBrowserServerMessage(data);
    } catch {
      this.socket?.close(1002, "Invalid browser message");
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
      queueMicrotask(() => {
        for (const event of this.earlyEvents.get(message.session.id) ?? []) {
          this.options.send(event);
        }
        this.earlyEvents.delete(message.session.id);
      });
      return;
    }
    if (
      message.type === "error" &&
      "requestId" in message &&
      message.requestId
    ) {
      const pending = this.pendingOpens.get(message.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingOpens.delete(message.requestId);
        pending.reject(new Error(message.message));
        return;
      }
    }
    const sessionId = "sessionId" in message ? message.sessionId : undefined;
    if (sessionId && !this.sessions.has(sessionId)) {
      const buffered = this.earlyEvents.get(sessionId) ?? [];
      if (message.type === "frame") {
        const withoutFrames: BrowserSessionEvent[] = buffered.filter(
          (event) => event.type !== "frame",
        );
        withoutFrames.push(message);
        this.earlyEvents.set(sessionId, withoutFrames);
      } else {
        buffered.push(message);
        this.earlyEvents.set(sessionId, buffered.slice(-8));
      }
      return;
    }
    if (message.type === "closed") this.sessions.delete(message.sessionId);
    this.options.send(message);
  }

  private disconnected(socket: BrowserSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.connecting = undefined;
    if (this.disposed) return;
    this.failPending(new Error("Remote browser connection was lost."));
    for (const sessionId of this.sessions) {
      this.options.send({
        type: "closed",
        sessionId,
        reason: "Remote browser connection was lost.",
      });
    }
    this.sessions.clear();
    this.earlyEvents.clear();
  }

  private failPending(error: Error): void {
    for (const pending of this.pendingOpens.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingOpens.clear();
  }

  private send(socket: BrowserSocket, message: HostBrowserClientMessage): void {
    socket.send(JSON.stringify(message));
  }

  private isOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN;
  }
}

export function browserWebSocketUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else throw new Error("Threadlight Host endpoint must use http or https.");
  url.pathname = "/v1/host/browser";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function defaultBrowserSocketFactory(
  url: string,
  protocols: readonly string[],
): BrowserSocket {
  const Socket = (
    globalThis as {
      WebSocket?: new (
        url: string,
        protocols?: string | string[],
      ) => BrowserSocket;
    }
  ).WebSocket;
  if (!Socket) throw new Error("This browser does not support WebSocket.");
  return new Socket(url, [...protocols]);
}

export function parseBrowserServerMessage(
  data: string,
): HostBrowserServerMessage {
  const value = JSON.parse(data) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid remote browser message.");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "opened") {
    requiredString(message.requestId);
    return {
      type: "opened",
      requestId: message.requestId,
      session: parseBrowserSession(message.session),
    };
  }
  if (message.type === "state") {
    return { type: "state", session: parseBrowserSession(message.session) };
  }
  if (message.type === "frame") {
    requiredString(message.sessionId);
    requiredString(message.data);
    requiredNumber(message.frameId);
    requiredNumber(message.width);
    requiredNumber(message.height);
    return {
      type: "frame",
      sessionId: message.sessionId,
      frameId: message.frameId,
      data: message.data,
      width: message.width,
      height: message.height,
    };
  }
  if (message.type === "dialog") {
    requiredString(message.sessionId);
    requiredString(message.dialogId);
    requiredString(message.message);
    if (
      message.dialogType !== "alert" &&
      message.dialogType !== "beforeunload" &&
      message.dialogType !== "confirm" &&
      message.dialogType !== "prompt"
    ) {
      throw new Error("Invalid remote browser dialog.");
    }
    if (typeof message.defaultValue !== "string") {
      throw new Error("Invalid remote browser dialog value.");
    }
    return {
      type: "dialog",
      sessionId: message.sessionId,
      dialogId: message.dialogId,
      dialogType: message.dialogType,
      message: message.message,
      defaultValue: message.defaultValue,
    };
  }
  if (message.type === "download") {
    requiredString(message.sessionId);
    requiredString(message.downloadId);
    requiredString(message.filename);
    if (
      message.status !== "started" &&
      message.status !== "completed" &&
      message.status !== "failed"
    ) {
      throw new Error("Invalid remote browser download.");
    }
    return {
      type: "download",
      sessionId: message.sessionId,
      downloadId: message.downloadId,
      filename: message.filename,
      status: message.status,
      ...(typeof message.path === "string" ? { path: message.path } : {}),
      ...(typeof message.error === "string" ? { error: message.error } : {}),
    };
  }
  if (message.type === "closed") {
    requiredString(message.sessionId);
    return {
      type: "closed",
      sessionId: message.sessionId,
      ...(typeof message.reason === "string" ? { reason: message.reason } : {}),
    };
  }
  if (message.type === "error") {
    requiredString(message.message);
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
  throw new Error("Unknown remote browser message.");
}

function parseBrowserSession(value: unknown): BrowserSessionInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid remote browser session.");
  }
  const session = value as Record<string, unknown>;
  requiredString(session.id);
  if (typeof session.url !== "string" || typeof session.title !== "string") {
    throw new Error("Invalid remote browser session state.");
  }
  if (
    typeof session.canGoBack !== "boolean" ||
    typeof session.canGoForward !== "boolean" ||
    typeof session.loading !== "boolean"
  ) {
    throw new Error("Invalid remote browser navigation state.");
  }
  const viewport = session.viewport;
  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) {
    throw new Error("Invalid remote browser viewport.");
  }
  const dimensions = viewport as Record<string, unknown>;
  requiredNumber(dimensions.width);
  requiredNumber(dimensions.height);
  requiredNumber(dimensions.deviceScaleFactor);
  return {
    id: session.id,
    url: session.url,
    title: session.title,
    canGoBack: session.canGoBack,
    canGoForward: session.canGoForward,
    loading: session.loading,
    viewport: {
      width: dimensions.width,
      height: dimensions.height,
      deviceScaleFactor: dimensions.deviceScaleFactor,
    },
  };
}

function requiredString(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid remote browser string.");
  }
}

function requiredNumber(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid remote browser number.");
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
