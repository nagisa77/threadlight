import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop preload bundle", () => {
  it("is self-contained for Electron's sandbox", () => {
    const bundle = readFileSync(
      new URL("../out/preload/index.cjs", import.meta.url),
      "utf8",
    );

    expect(bundle).not.toMatch(/require\(["']@threadlight\//);
    expect(bundle).toContain("attachment.local_path_unavailable");
  });
});
