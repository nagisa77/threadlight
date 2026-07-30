import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HostCredentialStore } from "../src/main/host-credential-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("HostCredentialStore", () => {
  it("persists only encrypted host tokens", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-host-token-"));
    directories.push(root);
    const path = join(root, "credentials.json");
    const store = new HostCredentialStore(path, {
      encrypt: (value) => Buffer.from(`sealed:${value}`).toString("base64"),
      decrypt: (value) =>
        Buffer.from(value, "base64").toString("utf8").replace(/^sealed:/, ""),
    });

    store.set("host-1", "host-secret");

    expect(store.get("host-1")).toBe("host-secret");
    expect(readFileSync(path, "utf8")).not.toContain("host-secret");
  });
});
