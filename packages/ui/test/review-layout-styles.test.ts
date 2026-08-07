import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

describe("review panel layout", () => {
  it("adapts to the panel width without collapsing labels vertically", () => {
    expect(styles).toMatch(
      /\.review-view\s*\{[^}]*container-name:\s*review-panel;[^}]*container-type:\s*inline-size;/s,
    );
    expect(styles).toMatch(
      /\.review-summary strong\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.review-delivery-button,[\s\S]*?\.review-discard-button\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.automatic-delivery-status\s*\{[^}]*min-width:\s*220px;/s,
    );
    expect(styles).toContain("@container review-panel (max-width: 720px)");
    expect(styles).toContain("@container review-panel (max-width: 540px)");
    expect(styles).toContain("@container review-panel (max-width: 400px)");
  });

  it("separates view controls, delivery, and recovery into stable groups", () => {
    expect(styles).toMatch(
      /\.review-toolbar\s*\{[^}]*display:\s*grid;[^}]*align-items:\s*stretch;[^}]*justify-content:\s*stretch;/s,
    );
    expect(styles).toMatch(
      /\.review-toolbar-main\s*\{[^}]*justify-content:\s*space-between;/s,
    );
    expect(styles).toMatch(
      /\.review-operation-bar\s*\{[^}]*justify-content:\s*space-between;/s,
    );
    expect(styles).toMatch(
      /\.review-recovery-actions\s*\{[^}]*border-left:\s*1px solid var\(--line\);/s,
    );
  });

  it("removes the file line-number column and reduces source sizing on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.file-source\s*\{[^}]*font-size:\s*11px;[\s\S]*?\.file-source-line\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.file-source-line-number\s*\{[^}]*display:\s*none;[\s\S]*?\.file-source-line code\s*\{[^}]*padding-inline:\s*10px;/s,
    );
  });

  it("removes the split-layout control on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)\s*\{\s*\.diff-layout-toggle\s*\{[^}]*display:\s*none;/s,
    );
  });
});
