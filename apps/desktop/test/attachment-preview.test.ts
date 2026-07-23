import { describe, expect, it } from "vitest";

import { attachmentPreviewUrl } from "../src/renderer/attachment-preview.js";

describe("attachmentPreviewUrl", () => {
  it("encodes a local path with browser APIs for the preview protocol", () => {
    const path = "/Users/tim/Desktop/截图 2026-07-23.png";

    const url = attachmentPreviewUrl(path);

    expect(url).toBe(
      `threadlight-attachment://local/${Buffer.from(path, "utf8").toString("base64url")}`,
    );
    expect(url).not.toContain(path);
  });
});
