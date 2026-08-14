import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import type { HostLanguage } from "@threadlight/protocol";

import { resolveAttachmentUrlPath } from "./attachment-upload.js";
import {
  COMPUTER_CAPTURE_URL,
  computerCaptureHtml,
} from "./computer-capture.js";
import {
  COMPUTER_PREVIEW_URL,
  computerPreviewHtml,
} from "./computer-preview.js";
import type { ProjectStore } from "./project-store.js";
import type { RemoteHostConnection } from "./remote-host-connection.js";

export interface DesktopProtocolHost {
  isRemoteHost(): boolean;
  currentActiveProject(): ReturnType<ProjectStore["activeProject"]>;
  remoteHost(): RemoteHostConnection | null;
  language(): HostLanguage;
}

/** Registers custom URL protocols and owns their request validation. */
export function registerDesktopProtocols(host: DesktopProtocolHost): void {
  protocol.handle("threadlight-computer", (request) => {
    if (request.url === COMPUTER_CAPTURE_URL) {
      return new Response(computerCaptureHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (request.url === COMPUTER_PREVIEW_URL) {
      return new Response(computerPreviewHtml(host.language()), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  });

  protocol.handle("threadlight-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      const encodedPath = parts.length === 1 ? parts[0] : parts[1];
      if (url.hostname !== "local" || !encodedPath || parts.length > 2) {
        return new Response("Not found", { status: 404 });
      }
      if (host.isRemoteHost()) {
        const attachmentId = parts.length === 2 ? parts[0] : undefined;
        const project = host.currentActiveProject();
        const connection = host.remoteHost();
        if (!attachmentId || !project || !connection) {
          return new Response("Not found", { status: 404 });
        }
        const mimeType = url.searchParams.get("mimeType");
        return new Response(
          await connection.downloadAttachment(project.id, attachmentId),
          {
            headers: {
              "Content-Type":
                mimeType && !/[\r\n]/.test(mimeType)
                  ? mimeType
                  : "application/octet-stream",
              "Cache-Control": "private, max-age=3600",
            },
          },
        );
      }
      return net.fetch(
        pathToFileURL(resolveAttachmentUrlPath(encodedPath)).href,
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
