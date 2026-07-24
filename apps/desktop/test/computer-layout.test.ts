import { describe, expect, it } from "vitest";

import {
  layoutComputerSources,
  mapCanvasPoint,
  type ComputerFrameSource,
} from "../src/main/computer-layout.js";

const source = (
  overrides: Partial<ComputerFrameSource> = {},
): ComputerFrameSource => ({
  id: "window:1:0",
  name: "Settings",
  applicationName: "System Settings",
  processId: 42,
  pixelWidth: 1600,
  pixelHeight: 1000,
  bounds: { x: -1440, y: -900, width: 800, height: 500 },
  imageUrl: "data:image/png;base64,AA==",
  ...overrides,
});

describe("computer shared-content layout", () => {
  it("maps the center of a tiled source back to negative multi-display coordinates", () => {
    const layout = layoutComputerSources([source()]);
    const content = layout.tiles[0]?.content;
    expect(content).toBeDefined();

    const mapped = mapCanvasPoint(
      layout,
      (content?.x ?? 0) + (content?.width ?? 0) / 2,
      (content?.y ?? 0) + (content?.height ?? 0) / 2,
    );

    expect(mapped).toEqual({
      sourceId: "window:1:0",
      processId: 42,
      x: -1040,
      y: -650,
    });
  });

  it("lays out multiple apps without overlapping their interactive content", () => {
    const layout = layoutComputerSources([
      source(),
      source({
        id: "window:2:0",
        processId: 43,
        bounds: { x: 100, y: 50, width: 600, height: 900 },
      }),
      source({
        id: "window:3:0",
        processId: 44,
        bounds: { x: 800, y: 50, width: 900, height: 600 },
      }),
    ]);

    expect(layout.tiles).toHaveLength(3);
    for (const [index, tile] of layout.tiles.entries()) {
      for (const other of layout.tiles.slice(index + 1)) {
        const overlaps =
          tile.content.x < other.content.x + other.content.width &&
          tile.content.x + tile.content.width > other.content.x &&
          tile.content.y < other.content.y + other.content.height &&
          tile.content.y + tile.content.height > other.content.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("does not route clicks on labels or letterboxing", () => {
    const layout = layoutComputerSources([source()]);
    const tile = layout.tiles[0];
    expect(tile).toBeDefined();
    expect(
      mapCanvasPoint(layout, (tile?.tile.x ?? 0) + 8, (tile?.tile.y ?? 0) + 8),
    ).toBeUndefined();
  });
});
