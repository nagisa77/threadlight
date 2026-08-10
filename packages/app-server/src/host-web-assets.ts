import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export class HostWebAssets {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async ensure(): Promise<void> {
    const indexPath = resolve(this.root, "index.html");
    const metadata = await stat(indexPath).catch(() => undefined);
    if (!metadata?.isFile()) {
      throw new Error(
        `Threadlight Web index was not found at ${indexPath}. Build the Web client or choose another --web-root.`,
      );
    }
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
      return false;
    }

    let relativePath: string;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      this.writeNotFound(response);
      return true;
    }
    if (!relativePath || relativePath.endsWith("/")) {
      relativePath += "index.html";
    }

    let assetPath = this.safePath(relativePath);
    let content = assetPath ? await readAsset(assetPath) : undefined;
    if (!content && !extname(relativePath)) {
      assetPath = resolve(this.root, "index.html");
      content = await readAsset(assetPath);
    }
    if (!content || !assetPath) {
      this.writeNotFound(response);
      return true;
    }

    const isIndex = assetPath === resolve(this.root, "index.html");
    response.writeHead(200, {
      "Content-Type": contentType(assetPath),
      "Content-Length": String(content.byteLength),
      "Cache-Control": isIndex
        ? "no-cache"
        : relativePath.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    response.end(request.method === "HEAD" ? undefined : content);
    return true;
  }

  private safePath(relativePath: string): string | undefined {
    if (relativePath.includes("\0")) return undefined;
    const path = resolve(this.root, relativePath);
    return path === this.root || path.startsWith(`${this.root}${sep}`)
      ? path
      : undefined;
  }

  private writeNotFound(response: ServerResponse): void {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end("Not found\n");
  }
}

async function readAsset(path: string): Promise<Buffer | undefined> {
  const metadata = await stat(path).catch(() => undefined);
  if (!metadata?.isFile()) return undefined;
  return readFile(path);
}

function contentType(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}
