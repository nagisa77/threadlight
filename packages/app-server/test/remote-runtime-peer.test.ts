import { fileURLToPath } from "node:url";

import type {
  DesktopConnectionRequest,
  JsonRpcOutgoing,
} from "@threadlight/protocol";
import { describe, expect, it, vi } from "vitest";

import { JsonLineRuntimePeer } from "../src/remote-runtime-peer.js";

describe("JsonLineRuntimePeer", () => {
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
        callbackPrefix:
          "https://host.example/v1/host/oauth/callback",
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
});
