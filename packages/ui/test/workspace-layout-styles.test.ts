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

  it("hides the app sidebar trigger when the narrow workspace panel takes over", () => {
    expect(styles).toMatch(
      /@media \(max-width: 1100px\)[\s\S]*?\.workspace\.has-workspace-panel > \.sidebar-reveal-button\s*\{[^}]*display:\s*none;/s,
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

  it("responds to composer width with icon-only controls", () => {
    expect(styles).toMatch(
      /\.composer\s*\{[^}]*--composer-control-size:\s*32px;[^}]*container:\s*composer \/ inline-size;/s,
    );
    expect(styles).toMatch(
      /@container composer \(max-width: 600px\)\s*\{[\s\S]*?\.development-mode-trigger,[\s\S]*?\.conversation-access-trigger,[\s\S]*?\.composer-action\.model\s*\{[^}]*width:\s*var\(--composer-control-size\);[^}]*justify-content:\s*center;[^}]*padding:\s*0;/s,
    );
    expect(styles).toMatch(
      /@container composer \(max-width: 600px\)[\s\S]*?\.composer-action\.model \.composer-model-icon\s*\{[^}]*display:\s*block;/s,
    );
  });

  it("uses 44px composer targets on coarse touch pointers", () => {
    expect(styles).toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*\.composer\s*\{[^}]*--composer-control-size:\s*44px;/s,
    );
  });

  it("collapses an idle mobile composer to one line and its send action", () => {
    expect(styles).toMatch(
      /\.composer-wrap\s*\{[^}]*container:\s*composer-shell \/ inline-size;/s,
    );
    expect(styles).toMatch(
      /@container composer-shell \(max-width: 720px\)\s*\{[\s\S]*?\.composer:not\(:focus-within\):not\(\.is-recording\):not\(\.has-context\)[^{]*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--composer-control-size\);/s,
    );
    expect(styles).not.toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*@container composer-shell/,
    );
    expect(styles).toMatch(
      /\.composer:not\(:focus-within\):not\(\.is-recording\):not\(\.has-context\)[^{]*textarea\s*\{[^}]*height:\s*24px !important;[^}]*max-height:\s*24px;[^}]*line-height:\s*24px;/s,
    );
    expect(styles).toMatch(
      /\.composer-toolbar-end\s*> :not\(\.send\)\s*\{[^}]*display:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.composer-hint\[data-mobile-instruction="true"\]\s*\{[^}]*display:\s*none;/s,
    );
  });
});
