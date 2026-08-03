import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../src/web.css", import.meta.url),
  "utf8",
);

describe("web sidebar chrome", () => {
  it("hides the Host indicator together with the sidebar", () => {
    expect(styles).toMatch(
      /\.app-shell\.sidebar-hidden \+ \.web-session-indicator\s*\{[^}]*display:\s*none;/s,
    );
  });
});
