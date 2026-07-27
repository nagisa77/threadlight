import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  THEME_PREFERENCES,
  isThemePreference,
} from "../src/theme.js";

describe("theme", () => {
  it("supports system, light, and dark preferences offline", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
    for (const theme of THEME_PREFERENCES) {
      expect(isThemePreference(theme)).toBe(true);
    }
    expect(isThemePreference("midnight")).toBe(false);
  });

  it("defines dark application colors and all three visual previews", () => {
    const css = readFileSync(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain(".theme-preview.system");
    expect(css).toContain(".theme-preview.light");
    expect(css).toContain(".theme-preview.dark");
  });
});
