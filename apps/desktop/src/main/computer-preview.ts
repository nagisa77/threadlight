export function computerPreviewHtml(preview: boolean): string {
  const bodyClass = preview ? "preview" : "composer";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        background: #111210;
      }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        background:
          radial-gradient(circle at 50% 0%, rgba(255,255,255,.055), transparent 44%),
          #111210;
      }
      body.preview { padding-top: 34px; }
      #preview-bar {
        position: fixed;
        z-index: 30;
        inset: 0 0 auto 0;
        height: 34px;
        display: none;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px 0 74px;
        color: rgba(255,255,255,.72);
        background: rgba(17,18,16,.92);
        border-bottom: 1px solid rgba(255,255,255,.08);
        font-size: 11px;
        font-weight: 520;
        letter-spacing: -.005em;
        -webkit-app-region: drag;
      }
      body.preview #preview-bar { display: flex; }
      .preview-title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: rgba(255,255,255,.88);
      }
      .preview-live {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #74a37c;
        box-shadow: 0 0 0 3px rgba(116,163,124,.12);
      }
      #preview-count { color: rgba(255,255,255,.45); }
      #stage {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      #canvas {
        position: absolute;
        left: 50%;
        top: 50%;
        transform-origin: 50% 50%;
        background: #171815;
        overflow: hidden;
      }
      .tile {
        position: absolute;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 10px;
        background: #090a09;
        box-shadow: 0 12px 34px rgba(0,0,0,.28);
      }
      .label {
        position: absolute;
        inset: 0 0 auto 0;
        height: 30px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        gap: 7px;
        overflow: hidden;
        color: rgba(255,255,255,.9);
        background: #23241f;
        border-bottom: 1px solid rgba(255,255,255,.1);
        font-size: 12px;
        font-weight: 590;
        letter-spacing: -.01em;
        white-space: nowrap;
      }
      .label-app { flex: none; }
      .label-window {
        min-width: 0;
        overflow: hidden;
        color: rgba(255,255,255,.52);
        font-weight: 450;
        text-overflow: ellipsis;
      }
      .source {
        position: absolute;
        object-fit: fill;
        user-select: none;
        -webkit-user-drag: none;
      }
      .composite {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        object-fit: fill;
        user-select: none;
        -webkit-user-drag: none;
      }
      #empty {
        position: absolute;
        inset: 0;
        display: none;
        place-items: center;
        color: rgba(255,255,255,.55);
        font-size: 18px;
      }
      #cursor {
        position: absolute;
        z-index: 20;
        width: 18px;
        height: 24px;
        display: none;
        pointer-events: none;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.7));
      }
      #cursor::before {
        content: "";
        position: absolute;
        inset: 0;
        background: white;
        clip-path: polygon(0 0, 0 85%, 25% 65%, 40% 100%, 55% 93%, 40% 60%, 72% 60%);
      }
      #cursor::after {
        content: "";
        position: absolute;
        inset: 2px;
        background: #171815;
        clip-path: polygon(0 0, 0 75%, 23% 57%, 40% 89%, 47% 85%, 32% 53%, 61% 53%);
      }
      body.preview .tile {
        border-radius: 8px;
        box-shadow: none;
      }
      @media (prefers-reduced-motion: no-preference) {
        #cursor { transition: left 80ms linear, top 80ms linear; }
      }
    </style>
  </head>
  <body class="${bodyClass}">
    <div id="preview-bar">
      <span class="preview-title">
        <span class="preview-live"></span>
        Computer Use
      </span>
      <span id="preview-count"></span>
    </div>
    <div id="stage">
      <div id="canvas"></div>
      <div id="empty">No shared content</div>
    </div>
    <script>
      const canvas = document.getElementById("canvas");
      const empty = document.getElementById("empty");
      let currentFrame = { width: 1440, height: 900, tiles: [] };
      let currentCursor = null;

      function positionCanvas() {
        const stage = document.getElementById("stage");
        const scale = Math.min(
          stage.clientWidth / currentFrame.width,
          stage.clientHeight / currentFrame.height
        );
        canvas.style.width = currentFrame.width + "px";
        canvas.style.height = currentFrame.height + "px";
        canvas.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
      }

      function element(tag, className) {
        const node = document.createElement(tag);
        node.className = className;
        return node;
      }

      function updateCount(count) {
        document.getElementById("preview-count").textContent =
          count === 1 ? "1 shared source" : count + " shared sources";
      }

      window.threadlightRender = async (frame, cursor) => {
        currentFrame = frame;
        currentCursor = cursor;
        updateCount(frame.tiles.length);
        canvas.replaceChildren();
        empty.style.display = frame.tiles.length ? "none" : "grid";
        const imageLoads = [];

        for (const tile of frame.tiles) {
          const tileNode = element("section", "tile");
          Object.assign(tileNode.style, {
            left: tile.tile.x + "px",
            top: tile.tile.y + "px",
            width: tile.tile.width + "px",
            height: tile.tile.height + "px"
          });
          const label = element("div", "label");
          const app = element("span", "label-app");
          app.textContent = tile.applicationName;
          const windowName = element("span", "label-window");
          windowName.textContent =
            tile.name === tile.applicationName ? "" : tile.name;
          label.append(app, windowName);

          const image = element("img", "source");
          image.alt = "";
          Object.assign(image.style, {
            left: tile.content.x - tile.tile.x + "px",
            top: tile.content.y - tile.tile.y + "px",
            width: tile.content.width + "px",
            height: tile.content.height + "px"
          });
          imageLoads.push(
            new Promise((resolve) => {
              image.onload = resolve;
              image.onerror = resolve;
            })
          );
          image.src = tile.imageUrl;
          tileNode.append(label, image);
          canvas.append(tileNode);
        }

        const cursorNode = element("div", "");
        cursorNode.id = "cursor";
        if (cursor) {
          cursorNode.style.display = "block";
          cursorNode.style.left = cursor.x + "px";
          cursorNode.style.top = cursor.y + "px";
        }
        canvas.append(cursorNode);
        positionCanvas();
        await Promise.all(imageLoads);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return true;
      };

      window.threadlightRenderComposite = async (imageUrl, count) => {
        currentFrame = { width: 1440, height: 900, tiles: [] };
        currentCursor = null;
        updateCount(count);
        empty.style.display = "none";
        canvas.replaceChildren();
        const image = element("img", "composite");
        image.alt = "";
        const loaded = new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        });
        image.src = imageUrl;
        canvas.append(image);
        positionCanvas();
        await loaded;
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return true;
      };

      addEventListener("resize", positionCanvas);
      positionCanvas();
    </script>
  </body>
</html>`;
}
