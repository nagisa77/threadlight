import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktopDocument = readFileSync(
  new URL("../../../apps/desktop/src/renderer/index.html", import.meta.url),
  "utf8",
);
const webDocument = readFileSync(
  new URL("../../../apps/web/index.html", import.meta.url),
  "utf8",
);

describe("source favicon content policy", () => {
  it("allows HTTPS source favicons in desktop and web clients", () => {
    for (const document of [desktopDocument, webDocument]) {
      const policy = document.match(
        /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
      )?.[1];

      expect(policy).toMatch(/img-src [^;]*https:/);
      expect(policy).not.toMatch(/img-src [^;]*http:/);
    }
  });
});
