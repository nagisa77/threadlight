import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function lines(path: string): number {
  return source(path).split("\n").length;
}

describe("UI feature boundaries", () => {
  it("keeps the application and workspace orchestrators below the agreed limits", () => {
    expect(lines("../src/app.tsx")).toBeLessThan(4_500);
    expect(lines("../src/workspace-panel.tsx")).toBeLessThan(1_800);
    expect(lines("../src/i18n.tsx")).toBeLessThan(150);
  });

  it("keeps state owners and feature modules grouped by domain", () => {
    const controllers = [
      ["task-session", "useTaskSessionController"],
      ["composer", "useComposerController"],
      ["navigation", "useNavigationController"],
      ["delivery", "useDeliveryController"],
    ] as const;
    const app = source("../src/app.tsx");

    for (const [feature, controller] of controllers) {
      const controllerSource = source(
        `../src/features/${feature}/controller.ts`,
      );
      expect(controllerSource).toContain(`export function ${controller}`);
      expect(app).toContain(`./features/${feature}/controller.js`);
    }

    const flatFeatureFiles = readdirSync(
      new URL("../src/features", import.meta.url),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(flatFeatureFiles).toEqual([]);
  });

  it("keeps locale catalogs outside the i18n provider", () => {
    const provider = source("../src/i18n.tsx");
    expect(provider).toContain("./features/i18n/messages/zh-CN.js");
    expect(provider).not.toContain("settingsSubtitle:");

    for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
      expect(
        lines(`../src/features/i18n/messages/${locale}.ts`),
      ).toBeGreaterThan(700);
    }
  });

  it("loads feature styles through one stable public entrypoint", () => {
    const entry = source("../src/styles.css");
    expect(entry.match(/@import/g)).toHaveLength(7);
    expect(entry).toContain("./styles/automations.css");
    expect(entry).toContain("./styles/conversation.css");
    expect(entry).toContain("./styles/settings.css");
    expect(entry).toContain("./styles/workspace.css");
    expect(lines("../src/styles.css")).toBeLessThan(20);
  });
});
