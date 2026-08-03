import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { installMobileViewportHeight } from "../src/mobile-viewport.js";

const appSource = readFileSync(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const uiStyles = readFileSync(
  new URL("../../../packages/ui/src/styles.css", import.meta.url),
  "utf8",
);

class TestViewport extends EventTarget {
  height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }
}

describe("mobile viewport height", () => {
  it("binds the iOS web root to the measured visual viewport", () => {
    expect(appSource).toContain("installMobileViewportHeight()");
    expect(uiStyles).toMatch(
      /html\[data-platform="web"\],\s*html\[data-platform="web"\] body,\s*html\[data-platform="web"\] #root\s*\{[^}]*height:\s*var\(--web-viewport-height, 100dvh\);/s,
    );
  });

  it("tracks visual viewport changes when the software keyboard closes", () => {
    const visualViewport = new TestViewport(420);
    const properties = new Map<string, string>();
    const root = {
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
        removeProperty(name: string) {
          const value = properties.get(name) ?? "";
          properties.delete(name);
          return value;
        },
      },
    };
    let nextFrame: FrameRequestCallback | undefined;
    const viewportWindow = Object.assign(new EventTarget(), {
      innerHeight: 720,
      visualViewport,
      requestAnimationFrame(callback: FrameRequestCallback) {
        nextFrame = callback;
        return 1;
      },
      cancelAnimationFrame() {
        nextFrame = undefined;
      },
    });

    const dispose = installMobileViewportHeight(viewportWindow, {
      documentElement: root,
    });
    expect(properties.get("--web-viewport-height")).toBe("420px");

    visualViewport.height = 720;
    visualViewport.dispatchEvent(new Event("resize"));
    nextFrame?.(0);

    expect(properties.get("--web-viewport-height")).toBe("720px");

    dispose();
    expect(properties.has("--web-viewport-height")).toBe(false);
  });

  it("falls back to the window height without Visual Viewport support", () => {
    const properties = new Map<string, string>();
    const root = {
      style: {
        setProperty(name: string, value: string) {
          properties.set(name, value);
        },
        removeProperty(name: string) {
          const value = properties.get(name) ?? "";
          properties.delete(name);
          return value;
        },
      },
    };
    const viewportWindow = Object.assign(new EventTarget(), {
      innerHeight: 640,
      visualViewport: null,
      requestAnimationFrame(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
      cancelAnimationFrame() {},
    });

    const dispose = installMobileViewportHeight(viewportWindow, {
      documentElement: root,
    });

    expect(properties.get("--web-viewport-height")).toBe("640px");
    dispose();
  });
});
