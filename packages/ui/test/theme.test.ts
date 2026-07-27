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

  it("keeps dark navigation, headers, and interactive states on dark surfaces", () => {
    const css = readFileSync(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /html\[data-theme="dark"\] \.workspace-header\s*\{[^}]*border-bottom-color:\s*var\(--line\);/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\] \.settings-nav-button\.active\s*\{[^}]*border-color:\s*var\(--line-strong\);/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\] :is\(\s*\.suggestion,\s*\.memory-open-button\s*\)\s*\{[^}]*color:\s*var\(--muted\);/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\] \.composer-share-action:hover:not\(:disabled\)\s*\{[^}]*background:\s*#34353a;/s,
    );
  });

  it("gives the theme field breathing room below its section heading", () => {
    const css = readFileSync(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.theme-picker\s*\{[^}]*padding:\s*19px 0 17px;/s,
    );
  });

  it("renders plan progress surfaces as readable frosted glass", () => {
    const css = readFileSync(
      new URL("../src/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.plan-status-popover\s*\{[^}]*backdrop-filter:\s*blur\(28px\) saturate\(1\.35\);/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\] \.plan-status-popover\s*\{[^}]*background:\s*linear-gradient/s,
    );
    expect(css).toContain("@supports not (");
  });
});
