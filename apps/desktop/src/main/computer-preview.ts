import type { ComputerFrameLayout } from "./computer-layout.js";

export const COMPUTER_PREVIEW_URL = "threadlight-computer://preview/";

export const COMPUTER_PREVIEW_WINDOW_APPEARANCE = {
  frame: false,
  transparent: true,
  hasShadow: false,
  roundedCorners: false,
  backgroundColor: "#00000000",
} as const;

const CARD_MAX_WIDTH = 368;
const CARD_MAX_HEIGHT = 248;
const STACK_MAX_X = 250;
const STACK_MAX_Y = 36;
const STACK_X_STEP = 86;
const STACK_Y_STEP = 8;
const PREVIEW_PADDING = 18;
const PINCH_SENSITIVITY = 0.004;

export const COMPUTER_PREVIEW_MIN_SCALE = 0.6;
export const COMPUTER_PREVIEW_MAX_SCALE = 1.65;

export interface ComputerPreviewSize {
  width: number;
  height: number;
}

export function computerPreviewSize(
  frame: ComputerFrameLayout,
): ComputerPreviewSize {
  if (frame.tiles.length === 0) return { width: 180, height: 120 };

  const cardSizes = frame.tiles.map((tile) => {
    const aspect = Math.max(
      0.45,
      Math.min(2.4, tile.content.width / tile.content.height),
    );
    const width = Math.min(CARD_MAX_WIDTH, CARD_MAX_HEIGHT * aspect);
    return { width, height: width / aspect };
  });
  const maximumDepth = Math.max(1, frame.tiles.length - 1);
  const stackWidth =
    (frame.tiles.length - 1) *
    Math.min(STACK_X_STEP, STACK_MAX_X / maximumDepth);
  const stackHeight =
    (frame.tiles.length - 1) *
    Math.min(STACK_Y_STEP, STACK_MAX_Y / maximumDepth);

  return {
    width: Math.ceil(
      Math.max(...cardSizes.map((size) => size.width)) +
        stackWidth +
        PREVIEW_PADDING * 2,
    ),
    height: Math.ceil(
      Math.max(...cardSizes.map((size) => size.height)) +
        stackHeight +
        PREVIEW_PADDING * 2,
    ),
  };
}

export function scaledComputerPreviewSize(
  frame: ComputerFrameLayout,
  scale: number,
): ComputerPreviewSize {
  const base = computerPreviewSize(frame);
  const safeScale = clampComputerPreviewScale(scale);
  return {
    width: Math.round(base.width * safeScale),
    height: Math.round(base.height * safeScale),
  };
}

export function nextComputerPreviewScale(
  currentScale: number,
  pinchDeltaY: number,
): number {
  if (!Number.isFinite(pinchDeltaY)) {
    return clampComputerPreviewScale(currentScale);
  }
  const boundedDelta = Math.max(-80, Math.min(80, pinchDeltaY));
  return clampComputerPreviewScale(
    currentScale * Math.exp(-boundedDelta * PINCH_SENSITIVITY),
  );
}

function clampComputerPreviewScale(scale: number): number {
  const safeScale = Number.isFinite(scale) ? scale : 1;
  return Math.max(
    COMPUTER_PREVIEW_MIN_SCALE,
    Math.min(COMPUTER_PREVIEW_MAX_SCALE, safeScale),
  );
}

