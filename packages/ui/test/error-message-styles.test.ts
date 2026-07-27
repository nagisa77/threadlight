import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);

describe("assistant error message styles", () => {
  it("uses a neutral status surface instead of red error copy", () => {
    const messageBodyRule = styles.match(
      /\.message\.assistant\.error \.message-body\s*\{([^}]*)\}/,
    )?.[1];
    const markdownRule = styles.match(
      /\.message\.assistant\.error \.markdown-content\s*\{([^}]*)\}/,
    )?.[1];

    expect(messageBodyRule).toContain("border: 1px solid var(--line)");
    expect(messageBodyRule).toContain("background:");
    expect(messageBodyRule).not.toContain("var(--danger)");
    expect(markdownRule).toContain("color: var(--ink)");
    expect(markdownRule).not.toContain("var(--danger)");
  });
});
