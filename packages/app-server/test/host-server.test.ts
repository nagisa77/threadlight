import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProjectStore, SettingsStore } from "@threadlight/host-core";
import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import type {
  TerminalSessionController,
} from "@threadlight/terminal-core";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { ThreadlightHostServer } from "../src/host-server.js";
import type { RuntimePeer } from "../src/remote-runtime-peer.js";

const directories: string[] = [];
const servers: ThreadlightHostServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ThreadlightHostServer", () => {
  it("serves multiple projects and host-owned settings with scripted peers", async () => {
    const root = temporaryDirectory("threadlight-host-");
    const firstWorkspace = createWorkspace(root, "first", "first");
    const secondWorkspace = createWorkspace(root, "second", "second");
    const systemFiles = join(root, "system-files");
    mkdirSync(join(systemFiles, "nested"), { recursive: true });
    writeFileSync(join(systemFiles, "notes.txt"), "remote notes\n");
    const ids = ["project-1", "project-2"];
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => ids.shift() ?? "unexpected",
    });
    projects.register(firstWorkspace);
    projects.register(secondWorkspace);
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => `sealed:${value}`,
        decrypt: (value) => value.replace(/^sealed:/, ""),
      },
    );
    const peers = new Map<string, ScriptedRuntimePeer>();
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
      projects,
      settings,
      port: 0,
      createPeer: ({ projectId }) => {
        const peer = new ScriptedRuntimePeer((request, emit) => {
          emit({
            jsonrpc: "2.0",
            id: request.id ?? null,
            result: { threadId: `${projectId}-thread` },
          });
        });
        peers.set(projectId, peer);
        return peer;
      },
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${endpoint}/v1/health`)).status).toBe(401);
    expect(await authenticatedJson(`${endpoint}/v1/health`)).toEqual({
      ok: true,
      protocolVersion: 2,
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
    });

    const snapshot = (await authenticatedJson(
      `${endpoint}/v1/host/projects`,
    )) as { projects: Array<{ id: string; basePath: string }> };
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.projects.map(({ basePath }) => basePath)).toEqual([
      realpathSync(firstWorkspace),
      realpathSync(secondWorkspace),
    ]);
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/directories?path=${encodeURIComponent(join(root, "f"))}`,
      ),
    ).toEqual({
      path: root,
      directories: [
        {
          name: "first",
          path: firstWorkspace,
        },
      ],
    });
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/files?path=${encodeURIComponent(systemFiles)}`,
      ),
    ).toEqual({
      path: realpathSync(systemFiles),
      parentPath: realpathSync(root),
      entries: [
        {
          name: "nested",
          path: join(realpathSync(systemFiles), "nested"),
          kind: "directory",
        },
        {
          name: "notes.txt",
          path: join(realpathSync(systemFiles), "notes.txt"),
          kind: "file",
        },
      ],
    });
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/file?path=${encodeURIComponent(join(systemFiles, "notes.txt"))}`,
      ),
    ).toEqual({
      path: realpathSync(join(systemFiles, "notes.txt")),
      name: "notes.txt",
      content: "remote notes\n",
      binary: false,
      size: 13,
    });

    const firstFile = await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/workspace/file?path=src%2Findex.ts`,
    );
    const secondFile = await authenticatedJson(
      `${endpoint}/v1/projects/project-2/runtime/workspace/file?path=src%2Findex.ts`,
    );
    expect(firstFile).toMatchObject({ content: "export const value = 'first';\n" });
    expect(secondFile).toMatchObject({ content: "export const value = 'second';\n" });

    const rpcResponse = await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/rpc`,
      {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 42,
          method: "thread/start",
        },
      },
    );
    expect(rpcResponse).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { threadId: "project-1-thread" },
    });
    expect(peers.get("project-1")?.requests[0]?.id).toMatch(/^host:/);
    expect(peers.has("project-2")).toBe(true);

    const currentSettings = (await authenticatedJson(
      `${endpoint}/v1/host/settings`,
    )) as Record<string, unknown>;
    const updatedSettings = await authenticatedJson(
      `${endpoint}/v1/host/settings`,
      {
        method: "PUT",
        body: {
          ...currentSettings,
          provider: "openai",
          model: "scripted-model",
          openAIApiKey: "remote-only-key",
        },
      },
    );
    expect(updatedSettings).toMatchObject({
      model: "scripted-model",
      openAIApiKeyConfigured: true,
    });
    expect(settings.runtimeSettings().openAIApiKey).toBe("remote-only-key");
  });

  it("fails pending RPC requests immediately when a runtime exits", async () => {
    const root = temporaryDirectory("threadlight-host-exit-");
    const workspace = createWorkspace(root, "project", "value");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => value,
        decrypt: (value) => value,
      },
    );
    let peer: ScriptedRuntimePeer;
    peer = new ScriptedRuntimePeer(() => {
      peer.exit(new Error("Runtime configuration is unavailable."));
    });
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
      projects,
      settings,
      port: 0,
      createPeer: () => peer,
    });
    servers.push(server);
    const address = await server.start();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/projects/project-1/runtime/rpc`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        }),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32002,
        message: "Runtime configuration is unavailable.",
      },
    });
  });

  it("owns interactive terminal sessions on the Host over an authenticated WebSocket", async () => {
    const root = temporaryDirectory("threadlight-host-terminal-");
    const workspace = createWorkspace(root, "project", "value");
    const taskWorkspace = join(root, "task-workspace");
    mkdirSync(taskWorkspace);
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    projects.setConversationWorkspace(
      { projectId: "project-1", id: "thread-1" },
      { mode: "folder", path: taskWorkspace },
    );
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => value,
        decrypt: (value) => value,
      },
    );
    const terminalSessions: ScriptedTerminalSessions[] = [];
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
      projects,
      settings,
      port: 0,
      createPeer: () => new ScriptedRuntimePeer(),
      createTerminalSessions: (send) => {
        const sessions = new ScriptedTerminalSessions(send);
        terminalSessions.push(sessions);
        return sessions;
      },
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    expect(await authenticatedJson(`${endpoint}/v1/health`)).toMatchObject({
      capabilities: { terminal: true },
    });

    const unauthorizedStatus = await rejectedWebSocketStatus(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
    );
    expect(unauthorizedStatus).toBe(401);

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
      {
        headers: { Authorization: "Bearer test-token" },
      },
    );
    await webSocketOpened(socket);
    const openedMessage = nextWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        type: "open",
        requestId: "open-1",
        projectId: "project-1",
        threadId: "thread-1",
        cols: 100,
        rows: 30,
      }),
    );
    expect(await openedMessage).toEqual({
      type: "opened",
      requestId: "open-1",
      session: { id: "terminal-1", shell: "zsh" },
    });
    expect(terminalSessions[0]?.creates).toEqual([
      { cwd: realpathSync(taskWorkspace), cols: 100, rows: 30 },
    ]);

    const dataMessage = nextWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        type: "input",
        sessionId: "terminal-1",
        data: "pwd\r",
      }),
    );
    expect(await dataMessage).toEqual({
      type: "data",
      sessionId: "terminal-1",
      data: "echo:pwd\r",
    });
    socket.send(
      JSON.stringify({
        type: "resize",
        sessionId: "terminal-1",
        cols: 120,
        rows: 36,
      }),
    );
    socket.send(
      JSON.stringify({
        type: "close",
        sessionId: "terminal-1",
      }),
    );
    await waitFor(() => terminalSessions[0]?.closed.length === 1);
    expect(terminalSessions[0]?.resizes).toEqual([
      { sessionId: "terminal-1", cols: 120, rows: 36 },
    ]);
    expect(terminalSessions[0]?.closed).toEqual(["terminal-1"]);

    socket.close();
    await webSocketClosed(socket);
    await waitFor(() => terminalSessions[0]?.disposed === true);
    expect(terminalSessions[0]?.disposed).toBe(true);
  });
});

class ScriptedTerminalSessions implements TerminalSessionController {
  readonly creates: Array<{ cwd: string; cols: number; rows: number }> = [];
  readonly writes: Array<{ sessionId: string; data: string }> = [];
  readonly resizes: Array<{
    sessionId: string;
    cols: number;
    rows: number;
  }> = [];
  readonly closed: string[] = [];
  disposed = false;

  constructor(
    private readonly send: (event: TerminalSessionEvent) => void,
  ) {}

  create(cwd: string, cols: number, rows: number) {
    this.creates.push({ cwd, cols, rows });
    return { id: "terminal-1", shell: "zsh" };
  }

  write(sessionId: string, data: string): void {
    this.writes.push({ sessionId, data });
    this.send({ type: "data", sessionId, data: `echo:${data}` });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.resizes.push({ sessionId, cols, rows });
  }

  close(sessionId: string): void {
    this.closed.push(sessionId);
  }

  dispose(): void {
    this.disposed = true;
  }
}

class ScriptedRuntimePeer implements RuntimePeer {
  readonly requests: JsonRpcRequest[] = [];
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();
  private readonly exitListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly script?: (
      request: JsonRpcRequest,
      emit: (message: JsonRpcOutgoing) => void,
    ) => void,
  ) {}

  async start(): Promise<void> {}

  send(request: JsonRpcRequest): void {
    this.requests.push(request);
    this.script?.(request, (message) => this.emit(message));
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emit(message: JsonRpcOutgoing): void {
    for (const listener of this.listeners) listener(message);
  }

  exit(error: Error): void {
    for (const listener of this.exitListeners) listener(error);
  }

  async stop(): Promise<void> {}
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function createWorkspace(
  root: string,
  name: string,
  value: string,
): string {
  const workspace = join(root, name);
  mkdirSync(join(workspace, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "test@threadlight.local"], {
    cwd: workspace,
  });
  execFileSync("git", ["config", "user.name", "Threadlight Test"], {
    cwd: workspace,
  });
  writeFileSync(
    join(workspace, "src", "index.ts"),
    `export const value = '${value}';\n`,
  );
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: workspace });
  return workspace;
}

async function authenticatedJson(
  url: string,
  options: { method?: "POST" | "PUT"; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: "Bearer test-token",
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

function webSocketOpened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function webSocketClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", resolve));
}

function nextWebSocketMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData) => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

function rejectedWebSocketStatus(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("Unauthenticated WebSocket unexpectedly opened"));
    });
    socket.once("error", () => {
      // The status arrives through unexpected-response.
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for terminal event");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
