import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ExecutionPolicyStore } from "../src/main/execution-policy-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ExecutionPolicyStore", () => {
  it("persists only project-scoped capability grants and can revoke them", () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-policy-"));
    directories.push(directory);
    const path = join(directory, "execution-policies.json");
    const now = new Date("2026-07-30T08:00:00.000Z");
    const store = new ExecutionPolicyStore(path, () => now);

    expect(store.snapshot("project-a")).toEqual({
      projectId: "project-a",
      rules: { read: "allow", write: "ask", destructive: "deny" },
      permanentGrants: [],
    });

    store.grant("project-a", {
      permissionKey: "exec_command:git:commit",
      label: "Run git commit commands",
      external: false,
    });

    expect(store.allows("project-a", "exec_command:git:commit")).toBe(true);
    expect(store.allows("project-b", "exec_command:git:commit")).toBe(false);
    expect(new ExecutionPolicyStore(path).snapshot("project-a")).toMatchObject({
      permanentGrants: [
        {
          permissionKey: "exec_command:git:commit",
          grantedAt: now.toISOString(),
        },
      ],
    });
    expect(readFileSync(path, "utf8")).not.toContain("thread");

    store.revoke("project-a", "exec_command:git:commit");
    expect(store.allows("project-a", "exec_command:git:commit")).toBe(false);
  });
});
