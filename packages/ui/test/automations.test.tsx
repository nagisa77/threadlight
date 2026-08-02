import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AutomationsPage,
  automationTemplates,
  type AutomationAdapter,
} from "../src/automations.js";

describe("AutomationsPage", () => {
  it("renders the project-scoped loading state and create action", () => {
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

    expect(html).toContain("自动化");
    expect(html).toContain("Threadlight");
    expect(html).toContain("新建自动化");
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
});
