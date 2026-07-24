import { describe, expect, it, vi } from "vitest";

import {
  ComputerCaptureSession,
  type ComputerCaptureAdapter,
  type ComputerCaptureSource,
} from "../src/main/computer-capture-session.js";

interface TestSource extends ComputerCaptureSource {
  title: string;
}

describe("persistent computer capture session", () => {
  it("starts each selected source once and keeps it alive across status checks", async () => {
    const adapter: ComputerCaptureAdapter<TestSource> = {
      start: vi.fn(async (source) => ({
        width: source.key === "safari" ? 1600 : 1200,
        height: 900,
      })),
      stopAll: vi.fn(async () => undefined),
      status: vi.fn(async () => [
        { key: "safari", active: true },
        { key: "settings", active: true },
      ]),
    };
    const session = new ComputerCaptureSession(adapter);

    await session.replace([
      { key: "safari", sourceId: "window:10:0", title: "Safari" },
      { key: "settings", sourceId: "window:11:0", title: "Settings" },
    ]);
    await expect(session.inactiveKeys()).resolves.toEqual([]);
    await expect(session.inactiveKeys()).resolves.toEqual([]);

    expect(adapter.start).toHaveBeenCalledTimes(2);
    expect(session.activeSources).toMatchObject([
      { key: "safari", width: 1600, height: 900 },
      { key: "settings", width: 1200, height: 900 },
    ]);
  });

  it("cleans up every stream when one source fails to start", async () => {
    const adapter: ComputerCaptureAdapter<TestSource> = {
      start: vi
        .fn()
        .mockResolvedValueOnce({ width: 1600, height: 900 })
        .mockRejectedValueOnce(new Error("capture denied")),
      stopAll: vi.fn(async () => undefined),
      status: vi.fn(async () => []),
    };
    const session = new ComputerCaptureSession(adapter);

    await expect(
      session.replace([
        { key: "safari", sourceId: "window:10:0", title: "Safari" },
        { key: "settings", sourceId: "window:11:0", title: "Settings" },
      ]),
    ).rejects.toThrow("capture denied");

    expect(adapter.stopAll).toHaveBeenCalledTimes(2);
    expect(session.activeSources).toEqual([]);
  });

  it("reports an ended stream without discarding healthy streams", async () => {
    const adapter: ComputerCaptureAdapter<TestSource> = {
      start: vi.fn(async () => ({ width: 1600, height: 900 })),
      stopAll: vi.fn(async () => undefined),
      status: vi.fn(async () => [
        { key: "safari", active: false },
        { key: "settings", active: true },
      ]),
    };
    const session = new ComputerCaptureSession(adapter);
    await session.replace([
      { key: "safari", sourceId: "window:10:0", title: "Safari" },
      { key: "settings", sourceId: "window:11:0", title: "Settings" },
    ]);

    await expect(session.inactiveKeys()).resolves.toEqual(["safari"]);
    expect(session.activeSources).toHaveLength(2);
  });
});
