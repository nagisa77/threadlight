import { describe, expect, it, vi } from "vitest";

import { enterStandaloneDraft } from "../src/features/navigation/runtime-controller.js";
import type { ProjectsSnapshot } from "../src/projects.js";

describe("standalone draft navigation", () => {
  it("starts a fresh draft instead of restoring the first standalone task", () => {
    const snapshot: ProjectsSnapshot = {
      activeProjectId: "standalone",
      projects: [
        {
          id: "standalone",
          name: "Standalone",
          basePath: "/threadlight/standalone",
          scope: "standalone",
          lastOpenedAt: "2026-08-24T00:00:00.000Z",
          conversations: [
            {
              id: "existing-thread",
              title: "Existing standalone task",
              createdAt: "2026-08-23T00:00:00.000Z",
              updatedAt: "2026-08-23T00:00:00.000Z",
            },
          ],
        },
      ],
    };
    const events: string[] = [];
    const beginDraft = vi.fn(() => events.push("begin-draft"));

    enterStandaloneDraft(snapshot, {
      setProjectSnapshot: (next) =>
        events.push(`activate:${next.activeProjectId}`),
      closeConversationPanels: () => events.push("close-panels"),
      showThread: () => events.push("show-thread"),
      beginDraft,
    });

    expect(events).toEqual([
      "activate:standalone",
      "close-panels",
      "show-thread",
      "begin-draft",
    ]);
    expect(beginDraft).toHaveBeenCalledOnce();
  });
});
