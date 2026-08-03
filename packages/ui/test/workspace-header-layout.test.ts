import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

describe("workspace header layout", () => {
  it("keeps the running status intact while long titles truncate", () => {
    expect(styles).toMatch(
      /\.workspace-header-title\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto;/s,
    );
    expect(styles).toMatch(
      /\.workspace-header-actions\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
    expect(styles).toMatch(
      /\.running-badge\s*\{[^}]*display:\s*inline-flex;[^}]*flex:\s*0 0 auto;[^}]*line-height:\s*1;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.running-badge svg\s*\{[^}]*flex:\s*0 0 auto;/s,
    );
  });
});
