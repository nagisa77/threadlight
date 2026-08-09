import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

describe("dialog action hierarchy", () => {
  it("keeps connector actions naturally sized and right aligned", () => {
    expect(styles).toMatch(
      /\.connector-dialog-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s,
    );
    expect(styles).not.toMatch(
      /\.connector-dialog-actions\s*\{[^}]*grid-template-columns:/s,
    );
    expect(styles).toMatch(
      /\.dialog-button\.quiet-danger\s*\{[^}]*margin-right:\s*auto;/s,
    );
  });

  it("separates approval scope selection from the final decision", () => {
    expect(styles).toMatch(
      /\.execution-approval-scope-options\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
    );
    expect(styles).toMatch(
      /\.execution-approval-scope-option\.selected\s*\{[^}]*border-color:/s,
    );
    expect(styles).toMatch(
      /\.execution-approval-actions\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s,
    );
  });

  it("keeps Host removal separate and gives directory completion a bounded popover", () => {
    expect(styles).toMatch(
      /\.host-connection-row\s*\{[^}]*display:\s*flex;[^}]*border:/s,
    );
    expect(styles).toMatch(
      /\.host-connection-edit,\s*\.host-connection-remove\s*\{[^}]*width:\s*30px;[^}]*background:\s*transparent;/s,
    );
    expect(styles).toMatch(
      /\.remote-directory-popover\s*\{[^}]*max-height:\s*min\(260px,[^;]*;[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /\.remote-directory-list\s*\{[^}]*overflow-y:\s*auto;/s,
    );
  });

  it("gives composer selection popovers one shared heading and row rhythm", () => {
    expect(styles).toMatch(
      /\.action-popover-heading\s*\{[^}]*padding:\s*6px 10px 4px;[^}]*font-size:\s*10px;/s,
    );
    expect(styles).toMatch(
      /\.action-popover\s+\.composer-popover-option\s*\{[^}]*gap:\s*10px;[^}]*padding:\s*7px 10px;/s,
    );
    expect(styles).toMatch(
      /\.composer-popover-option-copy small\s*\{[^}]*font-size:\s*10px;[^}]*line-height:\s*1\.4;/s,
    );
    expect(styles).toMatch(
      /\.model-selector-popover\s*\{[^}]*gap:\s*2px;/s,
    );
  });

  it("keeps composer popover arrows and model labels visually stable", () => {
    expect(styles).toMatch(
      /\.development-mode-chevron,\s*\.conversation-access-chevron,\s*\.composer-action\.model \.model-trigger-arrow\s*\{[^}]*transition:\s*transform 150ms var\(--ease-out\);/s,
    );
    expect(styles).toMatch(
      /\.composer-action\.model \.composer-model-label\s*\{[^}]*min-width:\s*0;[^}]*line-height:\s*1\.4;/s,
    );
  });

  it("gives development mode the same hover feedback as adjacent selectors", () => {
    expect(styles).toMatch(
      /\.composer-action\.model:hover:not\(:disabled\):not\(\.active\),\s*\.development-mode-trigger:hover:not\(:disabled\):not\(\[aria-expanded="true"\]\),\s*\.conversation-access-trigger:hover:not\(:disabled\):not\(\s*\[aria-expanded="true"\]\s*\)\s*\{[^}]*color:\s*var\(--ink\);[^}]*background:/s,
    );
    expect(styles).toMatch(
      /\.development-mode-trigger,\s*\.conversation-access-trigger\s*\{[^}]*transition:[^}]*background-color 140ms ease,[^}]*transform 140ms var\(--ease-out\);/s,
    );
  });

  it("keeps the remote file browser bounded and directly scrollable", () => {
    expect(styles).toMatch(
      /\.remote-system-file-list\s*\{[^}]*height:\s*min\(340px,[^;]*;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
    );
  });

  it("truncates long Host names without widening the sidebar footer", () => {
    expect(styles).toMatch(
      /\.sidebar-footer\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /\.runtime-status-control\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /\.runtime-status-label\s*\{[^}]*max-width:\s*44%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    );
    expect(styles).toMatch(
      /\.status-mode\s*\{[^}]*flex:\s*1 1 0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    );
  });
});
