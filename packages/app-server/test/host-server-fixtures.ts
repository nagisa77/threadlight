import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CodeHostDeliveryManager,
  ConversationChangeTracker,
  ProjectStore,
  SettingsStore,
  WorktreeDeliveryManager,
  type CodeHostPullRequest,
  type CodeHostProvider,
} from "@threadlight/host-core";
import { browserTerminalProtocols, HttpHostClient } from "@threadlight/client";
import { createRemoteWebSession } from "@threadlight/web-runtime";
import { VOICE_INPUT_ERROR_CODES } from "@threadlight/protocol";
import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import type { TerminalSessionController } from "@threadlight/terminal-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";

import { ThreadlightHostServer } from "../src/host-server.js";
import type { RuntimePeer } from "../src/remote-runtime-peer.js";

const directories: string[] = [];
const servers: ThreadlightHostServer[] = [];

export function trackHostServer(server: ThreadlightHostServer): void {
  servers.push(server);
}
export async function cleanupHostFixtures(): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
}

export class ScriptedCodeHostProvider implements CodeHostProvider {
  readonly pushes: Array<{
    repositoryRoot: string;
    branch: string;
  }> = [];
  private pullRequest?: CodeHostPullRequest;

  status(_repositoryRoot: string, headBranch: string, baseBranch: string) {
    return Promise.resolve({
      provider: "github" as const,
      available: true,
      repository: "threadlight/example",
      remote: "origin",
      taskBranch: headBranch,
      baseBranch,
      pushed: this.pushes.length > 0,
      ahead: 1,
      ...(this.pullRequest ? { pullRequest: this.pullRequest } : {}),
    });
  }

  push(repositoryRoot: string, branch: string): Promise<void> {
    this.pushes.push({ repositoryRoot, branch });
    return Promise.resolve();
  }

  createPullRequest(
    _repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
    input: { title: string; body?: string; draft: boolean },
  ): Promise<CodeHostPullRequest> {
    this.pullRequest = {
      number: 12,
      url: "https://github.example/threadlight/example/pull/12",
      title: input.title,
      state: "open",
      draft: input.draft,
      headBranch,
      baseBranch,
      ciStatus: "none",
      checks: [],
      comments: [],
    };
    return Promise.resolve(this.pullRequest);
  }
}

export class ScriptedTerminalSessions implements TerminalSessionController {
  readonly creates: Array<{ cwd: string; cols: number; rows: number }> = [];
  readonly writes: Array<{ sessionId: string; data: string }> = [];
  readonly resizes: Array<{
    sessionId: string;
    cols: number;
    rows: number;
  }> = [];
  readonly closed: string[] = [];
  disposed = false;

  constructor(private readonly send: (event: TerminalSessionEvent) => void) {}

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

export class ScriptedRuntimePeer implements RuntimePeer {
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

export class TestSseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async nextFrame(): Promise<string> {
    while (true) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        return frame;
      }
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("SSE stream ended before the next frame");
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async nextData(): Promise<string> {
    while (true) {
      const frame = await this.nextFrame();
      if (frame.startsWith("data: ")) return frame.slice("data: ".length);
    }
  }

  cancel(): Promise<void> {
    return this.reader.cancel();
  }
}

export function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

export function createWorkspace(
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

export async function authenticatedJson(
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

export function webSocketOpened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

export function webSocketClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", resolve));
}

export function nextWebSocketMessage(socket: WebSocket): Promise<unknown> {
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

export function rejectedWebSocketStatus(
  url: string,
  options: {
    protocols?: string[];
    origin?: string;
  } = {},
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const socket = options.protocols
      ? new WebSocket(url, options.protocols, {
          ...(options.origin ? { origin: options.origin } : {}),
        })
      : new WebSocket(url, {
          ...(options.origin ? { origin: options.origin } : {}),
        });
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

export async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for terminal event");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
