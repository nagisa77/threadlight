import { join } from "node:path";

import {
  ProjectStore,
  SettingsStore,
  type RemoteBrowserService,
  type RemoteBrowserSessions,
} from "@threadlight/host-core";
import { browserTerminalProtocols } from "@threadlight/client";
import type {
  BrowserSessionEvent,
  BrowserSessionInfo,
  HostBrowserClientMessage,
} from "@threadlight/protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { ThreadlightHostServer } from "../src/host-server.js";
import { parseBrowserMessage } from "../src/host-browser-gateway.js";
import {
  authenticatedJson,
  cleanupHostFixtures,
  createWorkspace,
  nextWebSocketMessage,
  rejectedWebSocketStatus,
  ScriptedRuntimePeer,
  temporaryDirectory,
  trackHostServer,
  waitFor,
  webSocketOpened,
} from "./host-server-fixtures.js";

afterEach(cleanupHostFixtures);

describe("Host browser gateway", () => {
  it("authenticates a browser stream and owns its target-Host commands", async () => {
    const root = temporaryDirectory("threadlight-host-browser-");
    const workspace = createWorkspace(root, "project", "browser");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const connections: ScriptedBrowserSessions[] = [];
    const browserService = {
      createSessions(send: (event: BrowserSessionEvent) => void) {
        const sessions = new ScriptedBrowserSessions(send);
        connections.push(sessions);
        return sessions;
      },
      async close() {},
    } as unknown as RemoteBrowserService;
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Browser host",
      homePath: join(root, "home"),
      projects,
      settings: new SettingsStore(join(root, "home", "settings.json"), {
        encrypt: (value) => value,
        decrypt: (value) => value,
      }),
      browserService,
      port: 0,
      createPeer: () => new ScriptedRuntimePeer(),
    });
    trackHostServer(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;

    await expect(
      authenticatedJson(`${endpoint}/v1/health`),
    ).resolves.toMatchObject({
      capabilities: { browser: true },
    });
    await expect(
      rejectedWebSocketStatus(`ws://127.0.0.1:${address.port}/v1/host/browser`),
    ).resolves.toBe(401);

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/host/browser`,
      browserTerminalProtocols("test-token"),
    );
    await webSocketOpened(socket);
    const opened = nextWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        type: "open",
        requestId: "open-1",
        projectId: "project-1",
        width: 1440,
        height: 900,
      }),
    );
    await expect(opened).resolves.toMatchObject({
      type: "opened",
      requestId: "open-1",
      session: { id: "browser-1", viewport: { width: 1440, height: 900 } },
    });

    socket.send(
      JSON.stringify({
        type: "navigate",
        sessionId: "browser-1",
        url: "http://localhost:3000",
      }),
    );
    await waitFor(() => connections[0]?.commands.length === 1);
    expect(connections[0]?.commands).toEqual([
      {
        type: "navigate",
        sessionId: "browser-1",
        url: "http://localhost:3000",
      },
    ]);
    socket.close();
  });

  it("rejects malformed browser input before it reaches Chrome", () => {
    expect(() =>
      parseBrowserMessage(
        Buffer.from(
          JSON.stringify({
            type: "pointer",
            sessionId: "browser-1",
            phase: "down",
            x: Number.POSITIVE_INFINITY,
            y: 4,
            button: "left",
          }),
        ),
      ),
    ).toThrow("pointer x");
    expect(() =>
      parseBrowserMessage(
        Buffer.from(
          JSON.stringify({
            type: "navigate",
            sessionId: "browser-1",
            url: "",
          }),
        ),
      ),
    ).toThrow("browser URL");
  });
});

class ScriptedBrowserSessions implements RemoteBrowserSessions {
  readonly commands: Array<
    Exclude<HostBrowserClientMessage, { type: "open" }>
  > = [];

  constructor(private readonly send: (event: BrowserSessionEvent) => void) {}

  async create(input: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<BrowserSessionInfo> {
    return {
      id: "browser-1",
      url: "about:blank",
      title: "",
      canGoBack: false,
      canGoForward: false,
      loading: false,
      viewport: {
        width: input.width,
        height: input.height,
        deviceScaleFactor: input.deviceScaleFactor ?? 1,
      },
    };
  }

  owns(sessionId: string): boolean {
    return sessionId === "browser-1";
  }

  async command(
    message: Exclude<HostBrowserClientMessage, { type: "open" }>,
  ): Promise<void> {
    this.commands.push(message);
    if (message.type === "reload") {
      this.send({
        type: "state",
        session: {
          id: message.sessionId,
          url: "http://localhost:3000/",
          title: "Local app",
          canGoBack: false,
          canGoForward: false,
          loading: true,
          viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
        },
      });
    }
  }

  async close(): Promise<void> {}
  async dispose(): Promise<void> {}
}
