import { describe, expect, it } from "vitest";

import {
  createReportActivitySummaryTool,
  parseActivitySummary,
  REPORT_ACTIVITY_SUMMARY_TOOL_NAME,
} from "../src/index.js";

describe("report_activity_summary", () => {
  it("defines a hidden read-only structured summary tool", async () => {
    const tool = createReportActivitySummaryTool();

    expect(tool).toMatchObject({
      name: REPORT_ACTIVITY_SUMMARY_TOOL_NAME,
      mutability: "read",
      presentation: {
        visibility: "hidden",
        activitySummaryArgument: "summary",
      },
    });
    await expect(
      tool.execute(
        { summary: "  检查配置\n并运行测试  " },
        {
          runId: "run-1",
          signal: new AbortController().signal,
        },
      ),
    ).resolves.toEqual({
      accepted: true,
      summary: "检查配置 并运行测试",
    });
  });

  it("rejects missing and oversized summaries", () => {
    expect(() => parseActivitySummary({})).toThrow("1-80 characters");
    expect(() => parseActivitySummary({ summary: "x".repeat(81) })).toThrow(
      "1-80 characters",
    );
  });
});
