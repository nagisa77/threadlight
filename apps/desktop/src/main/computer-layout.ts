export const COMPUTER_CANVAS_WIDTH = 1440;
export const COMPUTER_CANVAS_HEIGHT = 900;

export interface ComputerSourceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputerFrameSource {
  id: string;
  name: string;
  applicationName: string;
  processId?: number;
  pixelWidth: number;
  pixelHeight: number;
  bounds: ComputerSourceBounds;
  imageUrl?: string;
}

export interface ComputerFrameTile {
  sourceId: string;
  name: string;
  applicationName: string;
  processId?: number;
  tile: ComputerSourceBounds;
  content: ComputerSourceBounds;
  sourceBounds: ComputerSourceBounds;
  imageUrl?: string;
}

export interface ComputerFrameLayout {
  width: number;
  height: number;
  tiles: readonly ComputerFrameTile[];
}

export interface MappedComputerPoint {
  sourceId: string;
  processId?: number;
  x: number;
  y: number;
}

const CANVAS_PADDING = 16;
const TILE_GAP = 12;
const TILE_HEADER_HEIGHT = 30;
const TILE_INSET = 2;
const CONTENT_EDGE_SNAP_DISTANCE = 64;

export function layoutComputerSources(
  sources: readonly ComputerFrameSource[],
  width = COMPUTER_CANVAS_WIDTH,
  height = COMPUTER_CANVAS_HEIGHT,
): ComputerFrameLayout {
  if (sources.length === 0) return { width, height, tiles: [] };

  const columns = Math.ceil(Math.sqrt(sources.length));
  const rows = Math.ceil(sources.length / columns);
  const tileWidth =
    (width - CANVAS_PADDING * 2 - TILE_GAP * (columns - 1)) / columns;
  const tileHeight =
    (height - CANVAS_PADDING * 2 - TILE_GAP * (rows - 1)) / rows;

  return {
    width,
    height,
    tiles: sources.map((source, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const tile = {
        x: CANVAS_PADDING + column * (tileWidth + TILE_GAP),
        y: CANVAS_PADDING + row * (tileHeight + TILE_GAP),
        width: tileWidth,
        height: tileHeight,
      };
      const available = {
        x: tile.x + TILE_INSET,
        y: tile.y + TILE_HEADER_HEIGHT,
        width: tile.width - TILE_INSET * 2,
        height: tile.height - TILE_HEADER_HEIGHT - TILE_INSET,
      };
      const sourceAspect =
        Math.max(1, source.pixelWidth) / Math.max(1, source.pixelHeight);
      const availableAspect = available.width / available.height;
      const content =
        sourceAspect > availableAspect
          ? {
              x: available.x,
              y:
                available.y +
                (available.height - available.width / sourceAspect) / 2,
              width: available.width,
              height: available.width / sourceAspect,
            }
          : {
              x:
                available.x +
                (available.width - available.height * sourceAspect) / 2,
              y: available.y,
              width: available.height * sourceAspect,
              height: available.height,
            };

      return {
        sourceId: source.id,
        name: source.name,
        applicationName: source.applicationName,
        ...(source.processId === undefined
          ? {}
          : { processId: source.processId }),
        tile,
        content,
        sourceBounds: source.bounds,
        ...(source.imageUrl === undefined
          ? {}
          : { imageUrl: source.imageUrl }),
      };
    }),
  };
}

export function mapCanvasPoint(
  layout: ComputerFrameLayout,
  x: number,
  y: number,
): MappedComputerPoint | undefined {
  const exact = layout.tiles.find((candidate) =>
    contains(candidate.content, x, y),
  );
  const snapped = exact ? undefined : snapToNearbyContent(layout, x, y);
  const tile = exact ?? snapped?.tile;
  if (!tile) return;
  const mappedX = snapped?.x ?? x;
  const mappedY = snapped?.y ?? y;
  const relativeX = (mappedX - tile.content.x) / tile.content.width;
  const relativeY = (mappedY - tile.content.y) / tile.content.height;
  return {
    sourceId: tile.sourceId,
    ...(tile.processId === undefined ? {} : { processId: tile.processId }),
    x: tile.sourceBounds.x + relativeX * tile.sourceBounds.width,
    y: tile.sourceBounds.y + relativeY * tile.sourceBounds.height,
  };
}

function snapToNearbyContent(
  layout: ComputerFrameLayout,
  x: number,
  y: number,
): { tile: ComputerFrameTile; x: number; y: number } | undefined {
  const tile = layout.tiles.find((candidate) =>
    contains(candidate.tile, x, y),
  );
  if (!tile) return;
  const snappedX = clamp(x, tile.content.x, tile.content.x + tile.content.width);
  const snappedY = clamp(y, tile.content.y, tile.content.y + tile.content.height);
  if (Math.hypot(x - snappedX, y - snappedY) > CONTENT_EDGE_SNAP_DISTANCE) {
    return;
  }
  return { tile, x: snappedX, y: snappedY };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function contains(
  bounds: ComputerSourceBounds,
  x: number,
  y: number,
): boolean {
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}
