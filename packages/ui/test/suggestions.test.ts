import { describe, expect, it } from "vitest";

import { suggestionScopeKey } from "../src/features/task-session/controller.js";

describe("suggestion scope", () => {
  it("loads project suggestions for a new draft without creating a thread", () => {
    expect(
      suggestionScopeKey({
        projectId: "project-1",
        newTaskDraft: true,
        language: "zh-CN",
      }),
    ).toBe("project:project-1\u0000zh-CN");
  });

  it("keeps existing empty-thread suggestions scoped to their owner", () => {
    expect(
      suggestionScopeKey({
        threadId: "thread-1",
        projectId: "project-1",
        newTaskDraft: false,
        language: "en",
      }),
    ).toBe("thread:thread-1\u0000en");
  });

  it("does not request suggestions outside a project or thread", () => {
    expect(
      suggestionScopeKey({
        newTaskDraft: true,
        language: "en",
      }),
    ).toBe("");
  });
});
