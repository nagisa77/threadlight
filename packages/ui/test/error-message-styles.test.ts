import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

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
