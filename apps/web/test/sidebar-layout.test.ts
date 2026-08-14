import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/web.css", import.meta.url), "utf8");

describe("web sidebar chrome", () => {
  it("hides the Host indicator together with the sidebar", () => {
    expect(styles).toMatch(
      /\.app-shell\.sidebar-hidden \+ \.web-session-indicator\s*\{[^}]*display:\s*none;/s,
    );
  });

  it("removes the duplicate Host status from the web sidebar footer", () => {
    expect(styles).toMatch(
      /\.web-runtime \.sidebar-footer > \.runtime-status-control\s*\{[^}]*display:\s*none;/s,
    );
  });

  it("keeps the Host indicator above the open mobile sidebar", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.web-session-indicator\s*\{[^}]*z-index:\s*90;[^}]*safe-area-inset-top[^}]*safe-area-inset-left/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.web-session-indicator\s*\{[^}]*height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.web-session-disconnect\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
  });
});
