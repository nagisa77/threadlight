import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DiagnosticsPage,
  formatDuration,
} from "../src/diagnostics.js";

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
      />,
    );

    expect(html).toContain("用量与诊断");
    expect(html).toContain("Threadlight");
    expect(html).toContain("正在读取诊断数据");
    expect(html).toContain("导出诊断包");
    expect(html).toContain('type="button"');
  });
});
