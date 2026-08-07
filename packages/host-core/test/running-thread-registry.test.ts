import { describe, expect, it } from "vitest";

import { RunningThreadRegistry } from "../src/running-thread-registry.js";

describe("RunningThreadRegistry", () => {
  it("tracks live turns and clears only the runtime that stopped", () => {
    const registry = new RunningThreadRegistry();
    registry.record("project-1", "runtime-1", {
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        revision: 1,
        mode: "default",
        activeTurn: {
          turnId: "turn-1",
          revision: 1,
          mode: "default",
          isThinking: true,
          streamingText: "",
          progress: [],
        },
      },
    });
    registry.record("project-2", "runtime-2", {
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "thread-2",
        turnId: "turn-2",
        revision: 1,
        mode: "default",
        activeTurn: {
          turnId: "turn-2",
          revision: 1,
          mode: "default",
          isThinking: true,
          streamingText: "",
          progress: [],
        },
      },
    });

    registry.clearRuntime("runtime-1");

    expect(registry.threadIds()).toEqual(["thread-2"]);
  });

  it("removes a thread after either terminal turn notification", () => {
    const registry = new RunningThreadRegistry();
    registry.replaceProjects(
      [
        {
          id: "project-1",
          conversations: [{ id: "failed" }, { id: "completed" }],
        },
      ],
      ["failed", "completed"],
      "runtime-1",
    );

    registry.record("project-1", "runtime-1", {
      jsonrpc: "2.0",
      method: "turn/failed",
      params: {
        threadId: "failed",
        turnId: "turn-1",
        revision: 2,
        error: "failed",
      },
    });
    registry.record("project-1", "runtime-1", {
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: "completed",
        turnId: "turn-2",
        revision: 2,
        output: "done",
      },
    });

    expect(registry.threadIds()).toEqual([]);
  });
});
