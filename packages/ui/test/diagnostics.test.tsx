import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DiagnosticExportDialog,
  DiagnosticsPage,
  exportSingleConversationDiagnostic,
  formatDuration,
} from "../src/diagnostics.js";
import type { HostProjectDiagnosticBundle } from "@threadlight/protocol";

describe("diagnostics center", () => {
  it("formats subsecond, second, and minute durations compactly", () => {
    expect(formatDuration(320)).toBe("320 ms");
    expect(formatDuration(2_350)).toBe("2.4 s");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  it("renders an accessible loading state before project totals arrive", () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPage
        adapter={{ load: vi.fn(), exportBundle: vi.fn() }}
        projectId="project-1"
        projectName="Threadlight"
        conversations={[]}
      />,
    );

    expect(html).toContain("用量与诊断");
    expect(html).toContain("Threadlight");
    expect(html).toContain("正在读取诊断数据");
    expect(html).toContain("导出诊断包");
    expect(html).toContain('type="button"');
  });

  it("renders a searchable multi-conversation export scope", () => {
    const html = renderToStaticMarkup(
      <DiagnosticExportDialog
        projectName="Threadlight"
        conversations={[
          {
            id: "thread-1",
            title: "登录失败",
            updatedAt: "2026-08-07T01:00:00.000Z",
          },
          {
            id: "thread-2",
            title: "工具超时",
            updatedAt: "2026-08-07T02:00:00.000Z",
          },
        ]}
        scope="conversations"
        selectedIds={["thread-2"]}
        query=""
        busy={false}
        onScopeChange={vi.fn()}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onCancel={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("登录失败");
    expect(html).toContain("工具超时");
    expect(html).toContain("已选择 1 个聊天");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("完整字段结构");
  });

  it("exports only the selected standalone conversation", async () => {
    const bundle = {
      filename: "threadlight-diagnostics-standalone-thread-1.json",
    } as HostProjectDiagnosticBundle;
    const exportBundle = vi.fn(async () => bundle);
    const save = vi.fn();

    await exportSingleConversationDiagnostic(
      { exportBundle },
      "standalone",
      "thread-1",
      save,
    );

    expect(exportBundle).toHaveBeenCalledWith("standalone", ["thread-1"]);
    expect(save).toHaveBeenCalledWith(bundle);
  });
});
