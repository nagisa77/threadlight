import { describe, expect, it } from "vitest";

import { runtimeConnectionKey } from "../src/main/runtime-connection-key.js";

describe("runtimeConnectionKey", () => {
  it("shares one remote event stream across every workspace in a project", () => {
    const projectRuntime = runtimeConnectionKey(
      "project-1",
      "/workspace/project",
      true,
    );
    const firstTaskRuntime = runtimeConnectionKey(
      "project-1",
      "/host/worktrees/task-1",
      true,
    );
    const secondTaskRuntime = runtimeConnectionKey(
      "project-1",
      "/host/worktrees/task-2",
      true,
    );

    expect(firstTaskRuntime).toBe(projectRuntime);
    expect(secondTaskRuntime).toBe(projectRuntime);
  });

  it("keeps local workspace runtimes isolated", () => {
    expect(
      runtimeConnectionKey("project-1", "/workspace/task-1", false),
    ).not.toBe(
      runtimeConnectionKey("project-1", "/workspace/task-2", false),
    );
  });
});
