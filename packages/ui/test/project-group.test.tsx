import { ThreadlightClient } from "@threadlight/client";
import { projectAgentProgress } from "@threadlight/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  conversationChangesRefreshKey,
  conversationContextChanged,
  DeleteConversationDialog,
  clampWorkspacePanelWidth,
  ComputerPermissionCard,
  ConversationChangesButton,
  currentPlanStep,
  filterProjectsForTaskList,
  hasUserInput,
  pendingComputerPermissionResume,
  planDocumentOpenRequest,
  projectContainingThread,
  ProjectActionPopover,
  ProjectConversationItem,
  ProjectGroup,
  ProjectListHeading,
  RecentTasksGroup,
  RemoteRuntimeDialog,
  RuntimeStatusControl,
  showsProjectLevelActivity,
  TaskSearchDialog,
  ThreadlightApp,
  TurnStatusPill,
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
} from "../src/app.js";
import { I18nProvider } from "../src/i18n.js";

describe("ThreadlightApp", () => {
  it("shows both required computer permissions with direct actions", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ComputerPermissionCard
          snapshot={{
            required: true,
            blockingCapability: "screen_recording",
            screenRecording: "denied",
            accessibility: "denied",
            relaunchRequired: false,
          }}
          onRequest={vi.fn()}
          onRefresh={vi.fn()}
          onRelaunch={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain("需要授权才能使用电脑");
    expect(html).toContain("屏幕录制");
    expect(html).toContain("辅助功能");
    expect(html.match(/去授权/g)).toHaveLength(2);
  });

  it("offers one restart action after computer permissions are granted", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ComputerPermissionCard
          snapshot={{
            required: true,
            screenRecording: "granted",
            accessibility: "granted",
            relaunchRequired: true,
          }}
          onRequest={vi.fn()}
          onRefresh={vi.fn()}
          onRelaunch={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain("权限已准备");
    expect(html).toContain("重启并继续");
    expect(html).not.toContain("去授权");
  });

  it("only resumes the matching computer task before the handoff expires", () => {
    const stored = JSON.stringify({
      threadId: "thread-1",
      expiresAt: 2_000,
    });

    expect(pendingComputerPermissionResume(stored, 1_000)).toEqual({
      threadId: "thread-1",
      expiresAt: 2_000,
    });
    expect(pendingComputerPermissionResume(stored, 2_000)).toBeUndefined();
    expect(pendingComputerPermissionResume("invalid", 1_000)).toBeUndefined();
  });

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
      updateConversation: vi.fn(async () => emptySnapshot),
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

  it("combines runtime status and remote entry into one compact row", () => {
    const html = renderToStaticMarkup(
      <RuntimeStatusControl
        status="ready"
        label="运行时已连接"
        mode="本地"
        title="连接 Remote Runtime"
        onOpen={vi.fn()}
      />,
    );

    expect(html).toContain(
      'class="runtime-status-control pressable"',
    );
    expect(html).toContain("运行时已连接");
    expect(html).toContain("本地");
    expect(html).toContain("status-dot ready");
    expect(html).toContain("runtime-status-chevron");
    expect(html).toContain(
      'class="runtime-status-label" title="运行时已连接"',
    );
    expect(html).not.toContain("lucide-server");
  });

  it("offers editing only for saved remote Hosts", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <RemoteRuntimeDialog
          hosts={{
            activeHostId: "local",
            hosts: [
              {
                id: "local",
                name: "This Mac",
                kind: "local",
              },
              {
                id: "build-host",
                name: "Build Host",
                kind: "remote",
                endpoint: "https://host.example.test",
              },
            ],
          }}
          activeHostId="local"
          busy={false}
          onCancel={vi.fn()}
          onActivate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
          onConnect={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="编辑 Host“Build Host”"');
    expect(html).not.toContain('aria-label="编辑 Host“This Mac”"');
    expect(html).toContain('class="host-connection-actions"');
  });

  it("keeps both chat and workspace panel usable while resizing", () => {
    expect(clampWorkspacePanelWidth(200, 1200)).toBe(420);
    expect(clampWorkspacePanelWidth(640, 1200)).toBe(640);
    expect(clampWorkspacePanelWidth(1000, 1200)).toBe(840);
  });

  it("collapses conversation-scoped panels only when the conversation changes", () => {
    expect(
      conversationContextChanged(
        "project-1",
        "thread-1",
        "project-1",
        "thread-1",
      ),
    ).toBe(false);
    expect(
      conversationContextChanged(
        "project-1",
        "thread-1",
        "project-1",
        "thread-2",
      ),
    ).toBe(true);
    expect(
      conversationContextChanged(
        "project-1",
        "thread-1",
        "project-2",
        "thread-1",
      ),
    ).toBe(true);
  });
});

