import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AutomationsPage,
  automationTemplates,
  filterAutomations,
  type Automation,
  type AutomationAdapter,
} from "../src/automations.js";

describe("AutomationsPage", () => {
  it("renders the scheduled-task shell while project data loads", () => {
    const adapter: AutomationAdapter = {
      load: vi.fn(() => new Promise(() => {})),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      run: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };

    const html = renderToStaticMarkup(
      <AutomationsPage
        adapter={adapter}
        projectId="project-1"
        projectName="Threadlight"
      />,
    );

    expect(html).toContain("已安排的任务");
    expect(html).toContain("Threadlight");
    expect(html).toContain("搜索已安排任务");
    expect(html).toContain("创建");
    expect(html).toContain("建议");
    expect(html).toContain("正在读取自动化");
  });

  it("provides twenty fully localized optional templates", () => {
    for (const language of ["zh-CN", "zh-TW", "en", "ja", "ko"] as const) {
      const templates = automationTemplates(language);
      expect(templates).toHaveLength(20);
      expect(new Set(templates.map((template) => template.id)).size).toBe(20);
      expect(
        templates.every(
          (template) =>
            template.name.trim().length > 0 &&
            template.description.trim().length > 0 &&
            template.prompt.trim().length > 0,
        ),
      ).toBe(true);
    }
  });

  it("filters scheduled tasks by state and localized searchable content", () => {
    const base: Automation = {
      id: "automation-1",
      projectId: "project-1",
      name: "每日代码巡检",
      kind: "custom",
      prompt: "检查最近提交",
      enabled: true,
      schedule: { cadence: "weekdays", time: "09:00" },
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const automations = [
      base,
      {
        ...base,
        id: "automation-2",
        name: "依赖健康检查",
        kind: "dependencies" as const,
        prompt: "检查过期依赖",
        enabled: false,
      },
    ];
    const labels = {
      custom: "自定义任务",
      tests: "测试",
      dependencies: "依赖检查",
      "issue-triage": "Issue 分诊",
    };

    expect(
      filterAutomations(automations, "enabled", "", "zh-CN", labels),
    ).toEqual([base]);
    expect(
      filterAutomations(automations, "paused", "依赖", "zh-CN", labels),
    ).toEqual([automations[1]]);
    expect(
      filterAutomations(automations, "all", "最近提交", "zh-CN", labels),
    ).toEqual([base]);
  });
});
