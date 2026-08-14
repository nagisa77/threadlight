import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CommandPalette,
  paletteEntryMatches,
  type CommandPaletteEntry,
  type SearchAdapter,
} from "../src/command-palette.js";

const adapter: SearchAdapter = {
  search: vi.fn(async () => []),
};

describe("CommandPalette", () => {
  it("renders command and task jump groups in full-search mode", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        adapter={adapter}
        projectId="project-1"
        threadId="thread-1"
        mode="all"
        actions={[entry("action:memory", "action", "项目记忆")]}
        tasks={[entry("task:one", "task", "实现全文搜索")]}
        onModeChange={vi.fn()}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("搜索消息、文件、命令输出、工具和 Memory");
    expect(html).toContain("项目记忆");
    expect(html).toContain("实现全文搜索");
    expect(html).toContain("⌘K");
    expect(html).toContain("⌘P");
    expect(html).toContain('role="listbox"');
    expect(html).toContain('class="command-palette-close pressable"');
    expect(html).toContain('aria-label="关闭"');
  });

  it("matches local commands by title, subtitle, and keywords", () => {
    const command = {
      ...entry("action:review", "action", "审阅任务变更"),
      subtitle: "打开当前任务的 Diff",
      keywords: "changes review",
    };
    expect(paletteEntryMatches(command, "Diff")).toBe(true);
    expect(paletteEntryMatches(command, "changes")).toBe(true);
    expect(paletteEntryMatches(command, "terminal")).toBe(false);
  });
});

function entry(
  id: string,
  kind: CommandPaletteEntry["kind"],
  title: string,
): CommandPaletteEntry {
  return { id, kind, title, subtitle: "说明" };
}
