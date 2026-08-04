import {
  resolveTerminalWorkspace,
  type ProjectStore,
} from "@threadlight/host-core";
import type {
  HostTerminalClientMessage,
  HostTerminalServerMessage,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import type { TerminalSessionController } from "@threadlight/terminal-core";
import {
  WebSocket,
  type RawData,
} from "ws";

export interface HostTerminalGatewayOptions {
  projects: ProjectStore;
  createSessions(
    send: (event: TerminalSessionEvent) => void,
  ): TerminalSessionController;
  maxConnections?: number;
}

interface TerminalConnection {
  socket: WebSocket;
  sessions: TerminalSessionController;
  closed: boolean;
}

const DEFAULT_MAX_CONNECTIONS = 16;

export class HostTerminalGateway {
  private readonly connections = new Set<TerminalConnection>();
  private readonly maxConnections: number;

  constructor(private readonly options: HostTerminalGatewayOptions) {
    this.maxConnections =
      options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  }

  accept(socket: WebSocket): void {
    if (this.connections.size >= this.maxConnections) {
      socket.close(1013, "Terminal connection limit reached");
      return;
    }
    let connection: TerminalConnection;
    const sessions = this.options.createSessions((event) => {
      this.send(connection, event);
    });
    connection = { socket, sessions, closed: false };
    this.connections.add(connection);

    socket.on("message", (data) => {
      this.handleMessage(connection, data);
    });
    socket.once("close", () => this.closeConnection(connection));
    socket.once("error", () => this.closeConnection(connection));
  }

  close(): void {
    for (const connection of [...this.connections]) {
      this.closeConnection(connection);
      connection.socket.terminate();
    }
  }

  private handleMessage(
    connection: TerminalConnection,
    data: RawData,
  ): void {
    let message: HostTerminalClientMessage;
    try {
      message = parseTerminalMessage(data);
    } catch (error) {
      this.send(connection, {
        type: "error",
        message: errorMessage(error),
      });
      return;
    }

    try {
      if (message.type === "open") {
        const project = this.options.projects.project(message.projectId);
        if (!project) {
          throw new Error(`Unknown project: ${message.projectId}`);
        }
        const workspace = resolveTerminalWorkspace(
          project,
          message.threadId,
          message.workspace,
        );
        const session = connection.sessions.create(
          workspace.cwd,
          message.cols,
          message.rows,
        );
        this.send(connection, {
          type: "opened",
          requestId: message.requestId,
          session: { ...session, ...workspace },
        });
        return;
      }
      if (message.type === "input") {
        connection.sessions.write(message.sessionId, message.data);
        return;
      }
      if (message.type === "resize") {
        connection.sessions.resize(
          message.sessionId,
          message.cols,
          message.rows,
        );
        return;
      }
      connection.sessions.close(message.sessionId);
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
    connection: TerminalConnection,
    message: HostTerminalServerMessage,
  ): void {
    if (
      connection.closed ||
      connection.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    connection.socket.send(JSON.stringify(message));
  }

  private closeConnection(connection: TerminalConnection): void {
    if (connection.closed) return;
    connection.closed = true;
    this.connections.delete(connection);
    connection.sessions.dispose();
  }
}

function parseTerminalMessage(data: RawData): HostTerminalClientMessage {
  const value = JSON.parse(data.toString()) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal message");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "open") {
    if (
      typeof message.requestId !== "string" ||
      !message.requestId ||
      typeof message.projectId !== "string" ||
      !message.projectId ||
      (message.threadId !== undefined &&
        typeof message.threadId !== "string") ||
      (message.workspace !== undefined &&
        message.workspace !== "task" &&
        message.workspace !== "original") ||
      typeof message.cols !== "number" ||
      typeof message.rows !== "number"
    ) {
      throw new Error("Invalid terminal open request");
    }
    return {
      type: "open",
      requestId: message.requestId,
      projectId: message.projectId,
      ...(typeof message.threadId === "string"
        ? { threadId: message.threadId }
        : {}),
      ...(message.workspace === "task" || message.workspace === "original"
        ? { workspace: message.workspace }
        : {}),
      cols: message.cols,
      rows: message.rows,
    };
  }
  if (message.type === "input") {
    if (
      typeof message.sessionId !== "string" ||
      !message.sessionId ||
      typeof message.data !== "string"
    ) {
      throw new Error("Invalid terminal input");
    }
    return {
      type: "input",
      sessionId: message.sessionId,
      data: message.data,
    };
  }
  if (message.type === "resize") {
    if (
      typeof message.sessionId !== "string" ||
      !message.sessionId ||
      typeof message.cols !== "number" ||
      typeof message.rows !== "number"
    ) {
      throw new Error("Invalid terminal resize");
    }
    return {
      type: "resize",
      sessionId: message.sessionId,
      cols: message.cols,
      rows: message.rows,
    };
  }
  if (
    message.type === "close" &&
    typeof message.sessionId === "string" &&
    message.sessionId
  ) {
    return { type: "close", sessionId: message.sessionId };
  }
  throw new Error("Unknown terminal message");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
