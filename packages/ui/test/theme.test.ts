import { describe, expect, it } from "vitest";

import { THEME_PREFERENCES, isThemePreference } from "../src/theme.js";
import { readUiStyles } from "./style-source.js";

describe("theme", () => {
  it("supports system, light, and dark preferences offline", () => {
    expect(THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
    for (const theme of THEME_PREFERENCES) {
      expect(isThemePreference(theme)).toBe(true);
    }
    expect(isThemePreference("midnight")).toBe(false);
  });

  it("defines dark application colors and all three visual previews", () => {
    const css = readUiStyles();

    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain(".theme-preview.system");
    expect(css).toContain(".theme-preview.light");
    expect(css).toContain(".theme-preview.dark");
  });

  it("keeps dark navigation, headers, and interactive states on dark surfaces", () => {
    const css = readUiStyles();

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
    expect(css).toMatch(
      /html\[data-theme="dark"\] \.agent-transcript-tool pre\s*\{[^}]*color:\s*#e3e3e6;[^}]*background:\s*#292a2e;/s,
    );
  });

  it("uses neutral grayscale tokens instead of the former orange brand accent", () => {
    const css = readUiStyles();

    expect(css).toMatch(
      /:root\s*\{[^}]*--surface:\s*#f7f7f8;[^}]*--sidebar:\s*#f0f0f2;[^}]*--accent:\s*#303034;[^}]*--accent-soft:\s*#e9e9eb;/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\]\s*\{[^}]*--surface:\s*#1a1a1c;[^}]*--sidebar:\s*#151517;[^}]*--accent:\s*#73737a;[^}]*--accent-soft:\s*#303034;/s,
    );
    expect(css).not.toMatch(
      /#(?:d56a3a|df7b4d|e2743c|ee8047|f1c8af|f5e3d8)\b/i,
    );
  });

  it("gives the theme field breathing room below its section heading", () => {
    const css = readUiStyles();

    expect(css).toMatch(/\.theme-picker\s*\{[^}]*padding:\s*19px 0 17px;/s);
  });

  it("renders plan progress surfaces as readable frosted glass", () => {
    const css = readUiStyles();

    expect(css).toMatch(
      /\.plan-status-popover::before\s*\{[^}]*backdrop-filter:\s*blur\(36px\) saturate\(1\.25\);/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\] \.plan-status-popover::before\s*\{[^}]*background:\s*linear-gradient/s,
    );
    expect(css).toContain("@supports not (");
  });

  it("does not add a background when hovering the changed-files action", () => {
    const css = readUiStyles();

    expect(css).toMatch(
      /\.conversation-changes-button:hover\s*\{[^}]*background:\s*transparent;/s,
    );
    expect(css).not.toMatch(
      /html\[data-theme="dark"\] :is\([^)]*\.conversation-changes-button:hover[^)]*\)/s,
    );
  });

  it("removes the gray outline from the dark turn-status pill", () => {
    const css = readUiStyles();
    const rule = css.match(
      /html\[data-theme="dark"\] \.turn-status-pill\s*\{([^}]*)\}/s,
    );

    expect(rule?.[1]).toContain("border-color: transparent;");
    expect(rule?.[1]).not.toContain("inset");
  });
});
