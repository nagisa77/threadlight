import { describe, expect, it } from "vitest";

import { isNearBottom } from "../src/index.js";

describe("isNearBottom", () => {
  it("follows output while the reader remains near the bottom", () => {
    expect(
      isNearBottom({ scrollHeight: 1_000, scrollTop: 410, clientHeight: 500 }),
    ).toBe(true);
  });

  it("stops following after the reader scrolls up", () => {
    expect(
      isNearBottom({ scrollHeight: 1_000, scrollTop: 250, clientHeight: 500 }),
    ).toBe(false);
  });
});
