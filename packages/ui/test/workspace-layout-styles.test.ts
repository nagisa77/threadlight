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

  it("aligns phone navigation and global actions on one 44px row", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.sidebar-collapse-button,\s*\.sidebar-reveal-button\s*\{[^}]*top:\s*calc\(3px \+ env\(safe-area-inset-top, 0px\)\);[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-header,\s*\.app-shell\.sidebar-hidden \.workspace-header\s*\{[^}]*height:\s*calc\(50px \+ env\(safe-area-inset-top, 0px\)\);[^}]*padding-left:\s*56px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-global-actions\s*\{[^}]*top:\s*calc\(3px \+ env\(safe-area-inset-top, 0px\)\);[^}]*height:\s*44px;[^}]*gap:\s*0;/s,
    );
  });
});

describe("mobile overlays and floating controls", () => {
  it("uses a full-screen command palette above the mobile drawer", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.dialog-backdrop\s*\{[^}]*z-index:\s*230;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.command-palette-backdrop\s*\{[^}]*align-items:\s*stretch;[^}]*padding:\s*0;[^}]*backdrop-filter:\s*none;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.command-palette\s*\{[^}]*width:\s*100%;[^}]*height:\s*100dvh;[^}]*border-radius:\s*0;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.command-palette-clear,\s*\.command-palette-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
  });

  it("floats status and jump actions without reserving a composer row", () => {
    expect(styles).toMatch(
      /\.composer-floating-controls\s*\{[^}]*position:\s*absolute;[^}]*display:\s*flex;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.composer-floating-controls\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-40px;[^}]*min-height:\s*0;[^}]*margin-bottom:\s*0;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.jump-to-latest\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s,
    );
  });
});

describe("mobile touch surfaces", () => {
  it("uses full-size controls in supporting pages and the workspace tree", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.model-select-wrap,\s*\.secret-input-wrap\s*\{[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.diagnostics-refresh,\s*\.diagnostics-export\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tree-search input\s*\{[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tree-row\s*\{[^}]*height:\s*44px;/s,
    );
  });

  it("uses 44px controls throughout the phone automation editor", () => {
    expect(styles).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.automations-primary,[\s\S]*?\.automation-editor-state\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.automation-editor-field :is\(input, select, textarea\)\s*\{[^}]*min-height:\s*44px;/s,
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

  it("keeps complete workspace tab titles in a horizontal mobile scroller", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.workspace-panel\s*\{[^}]*grid-template-rows:\s*54px minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tab-strip\s*\{[^}]*overscroll-behavior-inline:\s*contain;[^}]*touch-action:\s*pan-x;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tab\s*\{[^}]*min-width:\s*max-content;[^}]*max-width:\s*none;[^}]*flex:\s*0 0 auto;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace-tab > span:nth-child\(2\)\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.panel-add-trigger,\s*\.workspace-panel-actions \.header-terminal-button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
  });
});

describe("expanded composer layout", () => {
  it("fits the initial empty state to its conversation row without overflow", () => {
    expect(styles).toMatch(
      /\.conversation\.is-empty \.conversation-inner\s*\{[^}]*height:\s*100%;/s,
    );
    expect(styles).toMatch(/\.empty-state\s*\{[^}]*min-height:\s*100%;/s);
    expect(styles).not.toMatch(
      /\.empty-state\s*\{[^}]*min-height:\s*calc\(100d?vh/s,
    );
  });

  it("keeps composer guidance and draft feedback on one compact row", () => {
    expect(styles).toMatch(
      /\.composer-footer-status\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.composer-hint\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.composer-productivity-status\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin:\s*0;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.composer-footer-status:has\([\s\S]*?\.composer-hint\[data-mobile-instruction="true"\][\s\S]*?\):not\(:has\(\.draft-status\)\)\s*\{[^}]*display:\s*none;/s,
    );
  });

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
