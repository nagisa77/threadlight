import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

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
});
