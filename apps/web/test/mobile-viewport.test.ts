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

function createTestDocument(properties: Map<string, string>) {
  return Object.assign(new EventTarget(), {
    documentElement: {
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
    },
  });
}

describe("mobile viewport height", () => {
  it("binds the iOS web root to the measured visual viewport", () => {
    expect(appSource).toContain("installMobileViewportHeight()");
    expect(uiStyles).toMatch(
      /html\[data-platform="web"\],\s*html\[data-platform="web"\] body,\s*html\[data-platform="web"\] #root\s*\{[^}]*height:\s*var\(--web-viewport-height, 100dvh\);/s,
    );
    expect(uiStyles).toMatch(
      /html\[data-platform="web"\] body\s*\{[^}]*position:\s*fixed;[^}]*top:\s*0;[^}]*left:\s*0;[^}]*width:\s*100%;/s,
    );
  });

  it("tracks visual viewport changes when the software keyboard closes", () => {
    const visualViewport = new TestViewport(420);
    const properties = new Map<string, string>();
    const viewportDocument = createTestDocument(properties);
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
      setTimeout,
      clearTimeout,
      scrollTo() {},
    });

    const dispose = installMobileViewportHeight(
      viewportWindow,
      viewportDocument,
    );
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
    const viewportDocument = createTestDocument(properties);
    const viewportWindow = Object.assign(new EventTarget(), {
      innerHeight: 640,
      visualViewport: null,
      requestAnimationFrame(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout,
      clearTimeout,
      scrollTo() {},
    });

    const dispose = installMobileViewportHeight(
      viewportWindow,
      viewportDocument,
    );

    expect(properties.get("--web-viewport-height")).toBe("640px");
    dispose();
  });

  it("remeasures and clears Safari's root scroll offset after input blur", () => {
    const visualViewport = new TestViewport(420);
    const properties = new Map<string, string>();
    const viewportDocument = createTestDocument(properties);
    const timers: Array<() => void> = [];
    const scrollPositions: Array<[number, number]> = [];
    const viewportWindow = Object.assign(new EventTarget(), {
      innerHeight: 720,
      visualViewport,
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout(callback: () => void) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {},
      scrollTo(x: number, y: number) {
        scrollPositions.push([x, y]);
      },
    });

    const dispose = installMobileViewportHeight(
      viewportWindow,
      viewportDocument,
    );
    visualViewport.height = 720;
    viewportDocument.dispatchEvent(new Event("focusout"));
    for (const callback of timers) callback();

    expect(properties.get("--web-viewport-height")).toBe("720px");
    expect(scrollPositions).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    dispose();
  });

  it("keeps Safari from panning the app shell while the keyboard opens", () => {
    const visualViewport = new TestViewport(720);
    const properties = new Map<string, string>();
    const viewportDocument = createTestDocument(properties);
    const timers: Array<() => void> = [];
    const scrollPositions: Array<[number, number]> = [];
    const viewportWindow = Object.assign(new EventTarget(), {
      innerHeight: 720,
      visualViewport,
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout(callback: () => void) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {},
      scrollTo(x: number, y: number) {
        scrollPositions.push([x, y]);
      },
    });

    const dispose = installMobileViewportHeight(
      viewportWindow,
      viewportDocument,
    );
    visualViewport.height = 420;
    viewportDocument.dispatchEvent(new Event("focusin"));
    for (const callback of timers) callback();

    expect(properties.get("--web-viewport-height")).toBe("420px");
    expect(scrollPositions).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    dispose();
  });
});
