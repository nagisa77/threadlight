import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityList, ProgressList } from "../src/app.js";

describe("ActivityList", () => {
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
          },
        ]}
      />,
    );

    expect(html).toContain('<details class="activity-list">');
    expect(html).not.toContain('<details class="activity-list" open="">');
    expect(html).toContain('<summary class="activity-heading">');
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

    expect(html).toContain('<details class="activity-list live" open="">');
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
});
