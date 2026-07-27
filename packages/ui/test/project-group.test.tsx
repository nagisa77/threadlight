import { ThreadlightClient } from "@threadlight/client";
import { projectAgentProgress } from "@threadlight/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  conversationChangesRefreshKey,
  DeleteConversationDialog,
  clampWorkspacePanelWidth,
  ConversationChangesButton,
  currentPlanStep,
  hasUserInput,
  planDocumentOpenRequest,
  ProjectConversationItem,
  ProjectGroup,
  showsProjectLevelActivity,
  ThreadlightApp,
  TurnStatusPill,
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
} from "../src/app.js";

describe("ThreadlightApp", () => {
  it("opens a generated plan document once, then refreshes without stealing focus", () => {
    const plan = {
      source: "user" as const,
      items: [{ step: "Inspect", status: "in_progress" as const }],
      documentPath: ".threadlight/plans/run-1.md",
      documentVersion: "0123456789abcdef",
    };
    const first = planDocumentOpenRequest(
      plan,
      "thread-1",
      undefined,
      1,
    );
    const refresh = planDocumentOpenRequest(
      { ...plan, documentVersion: "fedcba9876543210" },
      "thread-1",
      first?.documentKey,
      2,
    );
    const nextTurn = planDocumentOpenRequest(
      {
        ...plan,
        documentPath: ".threadlight/plans/run-2.md",
        documentVersion: "0011223344556677",
      },
      "thread-1",
      first?.documentKey,
      3,
    );

    expect(first).toMatchObject({
      openPanel: true,
      request: {
        path: ".threadlight/plans/run-1.md",
        activate: true,
      },
    });
    expect(refresh).toMatchObject({
      openPanel: false,
      request: {
        path: ".threadlight/plans/run-1.md",
        activate: false,
      },
    });
    expect(nextTurn).toMatchObject({
      openPanel: true,
      request: {
        path: ".threadlight/plans/run-2.md",
        activate: true,
      },
    });
  });

  it("starts the sidebar with the new task action instead of a brand row", () => {
    const client = new ThreadlightClient({
      send: vi.fn(),
      onMessage: () => () => undefined,
    });
    const emptySnapshot = { projects: [] };
    const projects = {
      load: vi.fn(async () => emptySnapshot),
      openFolder: vi.fn(async () => emptySnapshot),
      activate: vi.fn(async () => emptySnapshot),
      upsertConversation: vi.fn(async () => emptySnapshot),
      deleteConversation: vi.fn(async () => emptySnapshot),
    };

    const html = renderToStaticMarkup(
      <ThreadlightApp client={client} projects={projects} />,
    );

    expect(html).toContain(
      '<div class="window-drag-region"></div><button class="new-thread-button project-row pressable"',
    );
    expect(html).not.toContain('class="brand"');
    client.dispose();
  });

  it("keeps both chat and workspace panel usable while resizing", () => {
    expect(clampWorkspacePanelWidth(200, 1200)).toBe(420);
    expect(clampWorkspacePanelWidth(640, 1200)).toBe(640);
    expect(clampWorkspacePanelWidth(1000, 1200)).toBe(840);
  });
});

describe("ConversationChangesButton", () => {
  it("renders the file change summary used by the floating status pill", () => {
    const html = renderToStaticMarkup(
      <ConversationChangesButton
        changes={{
          threadId: "thread-1",
          revision: "revision-1",
          additions: 12,
          deletions: 3,
          files: [
            {
              path: "src/index.ts",
              status: "modified",
              additions: 12,
              deletions: 3,
              binary: false,
              oldContent: "before\n",
              newContent: "after\n",
            },
          ],
        }}
        onOpen={vi.fn()}
      />,
    );

    expect(html).toContain('class="conversation-changes-button pressable"');
    expect(html).toContain("1 个文件已更改");
    expect(html).toContain("+12");
    expect(html).toContain("-3");
  });

  it("combines the current plan step and file changes with hover details", () => {
    const plan = {
      source: "model" as const,
      items: [
        { step: "梳理工具层", status: "completed" as const },
        { step: "实现 Plan 模式", status: "in_progress" as const },
        { step: "运行离线测试", status: "pending" as const },
      ],
    };
    const html = renderToStaticMarkup(
      <TurnStatusPill
        plan={plan}
        changes={{
          threadId: "thread-1",
          revision: "revision-1",
          additions: 134,
          deletions: 0,
          files: [
            {
              path: "src/index.ts",
              status: "modified",
              additions: 134,
              deletions: 0,
              binary: false,
              oldContent: "before\n",
              newContent: "after\n",
            },
          ],
        }}
        onOpenChanges={vi.fn()}
      />,
    );

    expect(currentPlanStep(plan)).toBe(2);
    expect(html).toContain("第 2 / 3 步");
    expect(html).toContain("梳理工具层");
    expect(html).toContain("实现 Plan 模式");
    expect(html).toContain("运行离线测试");
    expect(html).toContain("1 个文件已更改");
    expect(html).toContain("+134");
    expect(html).toContain("-0");
    expect(html).toContain('class="turn-status-separator">·</span>');
  });
});

