import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { JsonRpcOutgoing } from "@threadlight/protocol";

import {
  AppServerProcess,
  resolveAppServerEntry,
} from "../src/main/app-server-process.js";

const entry = fileURLToPath(
  new URL("./fixtures/scripted-server.mjs", import.meta.url),
);
const computerEntry = fileURLToPath(
  new URL("./fixtures/computer-rpc-server.mjs", import.meta.url),
);
const connectionEntry = fileURLToPath(
  new URL("./fixtures/connection-rpc-server.mjs", import.meta.url),
);
const realAppServerEntry = fileURLToPath(
  new URL("../../../packages/app-server/dist/bin.js", import.meta.url),
);

describe("AppServerProcess", () => {
  it("resolves source and packaged app-server entry paths", () => {
    expect(
      resolveAppServerEntry({
        appPath: "/repo/apps/desktop",
        isPackaged: false,
      }),
    ).toBe("/repo/packages/app-server/dist/bin.js");
    expect(
      resolveAppServerEntry({
        appPath: "/Applications/Threadlight.app/Contents/Resources/app.asar",
        isPackaged: true,
      }),
    ).toBe(
      "/Applications/Threadlight.app/Contents/Resources/app.asar/node_modules/@threadlight/app-server/dist/bin.js",
    );
    expect(
      resolveAppServerEntry({
        appPath: "/repo/apps/desktop",
        isPackaged: false,
        override: "/tmp/custom-server.js",
      }),
    ).toBe("/tmp/custom-server.js");
  });

  it("carries JSON-RPC messages over JSONL", async () => {
    const messages: JsonRpcOutgoing[] = [];
    let deliver: ((message: JsonRpcOutgoing) => void) | undefined;
    const response = new Promise<JsonRpcOutgoing>((resolve) => {
      deliver = resolve;
    });
    const server = new AppServerProcess({
      entry,
      cwd: process.cwd(),
      send: (message) => {
        messages.push(message);
        deliver?.(message);
      },
    });

    server.start();
    server.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

    await expect(response).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { accepted: true },
    });
    await expect(server.initialize()).resolves.toBeUndefined();
    expect(messages).toHaveLength(1);
    server.stop();
  });

  it("initializes a fresh runtime without leaking its internal response", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServerProcess({
      entry,
      cwd: process.cwd(),
      send: (message) => messages.push(message),
    });

    server.start();
    await expect(server.initialize()).resolves.toBeUndefined();
    await expect(server.initialize()).resolves.toBeUndefined();
    expect(messages).toEqual([]);

    server.send({ jsonrpc: "2.0", id: 4, method: "environment" });
    await expect(waitForResponse(messages, 4)).resolves.toMatchObject({
      id: 4,
      result: {},
    });
    server.stop();
  });

  it("rejects pending requests when the process stops", async () => {
    let deliver: ((message: JsonRpcOutgoing) => void) | undefined;
    const response = new Promise<JsonRpcOutgoing>((resolve) => {
      deliver = resolve;
    });
    const server = new AppServerProcess({
      entry,
      cwd: process.cwd(),
      send: (message) => deliver?.(message),
    });

    server.start();
    server.send({ jsonrpc: "2.0", id: 2, method: "hang" });
    server.stop();

    await expect(response).resolves.toMatchObject({
      id: 2,
      error: { code: -32010, message: "App server stopped" },
    });
  });

  it("applies updated settings when restarting the process", async () => {
    const messages: JsonRpcOutgoing[] = [];
    let deliver: ((message: JsonRpcOutgoing) => void) | undefined;
    const response = new Promise<JsonRpcOutgoing>((resolve) => {
      deliver = resolve;
    });
    const server = new AppServerProcess({
      entry,
      cwd: process.cwd(),
      send: (message) => {
        messages.push(message);
        deliver?.(message);
      },
    });

    server.start();
    server.restart({ THREADLIGHT_TEST_SETTING: "updated" });
    server.send({ jsonrpc: "2.0", id: 3, method: "environment" });

    await expect(response).resolves.toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { configured: "updated" },
    });
    expect(messages).toHaveLength(1);
    server.stop();
  });

  it("carries desktop computer requests over the private child-process pipe", async () => {
    let deliver: ((message: JsonRpcOutgoing) => void) | undefined;
    const response = new Promise<JsonRpcOutgoing>((resolve) => {
      deliver = resolve;
    });
    const server = new AppServerProcess({
      entry: computerEntry,
      cwd: process.cwd(),
      send: (message) => deliver?.(message),
      handleComputerRequest: async (request) => ({
        handled: request.method,
      }),
    });

    server.start();

    await expect(response).resolves.toEqual({
      jsonrpc: "2.0",
      id: 91,
      result: { handled: "computer/list" },
    });
    server.stop();
  });

  it("keeps connector credentials on a separate private child-process pipe", async () => {
    let deliver: ((message: JsonRpcOutgoing) => void) | undefined;
    const response = new Promise<JsonRpcOutgoing>((resolve) => {
      deliver = resolve;
    });
    const server = new AppServerProcess({
      entry: connectionEntry,
      cwd: process.cwd(),
      send: (message) => deliver?.(message),
      handleConnectionRequest: async (request) => ({
        handled: request.method,
      }),
    });

    server.start();

    await expect(response).resolves.toEqual({
      jsonrpc: "2.0",
      id: 92,
      result: { handled: "connection/get" },
    });
    server.stop();
  });

  it("exposes connector management through the real desktop runtime", async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), "threadlight-desktop-runtime-"),
    );
    const cwd = join(projectRoot, "task-worktree");
    mkdirSync(cwd);
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServerProcess({
      entry: realAppServerEntry,
      cwd,
      environment: {
        OPENAI_API_KEY: "fixture-openai-key",
        THREADLIGHT_COMPUTER_USE: "0",
        THREADLIGHT_PROJECT_ROOT: projectRoot,
      },
      send: (message) => messages.push(message),
      handleConnectionRequest: async (request) => {
        if (request.method === "connection/status") {
          return {
            id: "gmail",
            version: "1.1.0",
            configured: false,
            authorized: false,
          };
        }
        throw new Error(`Unexpected connection request: ${request.method}`);
      },
    });

    try {
      server.start();
      await server.initialize();
      expect(messages).toEqual([]);
      expect(
        existsSync(join(projectRoot, ".threadlight", "MEMORY.md")),
      ).toBe(true);
      expect(
        existsSync(join(cwd, ".threadlight", "MEMORY.md")),
      ).toBe(false);
      server.send({ jsonrpc: "2.0", id: 11, method: "thread/start" });
      const started = await waitForResponse(messages, 11);
      const threadId = (started as { result: { threadId: string } }).result
        .threadId;
      server.send({
        jsonrpc: "2.0",
        id: 12,
        method: "connector/status",
        params: { threadId, capabilityId: "mcp:gmail" },
      });

      await expect(waitForResponse(messages, 12)).resolves.toMatchObject({
        result: {
          capabilityId: "mcp:gmail",
          status: "needs_configuration",
          configured: false,
        },
      });
    } finally {
      server.stop();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

async function waitForResponse(
  messages: readonly JsonRpcOutgoing[],
  id: number,
): Promise<JsonRpcOutgoing> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const message = messages.find(
      (candidate) => "id" in candidate && candidate.id === id,
    );
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for response ${id}`);
}
