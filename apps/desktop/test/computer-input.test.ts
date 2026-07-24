import { describe, expect, it, vi } from "vitest";

import {
  nativeComputerInputCandidates,
  performComputerActionsWithAddon,
} from "../src/main/computer-input.js";

describe("native macOS computer input bridge", () => {
  it("passes routed actions to the native AX module without changing shape", () => {
    const perform = vi.fn();
    performComputerActionsWithAddon(
      { perform },
      [
        {
          type: "click",
          x: 220,
          y: 120,
          button: "left",
          processId: 42,
        },
        {
          type: "type",
          text: "亮度",
          processId: 42,
        },
        {
          type: "drag",
          path: [
            { x: 300, y: 400 },
            { x: 500, y: 400 },
          ],
          processId: 42,
        },
      ],
      "virtual",
    );

    expect(JSON.parse(perform.mock.calls[0]?.[0] as string)).toEqual({
      actions: [
        {
          type: "click",
          x: 220,
          y: 120,
          button: "left",
          processId: 42,
        },
        {
          type: "type",
          text: "亮度",
          processId: 42,
        },
        {
          type: "drag",
          path: [
            { x: 300, y: 400 },
            { x: 500, y: 400 },
          ],
          processId: 42,
        },
      ],
      inputMode: "virtual",
    });
  });

  it("resolves both bundled and source-tree native module locations", () => {
    expect(nativeComputerInputCandidates("/app/out/main")).toContain(
      "/app/out/native/computer-input.node",
    );
    expect(nativeComputerInputCandidates("/app/src/main")).toContain(
      "/app/out/native/computer-input.node",
    );
  });
});
