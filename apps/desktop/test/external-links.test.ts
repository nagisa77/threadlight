import { describe, expect, it, vi } from "vitest";

import {
  createExternalWindowHandler,
  isWebUrl,
} from "../src/main/external-links.js";

describe("external web links", () => {
  it.each([
    "https://example.com/news",
    "http://localhost:3000/docs",
  ])("opens %s with the system handler and keeps Electron closed", (url) => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const handleWindowOpen = createExternalWindowHandler(openExternal);

    expect(handleWindowOpen({ url })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it.each([
    "javascript:alert(1)",
    "file:///Users/example/private.txt",
    "mailto:hello@example.com",
    "not a url",
  ])("rejects the non-web target %s", (url) => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const handleWindowOpen = createExternalWindowHandler(openExternal);

    expect(handleWindowOpen({ url })).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
    expect(isWebUrl(url)).toBe(false);
  });
});
