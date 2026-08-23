import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskHeader } from "../src/features/productivity/task-header.js";
import { I18nProvider } from "../src/i18n.js";

describe("TaskHeader running metrics", () => {
  it("renders provider-confirmed input, output, and token rate offline", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <TaskHeader
          title="实时任务"
          context="/workspace"
          taskId="task-1"
          running
          runMetrics={{
            startedAt: new Date().toISOString(),
            usage: {
              inputTokens: 1_200,
              outputTokens: 40,
              totalTokens: 1_240,
            },
            modelDurationMs: 2_000,
            completedModelSteps: 1,
            streamedBytes: 512,
            currentModelStartedAt: new Date().toISOString(),
            currentTtftMs: 640,
            totalTtftMs: 1_500,
            ttftSamples: 2,
          }}
          connectionReady
          bookmarkCount={0}
          onCopyReference={async () => undefined}
          onExport={() => undefined}
          onOpenBookmarks={() => undefined}
        />
      </I18nProvider>,
    );

    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain("20.0 tok/s");
    expect(markup).toContain("1,200");
    expect(markup).toContain("640 ms");
    expect(markup).toContain("750 ms");
    expect(markup).toContain("Provider 已确认");
    expect(markup).not.toContain('class="running-badge-metrics"');
    expect(markup.indexOf("running-status")).toBeLessThan(
      markup.indexOf("task-productivity"),
    );
  });
});
