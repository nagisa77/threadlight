import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityList, ProgressList } from "../src/app.js";
import { ConversationMessageItem } from "../src/conversation-surface.js";
import { I18nProvider } from "../src/i18n.js";

describe("ActivityList", () => {
  it("renders every automatic compaction in chronological progress order", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ProgressList
          progress={[
            { text: "压缩前的执行进度", activities: [] },
            {
              text: "",
              activities: [],
              contextCompaction: {
                status: "compacted",
                source: "automatic",
                generation: 1,
                tokensBefore: 112_423,
                tokensAfter: 28_937,
                messagesCompacted: 30,
              },
            },
            { text: "压缩后的执行进度", activities: [] },
            {
              text: "",
              activities: [],
              contextCompaction: {
                status: "compacted",
                source: "automatic",
                generation: 2,
                tokensBefore: 111_900,
                tokensAfter: 27_400,
                messagesCompacted: 24,
              },
            },
          ]}
        />
      </I18nProvider>,
    );

    const before = html.indexOf("压缩前的执行进度");
    const firstReceipt = html.indexOf("约 11.2万 → 2.9万 tokens");
    const after = html.indexOf("压缩后的执行进度");
    const secondReceipt = html.indexOf("约 11.2万 → 2.7万 tokens");
    expect(before).toBeLessThan(firstReceipt);
    expect(firstReceipt).toBeLessThan(after);
    expect(after).toBeLessThan(secondReceipt);
    expect(html.match(/lucide-minimize-2/g)).toHaveLength(2);
  });

  it("does not duplicate an inline automatic receipt at the message top", () => {
    const compaction = {
      status: "compacted" as const,
      source: "automatic" as const,
      generation: 1,
      compactedAt: "2026-08-24T08:02:34.352Z",
      tokensBefore: 112_423,
      tokensAfter: 28_937,
      messagesCompacted: 30,
    };
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ConversationMessageItem
          message={{
            id: "message-1",
            role: "assistant",
            text: "压缩后继续完成任务。",
            contextCompaction: compaction,
            progress: [
              { text: "压缩前执行。", activities: [] },
              {
                text: "",
                activities: [],
                contextCompaction: compaction,
              },
            ],
          }}
          capabilities={[]}
          bookmarked={false}
          canCopyText={false}
          canRevealLocalFile={false}
          onTerminateProcess={async () => {}}
          onOpenLocalFile={() => {}}
          onRevealLocalFile={() => {}}
          onRewriteQuestion={() => {}}
          onOpenAgent={() => {}}
          onToggleBookmark={() => {}}
          onCopyText={async () => {}}
        />
      </I18nProvider>,
    );

    expect(html.indexOf("压缩前执行。")).toBeLessThan(
      html.indexOf("约 11.2万 → 2.9万 tokens"),
    );
    expect(html.indexOf("约 11.2万 → 2.9万 tokens")).toBeLessThan(
      html.indexOf("压缩后继续完成任务。"),
    );
    expect(html.match(/lucide-minimize-2/g)).toHaveLength(1);
  });

  it("renders commentary before every tool in the batch", () => {
    const html = renderToStaticMarkup(
      <ProgressList
        live
        progress={[
          {
            text: "我先检查配置和测试。",
            activities: [
              { id: "call-1", name: "read_config", status: "running" },
              { id: "call-2", name: "run_tests", status: "running" },
            ],
          },
        ]}
      />,
    );

    const commentary = html.indexOf("我先检查配置和测试。");
    const firstTool = html.indexOf("read_config");
    const secondTool = html.indexOf("run_tests");
    expect(commentary).toBeGreaterThan(-1);
    expect(commentary).toBeLessThan(firstTool);
    expect(firstTool).toBeLessThan(secondTool);
  });

  it("starts completed execution records collapsed", () => {
    const html = renderToStaticMarkup(
      <ActivityList
        activities={[
          {
            id: "completed-call",
            name: "exec_command",
            status: "completed",
            detail: "large hidden detail",
          },
        ]}
      />,
    );

    expect(html).toContain('<details class="activity-list"');
    expect(html).not.toContain('data-activity-ids="completed-call" open=""');
    expect(html).toContain('<summary class="activity-heading">');
    expect(html).not.toContain('class="activity-content"');
    expect(html).not.toContain("large hidden detail");
  });

  it("starts failed execution records expanded so diagnostics are visible", () => {
    const html = renderToStaticMarkup(
      <ActivityList
        activities={[
          {
            id: "failed-call",
            name: "computer",
            status: "failed",
            detail: "错误 · focused={role=AXWindow}",
          },
        ]}
      />,
    );

    expect(html).toContain('data-activity-ids="failed-call" open=""');
    expect(html).toContain("focused={role=AXWindow}");
  });

  it("starts warning execution records expanded with a distinct status icon", () => {
    const html = renderToStaticMarkup(
      <ActivityList
        activities={[
          {
            id: "warning-call",
            name: "exec_command",
            status: "completed_with_warnings",
            process: {
              sessionId: "warning-session",
              command: "check-tool",
              cwd: "/workspace",
              status: "completed_with_warnings",
              exitCode: 0,
              signal: null,
              stdout: "",
              stderr: "command not found\n",
              truncated: false,
              startedAt: "2026-07-29T08:00:00.000Z",
              completedAt: "2026-07-29T08:00:01.000Z",
            },
          },
        ]}
      />,
    );

    expect(html).toContain('data-activity-ids="warning-call" open=""');
    expect(html).toContain("lucide-triangle-alert warning");
    expect(html).not.toContain("lucide-check completed");
    expect(html).toContain('<details class="command-output">');
    expect(html).not.toContain("stderr\ncommand not found");
  });

  it("keeps a live execution record expanded until the final answer arrives", () => {
    const html = renderToStaticMarkup(
      <ActivityList
        live
        activities={[
          {
            id: "running-call",
            name: "exec_command",
            status: "running",
          },
        ]}
      />,
    );

    expect(html).toContain('data-activity-ids="running-call" open=""');
  });

  it("keeps completed and failed status icons in the tool-name summary row", () => {
    const html = renderToStaticMarkup(
      <ActivityList
        activities={[
          {
            id: "completed-call",
            name: "web_search",
            status: "completed",
            detail: "search result",
          },
          {
            id: "failed-call",
            name: "web_search",
            status: "failed",
            detail: "search error",
          },
        ]}
      />,
    );

    expect(html).toContain('<div class="activity-summary"><svg');
    expect(html).toContain('class="lucide lucide-check completed"');
    expect(html).toContain('class="lucide lucide-x failed"');
    expect(html).toContain("</svg><code>web_search</code></div><pre>");
  });

  it("mounts the command summary but defers output text until it expands", () => {
    const html = renderToStaticMarkup(
      <ActivityList
        live
        activities={[
          {
            id: "managed-command",
            name: "exec_command",
            status: "running",
            detail: "$ npm test",
            process: {
              sessionId: "session-1",
              command: "npm test",
              cwd: "/workspace",
              status: "running",
              exitCode: null,
              signal: null,
              stdout: "test output\n",
              stderr: "warning\n",
              truncated: false,
              startedAt: "2026-07-22T08:00:00.000Z",
            },
          },
        ]}
        onTerminateProcess={async () => {}}
      />,
    );

    expect(html).toContain('<details class="command-output">');
    expect(html).not.toContain('<details class="command-output" open="">');
    expect(html).toContain("命令行输出");
    expect(html).not.toContain("test output");
    expect(html).not.toContain("stderr\nwarning");
    expect(html).toContain("结束该命令");
  });
});
