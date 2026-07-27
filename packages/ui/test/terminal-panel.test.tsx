import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TerminalPanel, type TerminalAdapter } from "../src/terminal.js";
import type { WorkspaceAdapter } from "../src/workspace-panel.js";

describe("TerminalPanel", () => {
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
