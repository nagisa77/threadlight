import { describe, expect, it } from "vitest";

import {
  taskPath,
  threadIdFromTaskPath,
} from "../src/task-route.js";

describe("Web task routes", () => {
  it("round-trips a task id at the site root", () => {
    const path = taskPath("thread-2");
    expect(path).toBe("/tasks/thread-2");
    expect(threadIdFromTaskPath(path)).toBe("thread-2");
  });

  it("keeps deployment base paths while routing to an exact task", () => {
    const path = taskPath("thread/with spaces", "/threadlight/");
    expect(path).toBe("/threadlight/tasks/thread%2Fwith%20spaces");
    expect(threadIdFromTaskPath(path, "/threadlight/")).toBe(
      "thread/with spaces",
    );
  });

  it("treats non-task and malformed paths as the project default", () => {
    expect(threadIdFromTaskPath("/settings")).toBeUndefined();
    expect(threadIdFromTaskPath("/tasks/%E0%A4%A")).toBeUndefined();
    expect(taskPath(undefined, "/threadlight/")).toBe("/threadlight/");
  });
});
