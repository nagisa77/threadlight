import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConnectionStore,
  DesktopConnectionService,
  oauthRedirectUrl,
} from "../src/main/connection-store.js";

const directories: string[] = [];
const codec = {
  encrypt: (value: string) =>
    Buffer.from(`encrypted:${value}`, "utf8").toString("base64"),
  decrypt: (value: string) => {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.startsWith("encrypted:")) throw new Error("invalid");
    return decoded.slice("encrypted:".length);
  },
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ConnectionStore", () => {
  it("encrypts OAuth material and exposes only connector status snapshots", () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-connections-"));
    directories.push(directory);
    const path = join(directory, "connection-store.json");
    const store = new ConnectionStore(path, codec);
    store.set("gmail", "1.0.0", "tokens", {
      access_token: "fixture-access-value",
      refresh_token: "fixture-refresh-value",
    });

    const source = readFileSync(path, "utf8");
    expect(source).not.toContain("fixture-access-value");
    expect(source).not.toContain("fixture-refresh-value");
    expect(store.snapshot()).toEqual([
      {
        id: "gmail",
        version: "1.0.0",
        configured: false,
        authorized: true,
      },
    ]);
    expect(store.get("gmail", "1.0.0", "tokens")).toMatchObject({
      access_token: "fixture-access-value",
    });
  });

  it("validates callback state before releasing an authorization code", async () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-oauth-"));
    directories.push(directory);
    const store = new ConnectionStore(
      join(directory, "connection-store.json"),
      codec,
    );
    const openExternal = vi.fn(async () => undefined);
    const service = new DesktopConnectionService(store, openExternal);
    const created = (await service.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "connection/create-state",
      params: { connectorId: "gmail", version: "1.0.0" },
    })) as { state: string };

    expect(oauthRedirectUrl("gmail")).toBe(
      "http://127.0.0.1:43119/oauth/callback/gmail",
    );
    expect(
      store.acceptAuthorizationCallback(
        new URL(
          `threadlight://oauth/callback/gmail?code=bad&state=wrong`,
        ),
      ),
    ).toBe(false);
    expect(
      store.acceptAuthorizationCallback(
        new URL(
          `threadlight://oauth/callback/gmail?code=auth-code&state=${created.state}`,
        ),
      ),
    ).toBe(true);
    expect(store.takeAuthorizationCode("gmail", "1.0.0")).toBe(
      "auth-code",
    );
    expect(store.takeAuthorizationCode("gmail", "1.0.0")).toBeUndefined();
  });

  it("encrypts client credentials and releases a valid loopback callback to a waiter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-oauth-config-"));
    directories.push(directory);
    const path = join(directory, "connection-store.json");
    const store = new ConnectionStore(path, codec);
    store.configure(
      "gmail",
      "1.1.0",
      "fixture-client-id",
      "fixture-client-secret",
    );
    expect(readFileSync(path, "utf8")).not.toContain(
      "fixture-client-secret",
    );
    expect(store.status("gmail", "1.1.0")).toEqual({
      id: "gmail",
      version: "1.1.0",
      configured: true,
      authorized: false,
    });

    const state = store.createState("gmail", "1.1.0");
    const waiting = store.waitForAuthorizationCode(
      "gmail",
      "1.1.0",
      1_000,
    );
    expect(
      store.acceptAuthorizationCallback(
        new URL(
          `http://127.0.0.1:43119/oauth/callback/gmail?code=loopback-code&state=${state}`,
        ),
      ),
    ).toBe(true);
    await expect(waiting).resolves.toBe("loopback-code");
  });
});
