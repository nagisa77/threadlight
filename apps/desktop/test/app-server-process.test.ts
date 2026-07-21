import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import type { JsonRpcOutgoing } from "@threadlight/protocol";

import { AppServerProcess } from "../src/main/app-server-process.js";

const entry = fileURLToPath(
  new URL("./fixtures/scripted-server.mjs", import.meta.url),
);

describe("AppServerProcess", () => {
  it("carries JSON-RPC messages over JSONL", async () => {
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
    server.send({ jsonrpc: "2.0", id: 1, method: "initialize" });

    await expect(response).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { accepted: true },
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
});
