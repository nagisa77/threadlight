import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

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

  it("keeps conversation access choices compact", () => {
    expect(styles).toMatch(
      /\.action-popover\s+\.conversation-access-option\s*\{[^}]*min-height:\s*54px;[^}]*padding:\s*7px 10px;/s,
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
