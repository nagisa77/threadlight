import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TerminalPanel, type TerminalAdapter } from "../src/terminal.js";

describe("TerminalPanel", () => {
  it("offers terminal creation, panel close, and an accessible output area", () => {
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
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="终端面板"');
    expect(html).toContain('aria-label="新建终端"');
    expect(html).toContain('aria-label="关闭终端面板"');
    expect(html).toContain("正在启动终端");
  });
});
