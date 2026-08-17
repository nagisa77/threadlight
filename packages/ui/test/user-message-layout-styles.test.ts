import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

describe("user message layout styles", () => {
  it("shrinks short messages to their content while preserving the long-message cap", () => {
    const messageBodyRule = styles.match(
      /\.message-body\s*\{([^}]*)\}/,
    )?.[1];
    const userMessageRule = styles.match(
      /\.message\.user \.message-body\s*\{([^}]*)\}/,
    )?.[1];

    expect(userMessageRule).toContain("width: fit-content");
    expect(messageBodyRule).toContain("max-width: min(640px, 86%)");
  });
});
