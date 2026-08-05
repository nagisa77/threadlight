import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  nextTabsAfterClose,
  projectTerminalCreateRequest,
  TerminalPanel,
  type TerminalAdapter,
} from "../src/terminal.js";
import type { WorkspaceAdapter } from "../src/workspace-panel.js";

describe("TerminalPanel", () => {
  it("binds task terminals to the thread and keeps original terminals explicit", () => {
    expect(projectTerminalCreateRequest("project-1")).toEqual({
      projectId: "project-1",
      workspace: "task",
      cols: 80,
      rows: 24,
    });
    expect(
      projectTerminalCreateRequest("standalone", "thread-1"),
    ).toEqual({
      projectId: "standalone",
      threadId: "thread-1",
      workspace: "task",
      cols: 80,
      rows: 24,
    });
    expect(
      projectTerminalCreateRequest(
        "standalone",
        "thread-1",
        "original",
      ),
    ).toEqual({
      projectId: "standalone",
      workspace: "original",
      cols: 80,
      rows: 24,
    });
  });

  it("defaults to a terminal and offers terminal or file views from add", () => {
    const adapter: TerminalAdapter = {
      create: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const workspace: WorkspaceAdapter = {
      getChanges: vi.fn(),
      list: vi.fn(async () => []),
      read: vi.fn(),
    };

    const html = renderToStaticMarkup(
      <TerminalPanel
        adapter={adapter}
        workspace={workspace}
        projectId="project-1"
        projectName="threadlight"
        taskBranch="threadlight/task-1"
        originalBranch="main"
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="底部面板"');
    expect(html).toContain('class="lucide lucide-terminal"');
    expect(html).not.toContain("lucide-square-terminal");
    expect(html).toContain("任务 worktree · threadlight/task-1 · 1");
    expect(html).toContain('aria-label="新建面板标签"');
    expect(html).toContain(">任务 worktree · threadlight/task-1</span>");
    expect(html).toContain(">原工作区 · main</span>");
    expect(html).toContain(">文件</span>");
    expect(html).toContain('aria-label="关闭底部面板"');
    expect(html).toContain("正在启动终端");
    expect(html).not.toContain("terminal-exited");
  });

  it("labels a non-worktree default terminal as the original workspace", () => {
    const adapter: TerminalAdapter = {
      create: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };

    const html = renderToStaticMarkup(
      <TerminalPanel
        adapter={adapter}
        projectId="project-1"
        defaultWorkspace="original"
        taskWorkspaceAvailable={false}
        originalBranch="main"
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("原工作区 · main · 1");
    expect(html).not.toContain("任务 worktree");
  });
});

describe("nextTabsAfterClose", () => {
  it("closes the tab when its session exits", () => {
    const result = nextTabsAfterClose(
      [
        { id: "tab-1", kind: "terminal", title: "终端 1" },
        { id: "tab-2", kind: "original-terminal", title: "原工作区 · main · 2" },
        { id: "tab-3", kind: "file", title: "文件" },
      ],
      "tab-1",
      "tab-1",
    );

    expect(result.tabs.map((tab) => tab.id)).toEqual(["tab-2", "tab-3"]);
    expect(result.activeTabId).toBe("tab-2");
    expect(result.panelClosed).toBe(false);
  });

  it("keeps the active tab when a background tab exits", () => {
    const result = nextTabsAfterClose(
      [
        { id: "tab-1", kind: "terminal", title: "终端 1" },
        { id: "tab-2", kind: "original-terminal", title: "原工作区 · main · 2" },
      ],
      "tab-2",
      "tab-1",
    );

    expect(result.tabs.map((tab) => tab.id)).toEqual(["tab-2"]);
    expect(result.activeTabId).toBe("tab-2");
    expect(result.panelClosed).toBe(false);
  });

  it("closes the whole panel when the last tab exits", () => {
    const result = nextTabsAfterClose(
      [{ id: "tab-1", kind: "terminal", title: "终端 1" }],
      "tab-1",
      "tab-1",
    );

    expect(result.tabs).toEqual([]);
    expect(result.activeTabId).toBe("");
    expect(result.panelClosed).toBe(true);
  });
});
