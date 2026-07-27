import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computerCaptureHtml } from "../src/main/computer-capture.js";
import {
  COMPUTER_PREVIEW_MAX_SCALE,
  COMPUTER_PREVIEW_MIN_SCALE,
  COMPUTER_PREVIEW_WINDOW_APPEARANCE,
  computerPreviewHtml,
  computerPreviewSize,
  nextComputerPreviewScale,
  scaledComputerPreviewSize,
} from "../src/main/computer-preview.js";

describe("computer share picture in picture", () => {
  it("keeps the native preview window fully transparent", () => {
    expect(COMPUTER_PREVIEW_WINDOW_APPEARANCE).toEqual({
      frame: false,
      transparent: true,
      hasShadow: false,
      roundedCorners: false,
      backgroundColor: "#00000000",
    });
  });

  it("renders the live shared stream in a frameless stack", () => {
    const html = computerPreviewHtml();

    expect(html).toContain('id="cards"');
    expect(html).toContain("window.threadlightPreview");
    expect(html).toContain("new RTCPeerConnection()");
    expect(html).toContain("async acceptOffer(key, offer)");
    expect(html).toContain("async waitForStream(key)");
    expect(html).toContain("video.srcObject = stream");
    expect(html).toContain("frame.append(capture.video)");
    expect(html).toContain("bringToFront");
    expect(html).toContain('aria-label="关闭画中画"');
    expect(html).toContain("window.threadlightComputerPreview.close()");
    expect(html.match(/id="close"/g)).toHaveLength(1);
    expect(html).toContain("#shell:hover #controls");
    expect(html).toContain("border: 0");
    expect(html).toContain("color-scheme: light");
    expect(html).not.toContain("Computer Use");
    expect(html).not.toContain('id="count"');
    expect(html).not.toContain("app-name");
    expect(html).not.toContain("card-title");
    expect(html).not.toContain("color-scheme: dark");
    expect(html).not.toContain("#111210");
    expect(html).not.toContain("image.toDataURL");
    expect(html).not.toContain("drawImage");
    expect(html).not.toContain("navigator.mediaDevices.getDisplayMedia");
  });

  it("handles trackpad pinch scaling within explicit limits", () => {
    const html = computerPreviewHtml();

    expect(html).toContain('"wheel"');
    expect(html).toContain("event.ctrlKey");
    expect(html).toContain("event.preventDefault()");
    expect(html).toContain(
      "window.threadlightComputerPreview.resize(pendingPinchDeltaY)",
    );
    expect(html).toContain("transform: scale(var(--preview-scale, 1))");
    expect(
      nextComputerPreviewScale(
        COMPUTER_PREVIEW_MAX_SCALE,
        -1_000,
      ),
    ).toBe(COMPUTER_PREVIEW_MAX_SCALE);
    expect(
      nextComputerPreviewScale(
        COMPUTER_PREVIEW_MIN_SCALE,
        1_000,
      ),
    ).toBe(COMPUTER_PREVIEW_MIN_SCALE);
  });

  it("does not enumerate applications or run a periodic loop while sharing", () => {
    const service = readFileSync(
      new URL("../src/main/computer-service.ts", import.meta.url),
      "utf8",
    );
    const ensureCaptureStreams = service.slice(
      service.indexOf("private async ensureCaptureStreams"),
      service.indexOf("private resolveSelectedRecords"),
    );

    expect(ensureCaptureStreams).not.toContain("loadCatalog");
    expect(ensureCaptureStreams).not.toContain("resolveSelectedRecords");
    expect(service).not.toContain("setInterval(");
    expect(service).not.toContain("startPreviewHealthChecks");
  });

  it("relays the existing capture stream instead of capturing each source twice", () => {
    const captureHtml = computerCaptureHtml();

    expect(captureHtml).toContain("async createPreviewOffer(key)");
    expect(captureHtml).toContain(
      "peer.addTrack(track, capture.stream)",
    );
    expect(captureHtml).toContain("async acceptPreviewAnswer(key, answer)");
    expect(captureHtml).toContain("stopPreviewRelays()");
  });

  it("fans windows far enough apart to expose the back card", () => {
    const html = computerPreviewHtml();

    expect(html).toContain("Math.min(86, 250 / depthDivisor)");
    expect(html).toContain("bringToFront(tile.sourceId)");
  });

  it("sizes the native window from the shared content instead of a fixed width", () => {
    const landscape = computerPreviewSize({
      width: 1440,
      height: 900,
      tiles: [
        {
          sourceId: "window:1",
          name: "Landscape",
          applicationName: "Test",
          tile: { x: 0, y: 0, width: 400, height: 300 },
          content: { x: 0, y: 0, width: 400, height: 200 },
          sourceBounds: { x: 0, y: 0, width: 400, height: 200 },
        },
      ],
    });
    const portrait = computerPreviewSize({
      width: 1440,
      height: 900,
      tiles: [
        {
          sourceId: "window:2",
          name: "Portrait",
          applicationName: "Test",
          tile: { x: 0, y: 0, width: 300, height: 500 },
          content: { x: 0, y: 0, width: 200, height: 400 },
          sourceBounds: { x: 0, y: 0, width: 200, height: 400 },
        },
      ],
    });

    expect(landscape).toEqual({ width: 404, height: 220 });
    expect(portrait).toEqual({ width: 160, height: 284 });
    expect(scaledComputerPreviewSize(
      {
        width: 1440,
        height: 900,
        tiles: [
          {
            sourceId: "window:1",
            name: "Landscape",
            applicationName: "Test",
            tile: { x: 0, y: 0, width: 400, height: 300 },
            content: { x: 0, y: 0, width: 400, height: 200 },
            sourceBounds: { x: 0, y: 0, width: 400, height: 200 },
          },
        ],
      },
      1.5,
    )).toEqual({ width: 606, height: 330 });
  });

  it("drags the preview manually without blocking interactive content", () => {
    const html = computerPreviewHtml();

    expect(html).toContain('.source-card[data-front="true"]');
    expect(html).toContain('shell.addEventListener("pointerdown"');
    expect(html).toContain('shell.addEventListener("pointermove"');
    expect(html).toContain('window.threadlightComputerPreview.drag(');
    expect(html).toContain("shell.setPointerCapture(event.pointerId)");
    expect(html).toContain("Math.hypot(");
    expect(html).not.toContain("-webkit-app-region: drag");
    expect(html).toContain("-webkit-app-region: no-drag");
    expect(html).toContain("left: 12px");
  });
});
