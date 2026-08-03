import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const webDocument = readFileSync(
  new URL("../../../apps/web/index.html", import.meta.url),
  "utf8",
);

describe("mobile form controls", () => {
  it("keeps iOS web inputs at 16px or larger to prevent focus zoom", () => {
    expect(styles).toMatch(
      /@supports \(-webkit-touch-callout: none\)[\s\S]*?@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?html\[data-platform="web"\] :is\(input, textarea, select\)\s*\{[^}]*font-size:\s*max\(16px, 1em\) !important;/s,
    );
  });

  it("does not disable user scaling in the web viewport", () => {
    const viewport = webDocument.match(
      /<meta\s+name="viewport"\s+content="([^"]+)"\s*\/>/,
    )?.[1];

    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(viewport).not.toMatch(/maximum-scale\s*=\s*1(?:\.0)?(?:,|$)/i);
  });
});
