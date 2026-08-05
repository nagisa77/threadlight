import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

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

describe("expanded composer layout", () => {
  it("starts with a roomy top-aligned editor above the action toolbar", () => {
    expect(styles).toMatch(
      /\.composer\s*\{[^}]*min-height:\s*102px;[^}]*flex-direction:\s*column;[^}]*border-radius:\s*18px;/s,
    );
    expect(styles).toMatch(
      /\.composer textarea\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*42px;[^}]*padding:\s*2px 3px 0;/s,
    );
    expect(styles).toMatch(
      /\.composer-toolbar\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between;[^}]*margin-top:\s*auto;/s,
    );
  });
});
