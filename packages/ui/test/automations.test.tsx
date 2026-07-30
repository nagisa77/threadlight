import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AutomationsPage,
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
});
