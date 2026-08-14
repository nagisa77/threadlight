import { execFile } from "node:child_process";
import { screen, type DesktopCapturerSource } from "electron";
import type {
  ComputerShareTarget,
  ComputerUseAction,
} from "@threadlight/builtin-tools";
import type { DesktopComputerRequest } from "@threadlight/protocol";
import {
  layoutComputerSources,
  type ComputerFrameLayout,
  type ComputerSourceBounds,
} from "./computer-layout.js";
import type {
  ComputerCaptureSource,
  ComputerCaptureStreamMetadata,
  ComputerCaptureStreamStatus,
} from "./computer-capture-session.js";
import type { ComputerSessionOwner } from "./computer-session-lease.js";

export interface WindowMetadata {
  windowId: number;
  title: string;
  applicationName: string;
  processId: number;
  layer: number;
  bounds: ComputerSourceBounds;
}

export interface CaptureRecord {
  target: ComputerShareTarget;
  sourceId?: string;
  sourceType: "window" | "screen" | "application";
  sourceIds: readonly string[];
  applicationName: string;
  processId?: number;
  bounds?: ComputerSourceBounds;
}

export interface CaptureCatalog {
  records: ReadonlyMap<string, CaptureRecord>;
  sourceRecords: ReadonlyMap<string, CaptureRecord>;
  targets: readonly ComputerShareTarget[];
}

export interface ActiveCaptureSource extends ComputerCaptureSource {
  name: string;
  applicationName: string;
  processId?: number;
  bounds: ComputerSourceBounds;
}

export interface ShareSelection {
  mode: "none" | "applications" | "windows" | "display";
  targetIds: readonly string[];
  pictureInPicture: boolean;
  inputMode: "virtual" | "system";
}

export interface CursorPosition {
  x: number;
  y: number;
}

export const EMPTY_SELECTION: ShareSelection = {
  mode: "none",
  targetIds: [],
  pictureInPicture: false,
  inputMode: "virtual",
};

export function validateShareSelection(
  records: readonly CaptureRecord[],
  options: {
    mode: "applications" | "windows" | "display";
    inputMode: "virtual" | "system";
  },
): void {
  const expectedType =
    options.mode === "applications"
      ? "application"
      : options.mode === "windows"
        ? "window"
        : "display";
  if (records.some((record) => record.target.type !== expectedType)) {
    throw new Error(
      `All target ids must be ${expectedType} targets for ${options.mode} mode`,
    );
  }
  if (options.mode === "display" && records.length !== 1) {
    throw new Error("Display mode requires exactly one display target");
  }
  if (options.mode === "display" && options.inputMode === "virtual") {
    throw new Error(
      "Display capture has no target application for virtual input. Use system input only when physical cursor control is explicitly allowed.",
    );
  }
  if (
    options.inputMode === "virtual" &&
    records.some(
      (record) => record.sourceType !== "application" && !record.processId,
    )
  ) {
    throw new Error(
      "One or more selected windows cannot receive virtual input. Select an application target.",
    );
  }
}

export function expandCaptureSources(
  records: readonly CaptureRecord[],
  catalog: CaptureCatalog,
): ActiveCaptureSource[] {
  const sources = new Map<string, ActiveCaptureSource>();
  for (const record of records) {
    const expanded =
      record.sourceType === "application"
        ? record.sourceIds.flatMap((sourceId) => {
            const source = catalog.sourceRecords.get(sourceId);
            return source ? [source] : [];
          })
        : [record];
    for (const source of expanded) {
      if (!source.sourceId || !source.bounds) continue;
      sources.set(source.target.id, {
        key: source.target.id,
        sourceId: source.sourceId,
        name: source.target.windowTitle ?? source.target.name,
        applicationName: source.applicationName,
        ...(source.processId === undefined
          ? {}
          : { processId: source.processId }),
        bounds: source.bounds,
      });
    }
  }
  return [...sources.values()];
}

export function layoutActiveSources(
  sources: readonly (ActiveCaptureSource & ComputerCaptureStreamMetadata)[],
): ComputerFrameLayout {
  return layoutComputerSources(
    sources.map((source) => ({
      id: source.key,
      name: source.name,
      applicationName: source.applicationName,
      ...(source.processId === undefined
        ? {}
        : { processId: source.processId }),
      pixelWidth: source.width,
      pixelHeight: source.height,
      bounds: source.bounds,
    })),
  );
}

export function parseConfigureParams(value: unknown): {
  runId: string;
  threadId: string;
  mode: "applications" | "windows" | "display";
  targetIds: readonly string[];
  pictureInPicture: boolean;
  inputMode: "virtual" | "system";
} {
  if (!isObject(value)) throw new Error("Invalid computer configure request");
  const owner = parseComputerOwner(value);
  if (
    value.mode !== "applications" &&
    value.mode !== "windows" &&
    value.mode !== "display"
  ) {
    throw new Error("Invalid computer share mode");
  }
  if (
    !Array.isArray(value.targetIds) ||
    value.targetIds.length === 0 ||
    value.targetIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("Invalid computer share target ids");
  }
  if (
    typeof value.pictureInPicture !== "boolean" ||
    (value.inputMode !== "virtual" && value.inputMode !== "system")
  ) {
    throw new Error("Invalid computer share options");
  }
  return {
    ...owner,
    mode: value.mode,
    targetIds: value.targetIds,
    pictureInPicture: value.pictureInPicture,
    inputMode: value.inputMode,
  };
}

