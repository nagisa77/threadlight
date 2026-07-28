import { describe, expect, it } from "vitest";

import { ModelStatePersistence } from "../src/model-state-persistence.js";

describe("ModelStatePersistence", () => {
  it("applies provider preparation and enforces the app-server size limit", () => {
    const persistence = new ModelStatePersistence({
      maxBytes: 32,
      prepareState(state) {
        expect(state).toEqual({ content: "sensitive" });
        return { content: "x".repeat(100) };
      },
    });

    expect(() =>
      persistence.prepare({ content: "sensitive" }),
    ).toThrow("exceeds the 32-byte persistence limit");
  });

  it("rejects non-serializable model state at the persistence boundary", () => {
    const persistence = new ModelStatePersistence();
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => persistence.prepare(circular)).toThrow(
      "Model state is not JSON-serializable",
    );
  });
});
