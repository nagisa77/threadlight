import { createServer, type Server } from "node:http";

import type { TerminalSessionEvent } from "@threadlight/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  WebSocket,
  WebSocketServer,
} from "ws";

import { RemoteTerminalClient } from "../src/main/remote-terminal-client.js";

const servers: Array<{
  http: Server;
  webSocket: WebSocketServer;
}> = [];
const clients: RemoteTerminalClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  await Promise.all(
    servers.splice(0).map(
      ({ http, webSocket }) =>
        new Promise<void>((resolve) => {
          for (const socket of webSocket.clients) socket.terminate();
          webSocket.close();
          http.close(() => resolve());
        }),
    ),
  );
});

describe("RemoteTerminalClient", () => {
  it("authenticates once and multiplexes terminal input and events", async () => {
    const received: unknown[] = [];
    let authorization: string | undefined;
    const endpoint = await terminalServer((socket, request) => {
      authorization = request.headers.authorization;
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as {
          type: string;
          requestId?: string;
          sessionId?: string;
          data?: string;
        };
        received.push(message);
        if (message.type === "open") {
          socket.send(
            JSON.stringify({
              type: "opened",
              requestId: message.requestId,
              session: {
                id: "terminal-1",
                shell: "zsh",
                cwd: "/workspace/threadlight-task",
                branch: "threadlight/task",
              },
            }),
          );
        }
        if (message.type === "input") {
          socket.send(
            JSON.stringify({
              type: "data",
              sessionId: message.sessionId,
              data: `echo:${message.data}`,
            }),
          );
        }
      });
    });
    const events: TerminalSessionEvent[] = [];
    const client = new RemoteTerminalClient({
      endpoint,
      token: "host-token",
      send: (event) => events.push(event),
    });
    clients.push(client);

    await expect(
      client.create({
        projectId: "project-1",
        threadId: "thread-1",
        workspace: "task",
        cols: 100,
        rows: 30,
      }),
    ).resolves.toEqual({
      id: "terminal-1",
      shell: "zsh",
      cwd: "/workspace/threadlight-task",
      branch: "threadlight/task",
    });
    expect(authorization).toBe("Bearer host-token");

    client.write("terminal-1", "pwd\r");
    await waitFor(() => events.length === 1);
    expect(events).toEqual([
      {
        type: "data",
        sessionId: "terminal-1",
        data: "echo:pwd\r",
      },
    ]);

    client.resize("terminal-1", 120, 36);
    client.close("terminal-1");
    await waitFor(() => received.some(isCloseMessage));
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "open",
          projectId: "project-1",
          threadId: "thread-1",
          workspace: "task",
        }),
        {
          type: "input",
          sessionId: "terminal-1",
          data: "pwd\r",
        },
        {
          type: "resize",
          sessionId: "terminal-1",
          cols: 120,
          rows: 36,
        },
        {
          type: "close",
          sessionId: "terminal-1",
        },
      ]),
    );
  });

  it("surfaces a Host-side terminal creation error", async () => {
    const endpoint = await terminalServer((socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as {
          type: string;
          requestId: string;
        };
        socket.send(
          JSON.stringify({
            type: "error",
            requestId: message.requestId,
            message: "Unknown project: missing",
          }),
        );
      });
    });
    const client = new RemoteTerminalClient({
      endpoint,
      token: "host-token",
      send: () => undefined,
    });
    clients.push(client);

    await expect(
      client.create({
        projectId: "missing",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("Unknown project: missing");
  });

  it("rejects malformed Host messages without crashing the desktop process", async () => {
    const endpoint = await terminalServer((socket) => {
      socket.on("message", () => {
        socket.send(
          JSON.stringify({
            type: "opened",
            requestId: "missing-session",
          }),
        );
      });
    });
    const client = new RemoteTerminalClient({
      endpoint,
      token: "host-token",
      send: () => undefined,
    });
    clients.push(client);

    await expect(
      client.create({
        projectId: "project-1",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow("connection was lost");
  });
});

async function terminalServer(
  onConnection: (
    socket: WebSocket,
    request: import("node:http").IncomingMessage,
  ) => void,
): Promise<string> {
  const http = createServer();
  const webSocket = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    webSocket.handleUpgrade(request, socket, head, (connection) => {
      webSocket.emit("connection", connection, request);
    });
  });
  webSocket.on("connection", onConnection);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => {
      http.off("error", reject);
      resolve();
    });
  });
  servers.push({ http, webSocket });
  const address = http.address();
  if (!address || typeof address === "string") {
    throw new Error("Test terminal server did not receive an address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function isCloseMessage(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "close"
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for remote terminal event");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
