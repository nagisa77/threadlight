import type { ComputerFrameLayout } from "./computer-layout.js";

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

export function computerPreviewHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
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
        -webkit-app-region: drag;
      }
      #controls {
        position: absolute;
        z-index: 100;
        left: 10px;
        top: 8px;
        display: inline-flex;
        align-items: center;
        padding: 6px;
        border: 1px solid rgba(255,255,255,.68);
        border-radius: 12px;
        opacity: 0;
        background: rgba(239,238,233,.7);
        box-shadow:
          0 12px 30px rgba(62,59,52,.2),
          0 2px 8px rgba(62,59,52,.1),
          inset 0 0 0 1px rgba(93,89,81,.06);
        backdrop-filter: blur(18px) saturate(1.15);
        -webkit-backdrop-filter: blur(18px) saturate(1.15);
        pointer-events: none;
        -webkit-app-region: no-drag;
        transform: translateY(4px) scale(.96);
        transform-origin: top left;
        transition:
          opacity 160ms ease,
          transform 180ms var(--ease-out);
      }
      #shell:hover #controls,
      #controls:focus-within {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }
      #close {
        width: 29px;
        height: 29px;
        display: grid;
        padding: 0;
        place-items: center;
        border: 0;
        border-radius: 8px;
        color: rgba(48,47,43,.72);
        background: rgba(255,255,255,.38);
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
        -webkit-app-region: drag;
      }
      #cards {
        position: absolute;
        inset: 0;
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
        cursor: grab;
        -webkit-app-region: drag;
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
      #cards[data-refreshing="true"] .source-card {
        transition: none;
      }
      .source-frame {
        position: relative;
        display: block;
        width: 100%;
        overflow: hidden;
        background: #f2f1ed;
      }
      .source-frame canvas {
        display: block;
        width: 100%;
        height: 100%;
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
          color: rgba(36,35,32,.92);
          background: rgba(255,255,255,.7);
        }
        .source-card:not([data-front="true"]):hover {
          filter: saturate(1.04) brightness(1.015);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #controls {
          transform: none;
          transition: opacity 140ms ease;
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
      const stage = document.getElementById("stage");
      const empty = document.getElementById("empty");
      let frontOrder = [];
      let currentFrame = { width: 1440, height: 900, tiles: [] };
      let currentImageUrl = "";

      function cardFor(tile, image) {
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
        const canvas = document.createElement("canvas");
        const pixelWidth = Math.max(1, Math.round(tile.content.width));
        const pixelHeight = Math.max(1, Math.round(tile.content.height));
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.getContext("2d").drawImage(
          image,
          tile.content.x,
          tile.content.y,
          tile.content.width,
          tile.content.height,
          0,
          0,
          pixelWidth,
          pixelHeight
        );
        frame.append(canvas);
        card.append(frame);
        card.addEventListener("click", () => bringToFront(tile.sourceId));
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

      async function render(imageUrl, frame) {
        currentImageUrl = imageUrl;
        currentFrame = frame;
        const sourceIds = frame.tiles.map((tile) => tile.sourceId);
        frontOrder = frontOrder.filter((id) => sourceIds.includes(id));
        for (const id of sourceIds) {
          if (!frontOrder.includes(id)) frontOrder.push(id);
        }
        empty.style.display = frame.tiles.length ? "none" : "grid";
        if (!frame.tiles.length) {
          cards.replaceChildren();
          return true;
        }

        const image = new Image();
        const loaded = new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        });
        image.src = imageUrl;
        await loaded;
        if (imageUrl !== currentImageUrl || frame !== currentFrame) return false;
        cards.dataset.refreshing = "true";
        cards.replaceChildren(...frame.tiles.map((tile) => cardFor(tile, image)));
        arrangeCards();
        requestAnimationFrame(() => {
          delete cards.dataset.refreshing;
        });
        return true;
      }

      window.threadlightRenderStack = render;
      document.getElementById("close").addEventListener("click", () => window.close());
    </script>
  </body>
</html>`;
}
