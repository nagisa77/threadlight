import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/web.css", import.meta.url),
  "utf8",
);

describe("saved-host selector styling", () => {
  it("gives the manage button press feedback", () => {
    expect(styles).toMatch(
      /\.web-host-manage:active\s*\{[^}]*transform:\s*scale\(0\.97\)/s,
    );
  });

  it("keeps the selector at the same height and focus treatment as inputs", () => {
    expect(styles).toMatch(/\.web-host-select\s*\{[^}]*height:\s*42px/s);
    expect(styles).toMatch(
      /\.web-host-select:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px/s,
    );
  });

  it("gates host hover states behind fine pointers", () => {
    const hoverBlock = styles.match(
      /@media \(hover: hover\) and \(pointer: fine\) \{(.*?)\n\}/gs,
    )?.at(-1);
    expect(hoverBlock).toBeTruthy();
    expect(hoverBlock).toContain(".web-host-manage:hover:not(:disabled)");
    expect(hoverBlock).toContain(".web-host-row:hover");
    expect(hoverBlock).toContain(".web-host-row-actions button:hover");
  });

  it("scales the manager popover in with a custom ease-out", () => {
    expect(styles).toMatch(
      /\.web-host-manager\s*\{[^}]*animation:\s*web-host-manager-enter\s+150ms\s+var\(--ease-out\)/s,
    );
    expect(styles).toMatch(
      /@keyframes web-host-manager-enter\s*\{[^}]*transform:\s*scale\(0\.95\)/s,
    );
  });

  it("disables popover animation for reduced motion", () => {
    const reduced = styles.match(
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g,
    )?.at(-1);
    expect(reduced).toContain(".web-host-manager");
    expect(reduced).toMatch(/animation:\s*none/);
  });
});
