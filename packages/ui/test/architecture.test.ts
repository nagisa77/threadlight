import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function lines(path: string): number {
  return source(path).split("\n").length;
}

describe("UI feature boundaries", () => {
  it("keeps the application and workspace orchestrators below the agreed limits", () => {
    expect(lines("../src/app.tsx")).toBeLessThan(5_000);
    expect(lines("../src/workspace-panel.tsx")).toBeLessThan(3_000);
  });

  it("loads feature styles through one stable public entrypoint", () => {
    const entry = source("../src/styles.css");
    expect(entry.match(/@import/g)).toHaveLength(7);
    expect(entry).toContain("./styles/automations.css");
    expect(entry).toContain("./styles/conversation.css");
    expect(entry).toContain("./styles/settings.css");
    expect(entry).toContain("./styles/workspace.css");
    expect(lines("../src/styles.css")).toBeLessThan(20);
  });
});
