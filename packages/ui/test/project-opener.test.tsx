import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../src/i18n.js";
import {
  ProjectOpenControl,
  resolvePreferredProjectOpener,
} from "../src/project-opener.js";

describe("ProjectOpenControl", () => {
  it("renders a direct preferred-app action and a separate menu trigger", () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { language: "zh-CN" },
        createElement(ProjectOpenControl, {
          adapter: {
            load: vi.fn(async () => []),
            open: vi.fn(async () => {}),
          },
          projectId: "project-1",
          preferred: "cursor",
          openers: [
            {
              id: "com.microsoft.VSCode",
              label: "VS Code",
              available: true,
              default: false,
            },
            {
              id: "cursor",
              label: "Cursor",
              available: true,
              default: false,
            },
            {
              id: "com.apple.dt.Xcode",
              label: "Xcode",
              available: false,
              default: false,
            },
          ],
        }),
      ),
    );

    expect(html).toContain('class="project-open-primary pressable"');
    expect(html).toContain('aria-label="在 Cursor 中打开项目"');
    expect(html).toContain('class="project-open-menu-trigger pressable"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("Xcode");
  });

  it("resolves a legacy preference against a discovered bundle id", () => {
    expect(
      resolvePreferredProjectOpener(
        [
          {
            id: "com.microsoft.VSCode",
            label: "Visual Studio Code",
            available: true,
            default: false,
          },
        ],
        "vscode",
      )?.id,
    ).toBe("com.microsoft.VSCode");
  });
});
