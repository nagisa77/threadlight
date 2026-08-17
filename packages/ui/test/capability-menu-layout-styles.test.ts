import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

describe("capability menu layout styles", () => {
  it("preserves the full skill name before truncating its local path", () => {
    const skillNameRule = styles.match(
      /\.capability-option-title strong\s*\{([^}]*)\}/,
    )?.[1];
    const locationRule = styles.match(
      /\.capability-option-location\s*\{([^}]*)\}/,
    )?.[1];

    expect(skillNameRule).toContain("max-width: 100%");
    expect(skillNameRule).toContain("flex: 0 0 auto");
    expect(locationRule).toContain("min-width: 0");
    expect(locationRule).toContain("flex: 1 1 auto");
  });
});
