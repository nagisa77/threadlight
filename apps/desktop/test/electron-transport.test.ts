import { describe, expect, it, vi } from "vitest";

import type { JsonRpcOutgoing } from "@threadlight/protocol";

import { ElectronTransport } from "../src/renderer/electron-transport.js";
import type { DesktopApi } from "../src/shared/desktop-api.js";

describe("ElectronTransport", () => {
  it("adapts the restricted desktop bridge to ClientTransport", () => {
    let receive: ((message: JsonRpcOutgoing) => void) | undefined;
    const unsubscribe = vi.fn();
    const api: DesktopApi = {
      send: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      onMessage(listener) {
        receive = listener;
        return unsubscribe;
      },
    };
    const transport = new ElectronTransport(api);
    const listener = vi.fn();

    const stop = transport.onMessage(listener);
    transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    receive?.({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    stop();

    expect(api.send).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    expect(listener).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