export function parseExecuteParams(value: unknown): {
  actions: readonly ComputerUseAction[];
  owner: ComputerSessionOwner;
} {
  if (!isObject(value) || !Array.isArray(value.actions)) {
    throw new Error("Invalid computer execute request");
  }
  return {
    actions: value.actions as ComputerUseAction[],
    owner: parseComputerOwner(value),
  };
}

export function parseComputerOwner(value: unknown): ComputerSessionOwner {
  if (
    !isObject(value) ||
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.threadId !== "string" ||
    !value.threadId
  ) {
    throw new Error("Invalid computer task ownership");
  }
  return { runId: value.runId, threadId: value.threadId };
}

export function isCaptureStatus(
  value: unknown,
): value is ComputerCaptureStreamStatus {
  return (
    isObject(value) &&
    typeof value.key === "string" &&
    typeof value.active === "boolean"
  );
}

export function requireStreamMetadata(
  value: unknown,
  sourceName: string,
): ComputerCaptureStreamMetadata {
  if (
    !isObject(value) ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    throw new Error(`Could not start live capture for ${sourceName}`);
  }
  return { width: value.width, height: value.height };
}

export function requireSessionDescription(
  value: unknown,
  expectedType: "offer" | "answer",
  sourceName: string,
): asserts value is { type: "offer" | "answer"; sdp: string } {
  if (
    !isObject(value) ||
    value.type !== expectedType ||
    typeof value.sdp !== "string" ||
    !value.sdp
  ) {
    throw new Error(`Could not relay the shared stream for ${sourceName}`);
  }
}

export function bestWindowMatch(
  source: DesktopCapturerSource,
  windows: readonly WindowMetadata[],
): number {
  const windowId = /^window:(\d+):/.exec(source.id)?.[1];
  if (windowId) {
    const exactId = windows.findIndex(
      (window) => window.windowId === Number(windowId),
    );
    if (exactId >= 0) return exactId;
  }
  const exact = windows.findIndex((window) => window.title === source.name);
  if (exact >= 0) return exact;
  const normalizedSource = normalizeTitle(source.name);
  return windows.findIndex(
    (window) => normalizeTitle(window.title) === normalizedSource,
  );
}

export function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function compareTargets(
  left: ComputerShareTarget,
  right: ComputerShareTarget,
): number {
  const order = { application: 0, window: 1, display: 2 };
  return (
    order[left.type] - order[right.type] || left.name.localeCompare(right.name)
  );
}

export function listMacOSWindows(): Promise<readonly WindowMetadata[]> {
  if (process.platform !== "darwin") return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", WINDOW_CATALOG_SCRIPT],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              "Threadlight could not enumerate shareable application windows. Check Screen Recording permission.",
            ),
          );
          return;
        }
        try {
          const value = JSON.parse(stdout) as unknown;
          if (!Array.isArray(value)) throw new Error("Invalid window catalog");
          resolve(value.filter(isWindowMetadata));
        } catch (parseError) {
          reject(
            new Error(
              `Could not read the macOS window catalog: ${String(parseError)}`,
            ),
          );
        }
      },
    );
  });
}

export function isWindowMetadata(value: unknown): value is WindowMetadata {
  if (!isObject(value) || !isObject(value.bounds)) return false;
  return (
    typeof value.windowId === "number" &&
    typeof value.title === "string" &&
    typeof value.applicationName === "string" &&
    typeof value.processId === "number" &&
    typeof value.layer === "number" &&
    typeof value.bounds.x === "number" &&
    typeof value.bounds.y === "number" &&
    typeof value.bounds.width === "number" &&
    typeof value.bounds.height === "number" &&
    value.bounds.width > 0 &&
    value.bounds.height > 0
  );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const WINDOW_CATALOG_SCRIPT = String.raw`
export function run() {
  ObjC.import("Cocoa");
  ObjC.import("CoreGraphics");
  const rows = ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo(17, 0),
  );
  const output = [];
  for (let index = 0; index < Number(rows.count); index += 1) {
    const window = ObjC.deepUnwrap(rows.objectAtIndex(index));
    const bounds = window.kCGWindowBounds;
    if (!bounds || bounds.Width <= 1 || bounds.Height <= 1) continue;
    output.push({
      windowId: window.kCGWindowNumber,
      title: window.kCGWindowName || "",
      applicationName: window.kCGWindowOwnerName,
      processId: window.kCGWindowOwnerPID,
      layer: window.kCGWindowLayer,
      bounds: {
        x: bounds.X,
        y: bounds.Y,
        width: bounds.Width,
        height: bounds.Height,
      },
    });
  }
  return JSON.stringify(output);
}
`;
