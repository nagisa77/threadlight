import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComposerProductivityStatus } from "../src/features/productivity/composer-status.js";
import {
  composerDraftScope,
  conversationMarkdown,
  exportFilename,
  loadComposerDraft,
  loadMessageBookmarks,
  navigateComposerHistory,
  saveComposerDraft,
  saveMessageBookmarks,
  taskShareReference,
  toggleMessageBookmark,
  type KeyValueStorage,
} from "../src/features/productivity/model.js";
import {
  MessageBookmarksDialog,
  TaskProductivityMenu,
} from "../src/features/productivity/task-actions.js";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("task productivity", () => {
  it("isolates and clears persisted composer drafts by task scope", () => {
    const storage = new MemoryStorage();
    const taskScope = composerDraftScope("project-1", "thread-1", false);
    const newTaskScope = composerDraftScope("project-1", undefined, true);

    saveComposerDraft(storage, taskScope, "Continue the review");
    saveComposerDraft(storage, newTaskScope, "Start something new");

    expect(loadComposerDraft(storage, taskScope)).toBe("Continue the review");
    expect(loadComposerDraft(storage, newTaskScope)).toBe(
      "Start something new",
    );
    saveComposerDraft(storage, taskScope, "  ");
    expect(loadComposerDraft(storage, taskScope)).toBe("");
  });

  it("walks input history and restores the unsent draft", () => {
    const messages = [
      { role: "user" as const, text: "first" },
      { role: "assistant" as const, text: "answer" },
      { role: "user" as const, text: "second" },
    ];
    const older = navigateComposerHistory({
      messages,
      current: "unfinished",
      draft: "",
      index: -1,
      direction: "older",
    });
    const oldest = navigateComposerHistory({
      messages,
      current: older!.value,
      draft: older!.draft,
      index: older!.index,
      direction: "older",
    });
    const newer = navigateComposerHistory({
      messages,
      current: oldest!.value,
      draft: oldest!.draft,
      index: oldest!.index,
      direction: "newer",
    });
    const draft = navigateComposerHistory({
      messages,
      current: newer!.value,
      draft: newer!.draft,
      index: newer!.index,
      direction: "newer",
    });

    expect([older!.value, oldest!.value, newer!.value, draft!.value]).toEqual([
      "second",
      "first",
      "second",
      "unfinished",
    ]);
  });

  it("creates web deep links and portable desktop task references", () => {
    expect(
      taskShareReference(
        "thread-1",
        "https://host.example/app/tasks/thread-1?host=one#message",
      ),
    ).toBe("https://host.example/app/tasks/thread-1?host=one");
    expect(taskShareReference("thread-1", "file:///app/index.html")).toBe(
      "threadlight:task:thread-1",
    );
  });

  it("exports a readable Markdown transcript with a safe filename", () => {
    const markdown = conversationMarkdown({
      title: "Fix: export / paths",
      projectName: "Threadlight",
      threadId: "thread-1",
      messages: [
        { id: "m1", role: "user", text: "Please inspect this." },
        {
          id: "m2",
          role: "assistant",
          text: "Done.",
          attachments: [{ name: "report.txt" }],
        },
      ],
    });

    expect(markdown).toContain("# Fix: export / paths");
    expect(markdown).toContain("## User\n\nPlease inspect this.");
    expect(markdown).toContain("## Threadlight\n\nDone.");
    expect(markdown).toContain("- Attachment: report.txt");
    expect(exportFilename("Fix: export / paths")).toBe(
      "Fix- export - paths.md",
    );
  });

  it("persists unique message bookmarks and renders their review surface", () => {
    const storage = new MemoryStorage();
    const selected = toggleMessageBookmark([], "message-1");
    saveMessageBookmarks(storage, "thread-1", ["message-1", "message-1"]);

    expect(selected).toEqual(["message-1"]);
    expect(loadMessageBookmarks(storage, "thread-1")).toEqual(["message-1"]);
    expect(toggleMessageBookmark(selected, "message-1")).toEqual([]);

    const html = renderToStaticMarkup(
      <MessageBookmarksDialog
        messages={[
          { id: "message-1", role: "assistant", text: "Important result" },
        ]}
        onClose={vi.fn()}
        onJump={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain("消息书签");
    expect(html).toContain("Important result");
    expect(html).toContain('aria-label="移除书签"');
  });

  it("exposes task tools and draft persistence feedback accessibly", () => {
    const menu = renderToStaticMarkup(
      <TaskProductivityMenu
        bookmarkCount={2}
        onCopyReference={vi.fn(async () => {})}
        onExport={vi.fn()}
        onOpenBookmarks={vi.fn()}
      />,
    );
    const status = renderToStaticMarkup(
      <ComposerProductivityStatus hasHistory draftStatus="saved" />,
    );

    expect(menu).toContain('aria-label="任务工具"');
    expect(menu).toContain("task-bookmark-count");
    expect(status).toContain("↑↓ 浏览输入历史");
    expect(status).toContain('role="status"');
    expect(status).toContain("草稿已保存");
  });
});
