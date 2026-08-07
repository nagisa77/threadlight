import { describe, expect, it } from "vitest";

import { scopeFor } from "../src/terminal-context.js";

describe("scopeFor", () => {
  it("opens standalone drafts in the home-backed original context", () => {
    expect(scopeFor({ projectScope: "standalone" })).toBe("original");
  });

  it("opens an existing standalone thread in its isolated task directory", () => {
    expect(
      scopeFor({
        projectScope: "standalone",
        threadId: "thread-1",
        workspaceMode: "standalone",
      }),
    ).toBe("task");
  });

  it("preserves project worktree and local-folder defaults", () => {
    expect(
      scopeFor({
        projectScope: "project",
        threadId: "thread-1",
        workspaceMode: "worktree",
      }),
    ).toBe("task");
    expect(
      scopeFor({
        projectScope: "project",
        threadId: "thread-2",
        workspaceMode: "folder",
      }),
    ).toBe("original");
  });
});
