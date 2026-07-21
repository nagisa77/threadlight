import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DeleteConversationDialog,
  hasUserInput,
  ProjectConversationItem,
  ProjectGroup,
} from "../src/app.js";

describe("ProjectGroup", () => {
  it("only treats a session with user input as an established task", () => {
    expect(hasUserInput([])).toBe(false);
    expect(hasUserInput([{ role: "assistant" }])).toBe(false);
    expect(hasUserInput([{ role: "user" }])).toBe(true);
  });

  it("starts collapsed without a visual active class", () => {
    const html = renderToStaticMarkup(
      <ProjectGroup
        project={{
          id: "project-1",
          name: "ResourceFinder",
          basePath: "/workspace/ResourceFinder",
          lastOpenedAt: "2026-07-21T00:00:00.000Z",
          conversations: [
            {
              id: "thread-1",
              title: "新任务",
              createdAt: "2026-07-21T00:00:00.000Z",
              updatedAt: "2026-07-21T00:00:00.000Z",
            },
          ],
        }}
        active
        activeThreadId="thread-1"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-current="location"');
    expect(html).not.toContain("新任务");
    expect(html).not.toContain("project-row pressable active");
  });

  it("offers an accessible delete action for each task", () => {
    const html = renderToStaticMarkup(
      <ProjectConversationItem
        conversation={{
          id: "thread-1",
          title: "整理发布说明",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        }}
        active
        disabled={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="删除任务“整理发布说明”"');
  });

  it("describes task deletion as irreversible in an alert dialog", () => {
    const html = renderToStaticMarkup(
      <DeleteConversationDialog
        conversation={{
          id: "thread-1",
          title: "整理发布说明",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        }}
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("此操作无法撤销");
  });
});
