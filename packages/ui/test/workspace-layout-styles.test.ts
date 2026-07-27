import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

describe("workspace titlebar hit regions", () => {
  it("reserves room for the floating controls when the panel is closed", () => {
    expect(styles).toMatch(
      /\.workspace:not\(\.has-workspace-panel\) \.workspace-header\s*\{[^}]*padding-right:\s*83px;/s,
    );
  });

  it("keeps closed-panel controls clickable and lays open-panel actions beside tabs", () => {
    expect(styles).toMatch(
      /\.workspace-global-actions\s*\{[^}]*pointer-events:\s*none;[^}]*-webkit-app-region:\s*no-drag;/s,
    );
    expect(styles).toMatch(
      /\.workspace-global-actions \.header-terminal-button\s*\{[^}]*pointer-events:\s*auto;[^}]*-webkit-app-region:\s*no-drag;/s,
    );
    expect(styles).toMatch(
      /\.workspace-panel-tabs\s*\{[^}]*-webkit-app-region:\s*no-drag;/s,
    );
    expect(styles).toMatch(
      /\.workspace-panel-tab-flow\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto;/s,
    );
    expect(styles).toMatch(
      /\.workspace-tab-strip\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-x:\s*auto;/s,
    );
    expect(styles).toMatch(
      /\.workspace-panel-actions\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
  });
});
