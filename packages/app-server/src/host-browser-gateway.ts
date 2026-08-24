import type {
  ProjectStore,
  RemoteBrowserSessions,
} from "@threadlight/host-core";
import type {
  HostBrowserClientMessage,
  HostBrowserServerMessage,
} from "@threadlight/protocol";
import { WebSocket, type RawData } from "ws";

export interface HostBrowserGatewayOptions {
  projects: ProjectStore;
  createSessions(
    send: (event: HostBrowserServerMessage) => void,
  ): RemoteBrowserSessions;
  maxConnections?: number;
}

interface BrowserConnection {
  socket: WebSocket;
  sessions: RemoteBrowserSessions;
  closed: boolean;
}

const DEFAULT_MAX_CONNECTIONS = 8;
const MAX_URL_LENGTH = 32_768;
const MAX_TEXT_LENGTH = 65_536;

export class HostBrowserGateway {
  private readonly connections = new Set<BrowserConnection>();
  private readonly maxConnections: number;

  constructor(private readonly options: HostBrowserGatewayOptions) {
    this.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  }

  accept(socket: WebSocket): void {
    if (this.connections.size >= this.maxConnections) {
      socket.close(1013, "Browser connection limit reached");
      return;
    }
    let connection: BrowserConnection;
    const sessions = this.options.createSessions((event) => {
      this.send(connection, event);
    });
    connection = { socket, sessions, closed: false };
    this.connections.add(connection);
    socket.on("message", (data) => {
      void this.handleMessage(connection, data);
    });
    socket.once("close", () => {
      void this.closeConnection(connection);
    });
    socket.once("error", () => {
      void this.closeConnection(connection);
    });
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.connections].map(async (connection) => {
        await this.closeConnection(connection);
        connection.socket.terminate();
      }),
    );
  }

  private async handleMessage(
    connection: BrowserConnection,
    data: RawData,
  ): Promise<void> {
    let message: HostBrowserClientMessage;
    try {
      message = parseBrowserMessage(data);
    } catch (error) {
      this.send(connection, { type: "error", message: errorMessage(error) });
      return;
    }
    try {
      if (message.type === "open") {
        if (!this.options.projects.project(message.projectId)) {
          throw new Error(`Unknown project: ${message.projectId}`);
        }
        const session = await connection.sessions.create(message);
        if (connection.closed) {
          await connection.sessions.close(session.id);
          return;
        }
        this.send(connection, {
          type: "opened",
          requestId: message.requestId,
          session,
        });
        return;
      }
      await connection.sessions.command(message);
    } catch (error) {
      this.send(connection, {
        type: "error",
        ...(message.type === "open"
          ? { requestId: message.requestId }
          : { sessionId: message.sessionId }),
        message: errorMessage(error),
      });
    }
  }

  private send(
    connection: BrowserConnection,
    message: HostBrowserServerMessage,
  ): void {
    if (connection.closed || connection.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    connection.socket.send(JSON.stringify(message));
  }

  private async closeConnection(connection: BrowserConnection): Promise<void> {
    if (connection.closed) return;
    connection.closed = true;
    this.connections.delete(connection);
    await connection.sessions.dispose();
  }
}

