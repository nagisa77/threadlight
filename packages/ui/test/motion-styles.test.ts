import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readUiStyles } from "./style-source.js";

const css = readUiStyles();
const navigationSidebar = readFileSync(
  new URL("../src/features/navigation/navigation-sidebar.tsx", import.meta.url),
  "utf8",
);

describe("primary-path motion", () => {
  it("uses short transform and opacity entrances for changing task state", () => {
    expect(css).toMatch(
      /\.empty-state\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);[^}]*opacity 180ms var\(--ease-out\),[^}]*transform 180ms var\(--ease-out\);/s,
    );
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.empty-state,\s*\.message-list\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(6px\);/s,
    );
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.live-run,\s*\.progress-step,\s*\.activity-item\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(4px\);/s,
    );
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.turn-delivery-status\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(6px\);/s,
    );
  });

  it("preserves spatial origins for the drawer, workspace panel, and floating status", () => {
    expect(css).toMatch(
      /\.source-drawer\s*\{[^}]*transform:\s*translateX\(0\);[^}]*transform 220ms var\(--ease-out\);/s,
    );
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.source-drawer-backdrop\s*\{[^}]*opacity:\s*0;[^}]*\}[\s\S]*?\.source-drawer\s*\{[^}]*transform:\s*translateX\(16px\);/s,
    );
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.workspace-panel:not\(\[hidden\]\)\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(14px\);/s,
    );
    expect(css).toMatch(
      /\.workspace-panel\s*\{[^}]*opacity 180ms var\(--ease-out\),[^}]*transform 220ms var\(--ease-out\),[^}]*display 220ms allow-discrete;/s,
    );
    expect(css).toMatch(
      /\.workspace-panel\[hidden\]\s*\{[^}]*display:\s*none;[^}]*opacity:\s*0;[^}]*transform:\s*translateX\(14px\);/s,
    );
    expect(css).toMatch(
      /@starting-style\s*\{\s*\.composer-provider-gate\s*\{[^}]*\}[\s\S]*?\.turn-status-pill\s*\{[^}]*opacity:\s*0;[^}]*translateY\(5px\) scale\(0\.98\);/s,
    );
  });

  it("removes spatial movement when reduced motion is requested", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.empty-state,\s*\.message-list,\s*\.live-run,[\s\S]*?\.workspace-panel\s*\{[^}]*transform:\s*none;[^}]*transition:\s*opacity 120ms ease;/s,
    );
    expect(css).not.toMatch(/transition:\s*all\b/);
    expect(css).not.toMatch(/\bease-in(?:\s|,|;)/);
  });

  it("keeps the mobile backdrop mounted so its fade can reverse", () => {
    expect(navigationSidebar).toContain("{mobile && (");
    expect(navigationSidebar).toContain('data-open={open ? "true" : "false"}');
    expect(navigationSidebar).toContain("aria-hidden={!open}");
    expect(navigationSidebar).toContain("tabIndex={open ? 0 : -1}");
    expect(css).toMatch(
      /\.sidebar-backdrop\[data-open="true"\]\s*\{[^}]*display:\s*block;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*display 180ms allow-discrete;/s,
    );
  });
});
