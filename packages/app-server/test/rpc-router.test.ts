import { describe, expect, it, vi } from "vitest";

import { RpcError, RpcMethodRouter } from "../src/rpc-router.js";

describe("RpcMethodRouter", () => {
  it("dispatches protocol params without owning domain behavior", async () => {
    const handler = vi.fn(async (params: unknown) => ({ params }));
    const router = new RpcMethodRouter<"example/run">({
      "example/run": handler,
    });

    await expect(
      router.dispatch("example/run", { value: 42 }),
    ).resolves.toEqual({ params: { value: 42 } });
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it("returns the JSON-RPC method-not-found error at the transport boundary", async () => {
    const router = new RpcMethodRouter<"example/run">({
      "example/run": () => "ok",
    });

    await expect(router.dispatch("unknown", undefined)).rejects.toMatchObject<
      Partial<RpcError>
    >({ code: -32601, message: "Method not found: unknown" });
  });
});