describe("conversation change refresh tools", () => {
  it("refreshes after a scripted workspace tool completes, not after read-only tools", () => {
    let progress = projectAgentProgress([], {
      type: "tool.started",
      runId: "run-1",
      call: { id: "read-1", name: "web_search", arguments: {} },
    });
    expect(conversationChangesRefreshKey(progress)).toBe("");

    progress = projectAgentProgress(progress, {
      type: "tool.completed",
      runId: "run-1",
      result: {
        callId: "read-1",
        name: "web_search",
        output: "search result",
      },
    });
    expect(conversationChangesRefreshKey(progress)).toBe("");

    progress = projectAgentProgress(progress, {
      type: "tool.started",
      runId: "run-1",
      call: { id: "write-1", name: "exec_command", arguments: {} },
    });
    expect(conversationChangesRefreshKey(progress)).toBe("");

    progress = projectAgentProgress(progress, {
      type: "tool.completed",
      runId: "run-1",
      result: {
        callId: "write-1",
        name: "exec_command",
        output: "command completed",
      },
    });
    expect(conversationChangesRefreshKey(progress)).toBe(
      "write-1:completed:",
    );
  });

  it("keeps direct file and managed-process tools in one explicit list", () => {
    expect(WORKSPACE_CHANGE_REFRESH_TOOL_NAMES).toEqual([
      "exec_command",
      "process_status",
      "process_read",
      "process_wait",
      "process_kill",
      "apply_patch",
      "write_file",
      "edit_file",
    ]);
  });
});

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

  it("uses the thinking spinner for running projects and tasks", () => {
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
              title: "整理发布说明",
              createdAt: "2026-07-21T00:00:00.000Z",
              updatedAt: "2026-07-21T00:00:00.000Z",
            },
          ],
        }}
        active
        activeThreadId="thread-1"
        runningThreadIds={["thread-1"]}
        computerThreadId="thread-1"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("project-runtime-indicator spin");
    expect(html).toContain("project-live-indicators");
    expect(html).toContain("computer-use-indicator");
    expect(html).toContain("ResourceFinder 中有任务正在运行");
    expect(html.indexOf("project-runtime-indicator")).toBeLessThan(
      html.indexOf("computer-use-indicator"),
    );
  });

  it("moves project activity down to the task layer while expanded", () => {
    expect(showsProjectLevelActivity(false, true)).toBe(true);
    expect(showsProjectLevelActivity(true, true)).toBe(false);
  });

  it("keeps a running task selectable but hides its delete action", () => {
    const html = renderToStaticMarkup(
      <ProjectConversationItem
        conversation={{
          id: "thread-1",
          title: "整理发布说明",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        }}
        active={false}
        running
        disabled={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("thread-runtime-indicator spin");
    expect(html).not.toContain("删除任务");
    expect(html).not.toContain('disabled=""');
  });

  it("shows computer use after the running indicator on its task", () => {
    const html = renderToStaticMarkup(
      <ProjectConversationItem
        conversation={{
          id: "thread-1",
          title: "整理发布说明",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        }}
        active={false}
        running
        computerActive
        disabled={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain("thread-live-indicators");
    expect(html).toContain("thread-runtime-indicator spin");
    expect(html).toContain("computer-use-indicator");
    expect(html.indexOf("thread-runtime-indicator")).toBeLessThan(
      html.indexOf("computer-use-indicator"),
    );
    expect(html).not.toContain("删除任务");
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
