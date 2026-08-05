import { describe, expect, it } from "vitest";

import { shouldIgnoreComposerKey } from "../src/app.js";

describe("composer IME handling", () => {
  it("ignores Enter while the local composition state is active", () => {
    expect(shouldIgnoreComposerKey(true, { isComposing: false, keyCode: 13 })).toBe(
      true,
    );
  });

  it("supports browser composition state and the legacy IME key signal", () => {
    expect(
      shouldIgnoreComposerKey(false, { isComposing: true, keyCode: 13 }),
    ).toBe(true);
    expect(
      shouldIgnoreComposerKey(false, { isComposing: false, keyCode: 229 }),
    ).toBe(true);
  });

  it("does not suppress a normal Enter key", () => {
    expect(
      shouldIgnoreComposerKey(false, { isComposing: false, keyCode: 13 }),
    ).toBe(false);
  });
});
