import { describe, expect, it } from "vitest";

import { createBrowserUuid } from "../src/index.js";

describe("createBrowserUuid", () => {
  it("uses crypto.randomUUID when the browser provides it", () => {
    expect(
      createBrowserUuid({
        randomUUID: () => "native-uuid",
      }),
    ).toBe("native-uuid");
  });

  it("generates a v4 UUID when an insecure mobile context lacks randomUUID", () => {
    expect(
      createBrowserUuid({
        getRandomValues(array) {
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(
            Array.from({ length: 16 }, (_, index) => index),
          );
          return array;
        },
      }),
    ).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
