import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RemoteRuntimeCredentialStore } from "../src/main/remote-runtime-credential-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RemoteRuntimeCredentialStore", () => {
  it("persists only encrypted runtime tokens", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-runtime-token-"));
    directories.push(root);
    const path = join(root, "credentials.json");
    const store = new RemoteRuntimeCredentialStore(path, {
      encrypt: (value) => Buffer.from(`sealed:${value}`).toString("base64"),
      decrypt: (value) =>
        Buffer.from(value, "base64").toString("utf8").replace(/^sealed:/, ""),
    });

    store.set("project-1", "runtime-secret");

    expect(store.get("project-1")).toBe("runtime-secret");
    expect(readFileSync(path, "utf8")).not.toContain("runtime-secret");
  });
});