describe("RecentTasksGroup", () => {
  it("renders standalone tasks under an expanded recent heading", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <RecentTasksGroup
          project={{
            id: "standalone",
            name: "Standalone",
            basePath: "/Users/tim/.threadlight/standalone",
            scope: "standalone",
            lastOpenedAt: "2026-07-31T10:00:00.000Z",
            conversations: [
              {
                id: "thread-1",
                title: "查看最新邮件",
                createdAt: "2026-07-31T10:00:00.000Z",
                updatedAt: "2026-07-31T10:00:00.000Z",
              },
            ],
          }}
          active
          activeThreadId="thread-1"
          disabled={false}
          onSelect={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="最近"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("查看最新邮件");
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

  it("resolves a routed thread to its project without shared active state", () => {
    const target = projectContainingThread(
      {
        activeProjectId: "project-1",
        projects: [
          {
            id: "project-1",
            name: "First",
            basePath: "/first",
            lastOpenedAt: "2026-08-02T00:00:00.000Z",
            conversations: [],
          },
          {
            id: "project-2",
            name: "Second",
            basePath: "/second",
            lastOpenedAt: "2026-08-02T00:00:00.000Z",
            conversations: [
              {
                id: "thread-2",
                title: "Independent task",
                createdAt: "2026-08-02T00:00:00.000Z",
                updatedAt: "2026-08-02T00:00:00.000Z",
              },
            ],
          },
        ],
      },
      "thread-2",
    );

    expect(target?.id).toBe("project-2");
  });

  it("keeps only search and add project in the project heading", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ProjectListHeading
          searchDisabled={false}
          addDisabled={false}
          onSearch={vi.fn()}
          onAdd={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("lucide-search");
    expect(html).toContain("lucide-plus");
    expect(html).toContain('aria-label="添加项目"');
    expect(html).not.toContain("lucide-notebook-text");
    expect(html).not.toContain("lucide-activity");
    expect(html).not.toContain("lucide-calendar-clock");
    expect(html).not.toContain("lucide-server");
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

  it("uses project-level ellipsis and compose actions without a chevron", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ProjectGroup
          project={{
            id: "project-1",
            name: "Threadlight",
            basePath: "/workspace/threadlight",
            lastOpenedAt: "2026-07-30T00:00:00.000Z",
            conversations: [],
          }}
          active
          disabled={false}
          onSelect={vi.fn()}
          onNewTask={vi.fn()}
          onOpenMemory={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="管理项目“Threadlight”"');
    expect(html).toContain('aria-label="新建任务"');
    expect(html).toContain("lucide-ellipsis");
    expect(html).toContain("lucide-square-pen");
    expect(html).not.toContain("lucide-chevron-right");
  });

  it("keeps all project actions in the shared popover order", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ProjectActionPopover
          project={{
            id: "project-1",
            name: "Threadlight",
            basePath: "/workspace/threadlight",
            lastOpenedAt: "2026-07-30T00:00:00.000Z",
            conversations: [],
          }}
          busy={false}
          position={{
            top: 80,
            left: 20,
            transformOrigin: "top right",
          }}
          onClose={vi.fn()}
          onNewTask={vi.fn()}
          onOpenMemory={vi.fn()}
          onOpenSecurity={vi.fn()}
          onRevealInFinder={vi.fn()}
          onToggleProjectPinned={vi.fn()}
          onOpenDiagnostics={vi.fn()}
        />
      </I18nProvider>,
    );
    const actions = [
      "新建任务",
      "项目记忆管理",
      "安全执行",
      "在 Finder 中显示",
      "置顶项目",
      "用量与诊断",
    ];

    for (const action of actions) expect(html).toContain(action);
    for (let index = 1; index < actions.length; index += 1) {
      expect(html.indexOf(actions[index - 1]!)).toBeLessThan(
        html.indexOf(actions[index]!),
      );
    }
  });

  it("offers an accessible management action for each task", () => {
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

    expect(html).toContain('aria-label="管理任务“整理发布说明”"');
  });

  it("shows an accessible unread dot for a completed background task", () => {
    const html = renderToStaticMarkup(
      <ProjectConversationItem
        conversation={{
          id: "thread-1",
          title: "完成通知系统",
          createdAt: "2026-07-29T00:00:00.000Z",
          updatedAt: "2026-07-29T00:00:00.000Z",
          unread: true,
        }}
        active={false}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('class="thread-unread-indicator"');
    expect(html).toContain('aria-label="完成通知系统有未读更新"');
    expect(html).not.toContain("spin");
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
    expect(html).not.toContain("管理任务");
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
    expect(html).not.toContain("管理任务");
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

  it("describes every worktree artifact removed by discarding a task", () => {
    const html = renderToStaticMarkup(
      <DeleteConversationDialog
        conversation={{
          id: "thread-1",
          title: "隔离任务",
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        }}
        discard
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain("丢弃这个任务");
    expect(html).toContain("独立 worktree");
    expect(html).toContain("任务分支");
    expect(html).toContain("对话记录");
  });

  it("filters task search by lifecycle while keeping running state live", () => {
    const projects = [
      {
        id: "project-1",
        name: "Threadlight",
        basePath: "/workspace/threadlight",
        lastOpenedAt: "2026-07-29T00:00:00.000Z",
        conversations: [
          {
            id: "running",
            title: "运行任务",
            status: "pending" as const,
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
          {
            id: "completed",
            title: "发布说明",
            status: "completed" as const,
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
          {
            id: "archived",
            title: "旧任务",
            status: "completed" as const,
            archivedAt: "2026-07-29T01:00:00.000Z",
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
      },
    ];

    expect(
      filterProjectsForTaskList(projects, "", "running", ["running"])[0]
        ?.conversations.map(({ id }) => id),
    ).toEqual(["running"]);
    expect(
      filterProjectsForTaskList(projects, "发布", "completed", ["running"])[0]
        ?.conversations.map(({ id }) => id),
    ).toEqual(["completed"]);
    expect(
      filterProjectsForTaskList(projects, "", "archived", ["running"])[0]
        ?.conversations.map(({ id }) => id),
    ).toEqual(["archived"]);
  });

  it("renders task search as a modal with lifecycle filters", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <TaskSearchDialog
          projects={[
            {
              id: "project-1",
              name: "Threadlight",
              basePath: "/workspace/threadlight",
              lastOpenedAt: "2026-07-29T00:00:00.000Z",
              conversations: [
                {
                  id: "running",
                  title: "运行任务",
                  status: "pending",
                  createdAt: "2026-07-29T00:00:00.000Z",
                  updatedAt: "2026-07-29T00:00:00.000Z",
                },
                {
                  id: "completed",
                  title: "发布说明",
                  status: "completed",
                  createdAt: "2026-07-29T00:00:00.000Z",
                  updatedAt: "2026-07-29T00:00:00.000Z",
                },
              ],
            },
          ]}
          query="发布"
          filter="completed"
          runningThreadIds={["running"]}
          activeThreadId="completed"
          onQueryChange={vi.fn()}
          onFilterChange={vi.fn()}
          onSelect={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('class="task-search-backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('value="发布"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("发布说明");
    expect(html).not.toContain("运行任务");
    expect(html).toContain('aria-label="关闭任务搜索"');
  });
});