export function parseBrowserMessage(data: RawData): HostBrowserClientMessage {
  const value = JSON.parse(data.toString()) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid browser message.");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "open") {
    requiredString(message.requestId, "browser request id");
    requiredString(message.projectId, "browser project id");
    viewport(message);
    return {
      type: "open",
      requestId: message.requestId as string,
      projectId: message.projectId as string,
      width: message.width as number,
      height: message.height as number,
      ...(typeof message.deviceScaleFactor === "number"
        ? { deviceScaleFactor: message.deviceScaleFactor }
        : {}),
    };
  }
  requiredString(message.sessionId, "browser session id");
  const sessionId = message.sessionId as string;
  if (message.type === "navigate") {
    requiredString(message.url, "browser URL", MAX_URL_LENGTH);
    return { type: "navigate", sessionId, url: message.url as string };
  }
  if (
    message.type === "back" ||
    message.type === "forward" ||
    message.type === "reload" ||
    message.type === "stop" ||
    message.type === "close"
  ) {
    return { type: message.type, sessionId };
  }
  if (message.type === "resize") {
    viewport(message);
    return {
      type: "resize",
      sessionId,
      width: message.width as number,
      height: message.height as number,
      ...(typeof message.deviceScaleFactor === "number"
        ? { deviceScaleFactor: message.deviceScaleFactor }
        : {}),
    };
  }
  if (message.type === "pointer") {
    if (
      message.phase !== "move" &&
      message.phase !== "down" &&
      message.phase !== "up"
    ) {
      throw new Error("Invalid browser pointer phase.");
    }
    finiteNumber(message.x, "browser pointer x");
    finiteNumber(message.y, "browser pointer y");
    if (
      message.button !== "none" &&
      message.button !== "left" &&
      message.button !== "middle" &&
      message.button !== "right"
    ) {
      throw new Error("Invalid browser mouse button.");
    }
    optionalInteger(message.clickCount, "browser click count", 1, 3);
    optionalInteger(message.modifiers, "browser modifiers", 0, 15);
    return {
      type: "pointer",
      sessionId,
      phase: message.phase,
      x: message.x as number,
      y: message.y as number,
      button: message.button,
      ...(typeof message.clickCount === "number"
        ? { clickCount: message.clickCount }
        : {}),
      ...(typeof message.modifiers === "number"
        ? { modifiers: message.modifiers }
        : {}),
    };
  }
  if (message.type === "wheel") {
    finiteNumber(message.x, "browser wheel x");
    finiteNumber(message.y, "browser wheel y");
    finiteNumber(message.deltaX, "browser wheel delta x");
    finiteNumber(message.deltaY, "browser wheel delta y");
    optionalInteger(message.modifiers, "browser modifiers", 0, 15);
    return {
      type: "wheel",
      sessionId,
      x: message.x as number,
      y: message.y as number,
      deltaX: message.deltaX as number,
      deltaY: message.deltaY as number,
      ...(typeof message.modifiers === "number"
        ? { modifiers: message.modifiers }
        : {}),
    };
  }
  if (message.type === "key") {
    if (message.phase !== "down" && message.phase !== "up") {
      throw new Error("Invalid browser key phase.");
    }
    requiredString(message.key, "browser key", 128);
    if (typeof message.code !== "string" || message.code.length > 128) {
      throw new Error("Invalid browser key code.");
    }
    optionalString(message.text, "browser key text", 128);
    optionalInteger(message.modifiers, "browser modifiers", 0, 15);
    if (message.repeat !== undefined && typeof message.repeat !== "boolean") {
      throw new Error("Invalid browser key repeat state.");
    }
    return {
      type: "key",
      sessionId,
      phase: message.phase,
      key: message.key as string,
      code: message.code,
      ...(typeof message.text === "string" ? { text: message.text } : {}),
      ...(typeof message.modifiers === "number"
        ? { modifiers: message.modifiers }
        : {}),
      ...(typeof message.repeat === "boolean"
        ? { repeat: message.repeat }
        : {}),
    };
  }
  if (message.type === "insert-text") {
    if (
      typeof message.text !== "string" ||
      message.text.length > MAX_TEXT_LENGTH
    ) {
      throw new Error("Invalid browser input text.");
    }
    return { type: "insert-text", sessionId, text: message.text };
  }
  if (message.type === "frame-ack") {
    integer(message.frameId, "browser frame id", 0, Number.MAX_SAFE_INTEGER);
    return { type: "frame-ack", sessionId, frameId: message.frameId as number };
  }
  if (message.type === "dialog") {
    requiredString(message.dialogId, "browser dialog id");
    if (typeof message.accept !== "boolean") {
      throw new Error("Invalid browser dialog decision.");
    }
    optionalString(message.promptText, "browser prompt text", MAX_TEXT_LENGTH);
    return {
      type: "dialog",
      sessionId,
      dialogId: message.dialogId as string,
      accept: message.accept,
      ...(typeof message.promptText === "string"
        ? { promptText: message.promptText }
        : {}),
    };
  }
  throw new Error("Unknown browser message.");
}

function viewport(message: Record<string, unknown>): void {
  integer(message.width, "browser viewport width", 1, 16_384);
  integer(message.height, "browser viewport height", 1, 16_384);
  if (message.deviceScaleFactor !== undefined) {
    finiteNumber(message.deviceScaleFactor, "browser device scale factor");
    if (
      (message.deviceScaleFactor as number) <= 0 ||
      (message.deviceScaleFactor as number) > 4
    ) {
      throw new Error("Invalid browser device scale factor.");
    }
  }
}

function requiredString(
  value: unknown,
  label: string,
  maximum = 1_024,
): asserts value is string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`Invalid ${label}.`);
  }
}

function optionalString(value: unknown, label: string, maximum: number): void {
  if (
    value !== undefined &&
    (typeof value !== "string" || value.length > maximum)
  ) {
    throw new Error(`Invalid ${label}.`);
  }
}

function finiteNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Invalid ${label}.`);
  }
}

function optionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (value !== undefined) integer(value, label, minimum, maximum);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
