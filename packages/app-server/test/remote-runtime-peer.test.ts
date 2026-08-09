import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  DesktopConnectionRequest,
  JsonRpcOutgoing,
} from "@threadlight/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  JsonLineRuntimePeer,
  workspaceRuntimeEnvironment,
} from "../src/remote-runtime-peer.js";

describe("JsonLineRuntimePeer", () => {
  it("prefers project-local runtimes in worktree commands", () => {
    const workspace = mkdtempSync(join(tmpdir(), "threadlight-runtime-env-"));
    try {
      const virtualEnvironmentBin =
        process.platform === "win32" ? "Scripts" : "bin";
      const venv = join(workspace, ".venv", virtualEnvironmentBin);
      const node = join(workspace, "node_modules", ".bin");
      mkdirSync(venv, { recursive: true });
      mkdirSync(node, { recursive: true });

      const environment = workspaceRuntimeEnvironment(workspace, {
        PATH: "/system/bin",
      });
      expect(environment.PATH?.split(delimiter)).toEqual([
        venv,
        node,
        "/system/bin",
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("bridges scripted Connector RPC over the Host-owned pipe", async () => {
    const handleConnectionRequest = vi.fn(
      async (request: DesktopConnectionRequest) => ({
        id: "gmail",
        version: "1.0.0",
        configured: true,
        authorized: false,
        requestId: request.id,
      }),
    );
    const peer = new JsonLineRuntimePeer({
      entry: fileURLToPath(
        new URL("./fixtures/connection-peer.mjs", import.meta.url),
      ),
      cwd: process.cwd(),
      environment: {
        THREADLIGHT_CONNECTION_RPC_FD: "3",
        THREADLIGHT_OAUTH_CALLBACK_URL_PREFIX:
          "https://host.example/v1/host/oauth/callback",
      },
      handleConnectionRequest,
    });
    const message = new Promise<JsonRpcOutgoing>((resolve) => {
      peer.onMessage(resolve);
    });

    await peer.start();
    await expect(message).resolves.toMatchObject({
      method: "fixture/connection-result",
      params: {
        response: {
          jsonrpc: "2.0",
          id: 7,
          result: {
            id: "gmail",
            configured: true,
            requestId: 7,
          },
        },
        callbackPrefix: "https://host.example/v1/host/oauth/callback",
      },
    });
    expect(handleConnectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "connection/status",
        params: {
          connectorId: "gmail",
          version: "1.0.0",
        },
      }),
    );
    await peer.stop();
  });

  it("delivers complete frames and discards a truncated final JSON frame", async () => {
    const onLog = vi.fn();
    const peer = new JsonLineRuntimePeer({
      entry: fileURLToPath(
        new URL("./fixtures/truncated-output-peer.mjs", import.meta.url),
      ),
      cwd: process.cwd(),
      onLog,
    });
    const message = Promise.withResolvers<JsonRpcOutgoing>();
    const exited = Promise.withResolvers<Error>();
    peer.onMessage(message.resolve);
    peer.onExit(exited.resolve);

    await peer.start();

    await expect(message.promise).resolves.toMatchObject({
      method: "fixture/complete-output",
      params: { accepted: true },
    });
    await expect(exited.promise).resolves.toBeInstanceOf(Error);
    expect(onLog).toHaveBeenCalledWith(
      expect.stringContaining("Discarded incomplete app-server output frame"),
    );
    expect(onLog).not.toHaveBeenCalledWith(
      expect.stringContaining("Invalid app-server output"),
    );
  });
});
