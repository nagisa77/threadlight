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

  it("includes opaque attachment metadata for authenticated remote previews", () => {
    const path = "/srv/project/.threadlight/uploads/private-image.png";

    const url = attachmentPreviewUrl(
      path,
      "attachment-1",
      "image/png",
    );

    expect(url).toBe(
      `threadlight-attachment://local/attachment-1/${Buffer.from(path, "utf8").toString("base64url")}?mimeType=image%2Fpng`,
    );
    expect(url).not.toContain(path);
  });
});
