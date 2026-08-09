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

describe("agent panel layout", () => {
  it("keeps the agent list on the right and lets the transcript reclaim its space", () => {
    expect(styles).toMatch(
      /\.agent-panel-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(176px, 32%\);/s,
    );
    expect(styles).toMatch(
      /\.agent-panel-list\s*\{[^}]*border-left:\s*1px solid var\(--line\);/s,
    );
    expect(styles).toMatch(
      /\.agent-panel-layout\.collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
  });

  it("turns the agent list into a compact horizontal picker on narrow panels", () => {
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)\s*\{[\s\S]*?\.agent-panel-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)[\s\S]*?\.agent-panel-list\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*border-left:\s*0;/s,
    );
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)[\s\S]*?\.agent-panel-agent\s*\{[^}]*flex:\s*0 0 172px;[^}]*scroll-snap-align:\s*start;/s,
    );
  });

  it("bounds long tasks and uses compact icon actions on narrow panels", () => {
    expect(styles).toMatch(
      /\.agent-conversation-task p\s*\{[^}]*-webkit-line-clamp:\s*3;/s,
    );
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)[\s\S]*?\.agent-conversation-task:not\(\.expanded\) p\s*\{[^}]*-webkit-line-clamp:\s*2;/s,
    );
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)[\s\S]*?\.agent-conversation-task\.expanded p\s*\{[^}]*max-height:\s*min\(180px, 28dvh\);/s,
    );
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)[\s\S]*?\.agent-conversation-actions \.agent-action\s*\{[^}]*width:\s*38px;[^}]*justify-content:\s*center;[^}]*padding:\s*0;/s,
    );
    expect(styles).toMatch(
      /@container agent-panel \(max-width: 560px\)[\s\S]*?\.agent-conversation-actions \.agent-action span\s*\{[^}]*display:\s*none;/s,
    );
  });

  it("compacts inactive workspace tabs without shrinking touch targets", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.workspace-panel\s*\{[^}]*grid-template-rows:\s*54px minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tab:not\(\.active\)\s*\{[^}]*width:\s*44px;[^}]*flex:\s*0 0 44px;[^}]*justify-content:\s*center;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tab:not\(\.active\) > span:nth-child\(2\),\s*\.workspace-tab:not\(\.active\) \.workspace-tab-close\s*\{[^}]*display:\s*none;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.panel-add-trigger,\s*\.workspace-panel-actions \.header-terminal-button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
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
      /@container composer-shell \(max-width: 720px\)\s*\{[\s\S]*?\.composer:not\(:focus-within\):not\(\.is-voice-active\):not\(\.has-context\)[^{]*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--composer-control-size\);/s,
    );
    expect(styles).not.toMatch(
      /@media \(hover: none\) and \(pointer: coarse\)\s*\{\s*@container composer-shell/,
    );
    expect(styles).toMatch(
      /\.composer:not\(:focus-within\):not\(\.is-voice-active\):not\(\.has-context\)[^{]*textarea\s*\{[^}]*height:\s*24px !important;[^}]*max-height:\s*24px;[^}]*line-height:\s*24px;/s,
    );
    expect(styles).toMatch(
      /\.composer-toolbar-end\s*> :not\(\.send\)\s*\{[^}]*display:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.composer-hint\[data-mobile-instruction="true"\]\s*\{[^}]*display:\s*none;/s,
    );
  });
});
