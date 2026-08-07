import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { activateComposerMenuOnPointerDown } from "../src/app.js";
import { readUiStyles } from "./style-source.js";

const menuTriggerSources = [
  "../src/features/composer/development-mode.tsx",
  "../src/features/composer/model-selector.tsx",
  "../src/execution-policy.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("mobile composer menus", () => {
  it("preserves focus and opens the next menu during pointerdown", () => {
    const steps: string[] = [];
    activateComposerMenuOnPointerDown(
      { preventDefault: vi.fn(() => steps.push("preserve-focus")) },
      () => steps.push("open-menu"),
    );

    expect(steps).toEqual(["preserve-focus", "open-menu"]);

    for (const source of menuTriggerSources) {
      expect(source).toContain("activateComposerMenuOnPointerDown(event");
    }
  });

  it("keeps the composer expanded while a toolbar menu is open", () => {
    expect(readUiStyles()).toContain(
      ':has(.composer-toolbar [aria-expanded="true"])',
    );
  });
});
