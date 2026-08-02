import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  projectTerminalCreateRequest,
  TerminalPanel,
  type TerminalAdapter,
} from "../src/terminal.js";
import type { WorkspaceAdapter } from "../src/workspace-panel.js";

describe("TerminalPanel", () => {
  it("opens interactive terminals in the original project directory", () => {
    expect(projectTerminalCreateRequest("project-1")).toEqual({
      projectId: "project-1",
      cols: 80,
      rows: 24,
    });
    expect(
      projectTerminalCreateRequest("standalone", "thread-1"),
    ).toEqual({
      projectId: "standalone",
      threadId: "thread-1",
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
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="底部面板"');
    expect(html).toContain('class="lucide lucide-terminal"');
    expect(html).not.toContain("lucide-square-terminal");
    expect(html).toContain("终端 1");
    expect(html).toContain('aria-label="新建面板标签"');
    expect(html).toContain(">终端</span>");
    expect(html).toContain(">文件</span>");
    expect(html).toContain('aria-label="关闭底部面板"');
    expect(html).toContain("正在启动终端");
  });
});
