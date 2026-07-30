import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";
import { afterEach, describe, expect, it } from "vitest";

import type { RuntimePeer } from "../src/remote-runtime-peer.js";
import { RemoteRuntimeServer } from "../src/remote-runtime-server.js";

const directories: string[] = [];
const servers: RemoteRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RemoteRuntimeServer", () => {
  it("authenticates requests and rewrites scripted runtime response ids", async () => {
    const workspace = createWorkspace();
    const peer = new ScriptedRuntimePeer((request, emit) => {
      emit({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { threadId: "remote-thread" },
      });
    });
    const server = new RemoteRuntimeServer({
      peer,
      token: "test-token",
      workspaceRoot: workspace,
      port: 0,
      runtimeId: "runtime-1",
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${endpoint}/v1/health`)).status).toBe(401);
    const health = await authenticatedJson(`${endpoint}/v1/health`);
    expect(health).toMatchObject({
      ok: true,
      protocolVersion: 1,
      runtimeId: "runtime-1",
      workspacePath: workspace,
    });

    const response = await fetch(`${endpoint}/v1/rpc`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "thread/start",
      }),
    });
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { threadId: "remote-thread" },
    });
    expect(peer.requests[0]?.id).toMatch(/^remote:/);
  });

  it("streams notifications and exposes read-only workspace review", async () => {
    const workspace = createWorkspace();
    const peer = new ScriptedRuntimePeer();
    const server = new RemoteRuntimeServer({
      peer,
      token: "test-token",
      workspaceRoot: workspace,
      port: 0,
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const events = await fetch(`${endpoint}/v1/events`, {
      headers: { Authorization: "Bearer test-token" },
    });
    const reader = events.body!.getReader();
    await reader.read();
    peer.emit({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: "remote-thread" },
    });
    const eventChunk = await reader.read();
    expect(new TextDecoder().decode(eventChunk.value)).toContain(
      '"method":"turn/completed"',
    );
    await reader.cancel();

    const entries = await authenticatedJson(
      `${endpoint}/v1/workspace/list`,
    ) as Array<{ path: string }>;
    expect(entries.map((entry) => entry.path)).toContain("src");
    const file = await authenticatedJson(
      `${endpoint}/v1/workspace/file?path=src%2Findex.ts`,
    );
    expect(file).toMatchObject({
      path: "src/index.ts",
      content: "export const value = 2;\n",
      binary: false,
    });
    const changes = await authenticatedJson(
      `${endpoint}/v1/workspace/changes`,
    ) as { files: Array<{ path: string; status: string }> };
    expect(changes.files).toEqual([
      expect.objectContaining({ path: "src/index.ts", status: "modified" }),
    ]);
  });
});

class ScriptedRuntimePeer implements RuntimePeer {
  readonly requests: JsonRpcRequest[] = [];
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();

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

  emit(message: JsonRpcOutgoing): void {
    for (const listener of this.listeners) listener(message);
  }

  async stop(): Promise<void> {}
}

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "threadlight-remote-runtime-"));
  directories.push(workspace);
  mkdirSync(join(workspace, "src"));
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "test@threadlight.local"], {
    cwd: workspace,
  });
  execFileSync("git", ["config", "user.name", "Threadlight Test"], {
    cwd: workspace,
  });
  writeFileSync(join(workspace, "src", "index.ts"), "export const value = 1;\n");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: workspace });
  writeFileSync(join(workspace, "src", "index.ts"), "export const value = 2;\n");
  return workspace;
}

async function authenticatedJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: "Bearer test-token" },
  });
  expect(response.ok).toBe(true);
  return response.json();
}
