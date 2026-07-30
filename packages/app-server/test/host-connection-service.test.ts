import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HostConnectionService,
  HostConnectionStore,
} from "../src/host-connection-service.js";

const directories: string[] = [];
const codec = {
  encrypt: (value: string) =>
    Buffer.from(`sealed:${value}`, "utf8").toString("base64"),
  decrypt: (value: string) => {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.startsWith("sealed:")) throw new Error("invalid");
    return decoded.slice("sealed:".length);
  },
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("HostConnectionService", () => {
  it("encrypts credentials and completes a state-bound OAuth callback offline", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "threadlight-host-oauth-"),
    );
    directories.push(directory);
    const path = join(directory, "connection-store.json");
    const store = new HostConnectionStore(path, codec);
    const opened = vi.fn();
    const service = new HostConnectionService(store, opened);

    await service.handle(request(1, "connection/configure", {
      connectorId: "gmail",
      version: "1.0.0",
      clientId: "fixture-client-id",
      clientSecret: "fixture-client-secret",
    }));
    expect(readFileSync(path, "utf8")).not.toContain(
      "fixture-client-secret",
    );
    await expect(
      service.handle(request(2, "connection/status", {
        connectorId: "gmail",
        version: "1.0.0",
      })),
    ).resolves.toMatchObject({
      configured: true,
      authorized: false,
    });

    const created = (await service.handle(
      request(3, "connection/create-state", {
        connectorId: "gmail",
        version: "1.0.0",
      }),
    )) as { state: string };
    const waiting = service.handle(
      request(4, "connection/wait-code", {
        connectorId: "gmail",
        version: "1.0.0",
        timeoutMs: 1_000,
      }),
    );
    expect(
      store.acceptAuthorizationCallback({
        connectorId: "gmail",
        code: "wrong-code",
        state: "wrong-state",
      }),
    ).toBe(false);
    expect(
      store.acceptAuthorizationCallback({
        connectorId: "gmail",
        code: "fixture-auth-code",
        state: created.state,
      }),
    ).toBe(true);
    await expect(waiting).resolves.toEqual({
      code: "fixture-auth-code",
    });

    await service.handle(
      request(5, "connection/open-authorization", {
        connectorId: "gmail",
        version: "1.0.0",
        url: "https://accounts.example/authorize?state=fixture",
      }),
    );
    expect(opened).toHaveBeenCalledWith(
      "https://accounts.example/authorize?state=fixture",
    );
  });

  it("rejects non-HTTPS authorization destinations", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "threadlight-host-oauth-url-"),
    );
    directories.push(directory);
    const service = new HostConnectionService(
      new HostConnectionStore(
        join(directory, "connection-store.json"),
        codec,
      ),
      vi.fn(),
    );

    await expect(
      service.handle(
        request(1, "connection/open-authorization", {
          connectorId: "gmail",
          version: "1.0.0",
          url: "http://accounts.example/authorize",
        }),
      ),
    ).rejects.toThrow("must use HTTPS");
  });
});

function request(
  id: number,
  method:
    | "connection/configure"
    | "connection/status"
    | "connection/create-state"
    | "connection/wait-code"
    | "connection/open-authorization",
  params: Record<string, unknown>,
) {
  return { jsonrpc: "2.0" as const, id, method, params };
}
