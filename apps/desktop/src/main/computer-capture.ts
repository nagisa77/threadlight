export const COMPUTER_CAPTURE_URL = "threadlight-computer://capture/";

export function computerCaptureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: dark;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        background: #171815;
      }
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #171815;
      }
      #canvas {
        position: relative;
        width: 1440px;
        height: 900px;
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
        z-index: 2;
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
      video {
        position: absolute;
        display: block;
        object-fit: fill;
        background: #090a09;
        pointer-events: none;
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
    </style>
  </head>
  <body>
    <main id="canvas"></main>
    <script>
      const canvas = document.getElementById("canvas");
      const captures = new Map();

      function waitForVideo(video) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for a shared frame")),
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
            reject(new Error("The shared video stream failed"));
          };
          video.addEventListener("loadeddata", finish, { once: true });
          video.addEventListener("error", fail, { once: true });
        });
      }

      function stopCapture(capture) {
        for (const track of capture.stream.getTracks()) track.stop();
        capture.video.srcObject = null;
        capture.video.remove();
      }

      window.threadlightCapture = {
        async start(key) {
          const current = captures.get(key);
          if (
            current &&
            current.stream.getVideoTracks().some(
              (track) => track.readyState === "live"
            )
          ) {
            return {
              width: current.video.videoWidth,
              height: current.video.videoHeight
            };
          }
          if (current) {
            stopCapture(current);
            captures.delete(key);
          }

          const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: false,
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1200 },
              frameRate: { ideal: 15, max: 30 }
            }
          });
          const video = document.createElement("video");
          video.autoplay = true;
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          await video.play();
          await waitForVideo(video);
          captures.set(key, { stream, video });
          return {
            width: video.videoWidth,
            height: video.videoHeight
          };
        },

        async stopAll() {
          for (const capture of captures.values()) stopCapture(capture);
          captures.clear();
          canvas.replaceChildren();
          return true;
        },

        status() {
          return [...captures.entries()].map(([key, capture]) => ({
            key,
            active: capture.stream
              .getVideoTracks()
              .some((track) => track.readyState === "live")
          }));
        },

        async render(frame, cursor) {
          canvas.style.width = frame.width + "px";
          canvas.style.height = frame.height + "px";
          canvas.replaceChildren();
          const videos = [];

          for (const tile of frame.tiles) {
            const capture = captures.get(tile.sourceId);
            if (!capture) {
              throw new Error("Missing live capture stream: " + tile.sourceId);
            }
            const tileNode = document.createElement("section");
            tileNode.className = "tile";
            Object.assign(tileNode.style, {
              left: tile.tile.x + "px",
              top: tile.tile.y + "px",
              width: tile.tile.width + "px",
              height: tile.tile.height + "px"
            });

            const label = document.createElement("div");
            label.className = "label";
            const app = document.createElement("span");
            app.className = "label-app";
            app.textContent = tile.applicationName;
            const windowName = document.createElement("span");
            windowName.className = "label-window";
            windowName.textContent =
              tile.name === tile.applicationName ? "" : tile.name;
            label.append(app, windowName);

            const video = capture.video;
            Object.assign(video.style, {
              left: tile.content.x - tile.tile.x + "px",
              top: tile.content.y - tile.tile.y + "px",
              width: tile.content.width + "px",
              height: tile.content.height + "px"
            });
            tileNode.append(label, video);
            canvas.append(tileNode);
            videos.push(waitForVideo(video));
          }

          const cursorNode = document.createElement("div");
          cursorNode.id = "cursor";
          if (cursor) {
            cursorNode.style.display = "block";
            cursorNode.style.left = cursor.x + "px";
            cursorNode.style.top = cursor.y + "px";
          }
          canvas.append(cursorNode);
          await Promise.all(videos);
          await new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve())
            )
          );
          return true;
        },

        async sync() {
          await new Promise((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve())
            )
          );
          return true;
        }
      };
    </script>
  </body>
</html>`;
}