export function computerPreviewHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        color: #34332f;
        background: transparent;
        --ease-out: cubic-bezier(.23, 1, .32, 1);
        --ease-in-out: cubic-bezier(.77, 0, .175, 1);
      }
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }
      #shell {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
        -webkit-app-region: no-drag;
      }
      #controls {
        position: absolute;
        z-index: 100;
        left: 12px;
        top: 12px;
        display: inline-flex;
        align-items: center;
        opacity: 0;
        pointer-events: none;
        -webkit-app-region: no-drag;
        transform: scale(.96);
        transform-origin: center;
        transition:
          opacity 140ms ease,
          transform 160ms var(--ease-out);
      }
      #shell:hover #controls,
      #controls:focus-within {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1);
      }
      #close {
        width: 28px;
        height: 28px;
        display: grid;
        padding: 0;
        place-items: center;
        border: 0;
        border-radius: 999px;
        color: rgba(255,255,255,.92);
        background: rgba(34,33,30,.58);
        box-shadow: 0 3px 10px rgba(34,33,30,.18);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        cursor: pointer;
        -webkit-app-region: no-drag;
        transition:
          color 140ms ease,
          background-color 140ms ease,
          transform 140ms var(--ease-out);
      }
      #close:active { transform: scale(.94); }
      #close:focus-visible {
        outline: 2px solid rgba(111,107,97,.42);
        outline-offset: 2px;
      }
      #close svg {
        width: 13px;
        height: 13px;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-width: 1.8;
      }
      #stage {
        position: absolute;
        inset: 0;
        overflow: hidden;
        -webkit-app-region: no-drag;
      }
      #cards {
        position: absolute;
        inset: 0;
        transform: scale(var(--preview-scale, 1));
        transform-origin: top left;
      }
      .source-card {
        position: absolute;
        overflow: hidden;
        padding: 0;
        border: 1px solid rgba(255,255,255,.86);
        border-radius: 14px;
        outline: 0;
        background: #f2f1ed;
        box-shadow:
          0 16px 42px rgba(68,64,56,.16),
          0 2px 7px rgba(68,64,56,.08),
          inset 0 0 0 1px rgba(91,87,79,.07);
        cursor: pointer;
        -webkit-app-region: no-drag;
        transform-origin: top left;
        user-select: none;
        transition:
          transform 220ms var(--ease-in-out),
          opacity 180ms ease,
          filter 180ms ease,
          box-shadow 180ms ease;
      }
      .source-card[data-front="true"] {
        cursor: default;
        -webkit-app-region: no-drag;
        box-shadow:
          0 22px 52px rgba(68,64,56,.2),
          0 3px 9px rgba(68,64,56,.1),
          inset 0 0 0 1px rgba(91,87,79,.07);
      }
      .source-card:focus-visible {
        box-shadow:
          0 0 0 3px rgba(112,108,98,.2),
          0 22px 52px rgba(68,64,56,.2);
      }
      .source-frame {
        position: relative;
        display: block;
        width: 100%;
        overflow: hidden;
        background: #f2f1ed;
      }
      .source-frame video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: fill;
        pointer-events: none;
      }
      #empty {
        position: absolute;
        inset: 0;
        display: none;
        place-items: center;
        color: rgba(52,51,47,.46);
        font-size: 11px;
        font-weight: 560;
      }
      @media (hover: hover) and (pointer: fine) {
        #close:hover {
          color: #fff;
          background: rgba(24,23,21,.76);
        }
        .source-card:not([data-front="true"]):hover {
          filter: saturate(1.04) brightness(1.015);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #controls {
          transform: none;
          transition: opacity 120ms ease;
        }
        .source-card {
          transition:
            opacity 140ms ease,
            box-shadow 140ms ease;
        }
      }
    </style>
  </head>
  <body>
    <main id="shell">
      <div id="controls">
        <button id="close" type="button" title="关闭画中画" aria-label="关闭画中画">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8"></path>
          </svg>
        </button>
      </div>
      <section id="stage">
        <div id="cards"></div>
        <div id="empty">没有正在共享的窗口</div>
      </section>
    </main>
    <script>
      const cards = document.getElementById("cards");
      const empty = document.getElementById("empty");
      const captures = new Map();
      let frontOrder = [];
      let currentLayoutKey = "";
      let pendingPinchDeltaY = 0;
      let pinchFrame = 0;
      let dragCandidate = null;
      let suppressClickUntil = 0;

      function waitForVideo(video) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for a preview frame")),
            10000
          );
          const finish = () => {
            clearTimeout(timeout);
            video.removeEventListener("loadeddata", finish);
            video.removeEventListener("error", fail);
            resolve();
          };
          const fail = () => {
            clearTimeout(timeout);
            video.removeEventListener("loadeddata", finish);
            video.removeEventListener("error", fail);
            reject(new Error("The preview video stream failed"));
          };
          video.addEventListener("loadeddata", finish, { once: true });
          video.addEventListener("error", fail, { once: true });
        });
      }

      function stopCapture(capture) {
        for (const track of capture.stream.getTracks()) track.stop();
        capture.peer.close();
        capture.video.srcObject = null;
        capture.video.remove();
      }

      function waitForIceGathering(peer) {
        if (peer.iceGatheringState === "complete") return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out connecting the preview stream"));
          }, 10000);
          const onStateChange = () => {
            if (peer.iceGatheringState !== "complete") return;
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timeout);
            peer.removeEventListener(
              "icegatheringstatechange",
              onStateChange
            );
          };
          peer.addEventListener("icegatheringstatechange", onStateChange);
        });
      }

      function cardFor(tile) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "source-card";
        card.dataset.sourceId = tile.sourceId;
        card.setAttribute("aria-label", "将共享窗口放到最前");

        const frame = document.createElement("span");
        frame.className = "source-frame";
        const aspect = Math.max(.45, Math.min(2.4, tile.content.width / tile.content.height));
        card.dataset.aspect = String(aspect);
        frame.style.aspectRatio = String(aspect);
        const capture = captures.get(tile.sourceId);
        if (!capture) {
          throw new Error("Missing live preview stream: " + tile.sourceId);
        }
        frame.append(capture.video);
        card.append(frame);
        card.addEventListener("click", (event) => {
          if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            return;
          }
          bringToFront(tile.sourceId);
        });
        return card;
      }

      function bringToFront(sourceId) {
        frontOrder = frontOrder.filter((id) => id !== sourceId);
        frontOrder.push(sourceId);
        arrangeCards();
      }

      function arrangeCards() {
        const nodes = [...cards.children];
        const maximumDepth = Math.max(0, frontOrder.length - 1);
        const depthDivisor = Math.max(1, maximumDepth);
        const xStep = Math.min(86, 250 / depthDivisor);
        const yStep = Math.min(8, 36 / depthDivisor);
        const scaleStep = Math.min(.025, .08 / depthDivisor);
        for (const node of nodes) {
          const aspect = Number(node.dataset.aspect) || 1.6;
          const width = Math.min(368, 248 * aspect);
          node.style.width = width + "px";
          const order = frontOrder.indexOf(node.dataset.sourceId);
          const depth = Math.max(0, frontOrder.length - 1 - order);
          const x = 18 + (maximumDepth - depth) * xStep;
          const y = 18 + (maximumDepth - depth) * yStep;
          const scale = 1 - depth * scaleStep;
          node.style.left = x + "px";
          node.style.top = y + "px";
          node.style.zIndex = String(order + 1);
          node.style.opacity = String(Math.max(.82, 1 - depth * .045));
          node.style.transform = "scale(" + scale + ")";
          node.dataset.front = String(depth === 0);
          node.tabIndex = 0;
        }
      }

      async function render(frame) {
        const sourceIds = frame.tiles.map((tile) => tile.sourceId);
        const layoutKey = JSON.stringify(
          frame.tiles.map((tile) => [
            tile.sourceId,
            tile.content.width,
            tile.content.height
          ])
        );
        frontOrder = frontOrder.filter((id) => sourceIds.includes(id));
        for (const id of sourceIds) {
          if (!frontOrder.includes(id)) frontOrder.push(id);
        }
        empty.style.display = frame.tiles.length ? "none" : "grid";
        if (!frame.tiles.length) {
          cards.replaceChildren();
          currentLayoutKey = layoutKey;
          return true;
        }
        if (layoutKey === currentLayoutKey) {
          arrangeCards();
          return true;
        }
        await Promise.all(
          sourceIds.map((sourceId) => {
            const capture = captures.get(sourceId);
            if (!capture) {
              throw new Error("Missing live preview stream: " + sourceId);
            }
            return waitForVideo(capture.video);
          })
        );
        cards.replaceChildren(...frame.tiles.map((tile) => cardFor(tile)));
        currentLayoutKey = layoutKey;
        arrangeCards();
        return true;
      }

      window.threadlightPreview = {
        async acceptOffer(key, offer) {
          const current = captures.get(key);
          if (current) {
            stopCapture(current);
            captures.delete(key);
          }
          const peer = new RTCPeerConnection();
          const stream = new MediaStream();
          peer.addEventListener("track", (event) => {
            if (!stream.getTracks().includes(event.track)) {
              stream.addTrack(event.track);
            }
          });
          const video = document.createElement("video");
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          captures.set(key, { peer, stream, video });
          await peer.setRemoteDescription(offer);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await waitForIceGathering(peer);
          return {
            type: peer.localDescription.type,
            sdp: peer.localDescription.sdp
          };
        },

        async waitForStream(key) {
          const capture = captures.get(key);
          if (!capture) {
            throw new Error("Missing relayed preview stream: " + key);
          }
          const video = capture.video;
          await video.play();
          await waitForVideo(video);
          return {
            width: video.videoWidth,
            height: video.videoHeight
          };
        },

        async stopAll() {
          for (const capture of captures.values()) stopCapture(capture);
          captures.clear();
          cards.replaceChildren();
          currentLayoutKey = "";
          return true;
        },

        status() {
          return [...captures.entries()].map(([key, capture]) => ({
            key,
            active:
              capture.peer.connectionState !== "failed" &&
              capture.peer.connectionState !== "closed" &&
              capture.peer.connectionState !== "disconnected" &&
              capture.stream
                .getVideoTracks()
                .some((track) => track.readyState === "live")
          }));
        },

        render
      };
      let closing = false;
      function closePreview() {
        if (closing) return;
        closing = true;
        window.threadlightComputerPreview.close();
      }
      const close = document.getElementById("close");
      close.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closePreview();
      });
      close.addEventListener("click", closePreview);
      const shell = document.getElementById("shell");
      shell.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("#controls")) return;
        const card = event.target.closest(".source-card");
        if (card && card.dataset.front !== "true") return;
        dragCandidate = {
          pointerId: event.pointerId,
          startX: event.screenX,
          startY: event.screenY,
          dragging: false
        };
        shell.setPointerCapture(event.pointerId);
      });
      shell.addEventListener("pointermove", (event) => {
        const drag = dragCandidate;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (
          !drag.dragging &&
          Math.hypot(
            event.screenX - drag.startX,
            event.screenY - drag.startY
          ) < 4
        ) {
          return;
        }
        if (!drag.dragging) {
          drag.dragging = true;
          window.threadlightComputerPreview.drag(
            "start",
            drag.startX,
            drag.startY
          );
        }
        event.preventDefault();
        window.threadlightComputerPreview.drag(
          "move",
          event.screenX,
          event.screenY
        );
      });
      function finishDrag(event) {
        const drag = dragCandidate;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.dragging) {
          suppressClickUntil = performance.now() + 250;
          window.threadlightComputerPreview.drag(
            "end",
            event.screenX,
            event.screenY
          );
        }
        if (shell.hasPointerCapture(event.pointerId)) {
          shell.releasePointerCapture(event.pointerId);
        }
        dragCandidate = null;
      }
      shell.addEventListener("pointerup", finishDrag);
      shell.addEventListener("pointercancel", finishDrag);
      window.addEventListener(
        "wheel",
        (event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          pendingPinchDeltaY += event.deltaY;
          if (pinchFrame) return;
          pinchFrame = requestAnimationFrame(() => {
            window.threadlightComputerPreview.resize(pendingPinchDeltaY);
            pendingPinchDeltaY = 0;
            pinchFrame = 0;
          });
        },
        { passive: false }
      );
    </script>
  </body>
</html>`;
}
