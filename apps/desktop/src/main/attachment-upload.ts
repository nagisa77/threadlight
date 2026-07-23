import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";

import type { AttachmentData } from "@threadlight/protocol";
import type { DesktopAttachmentReferenceRequest } from "../shared/desktop-api.js";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function createAttachmentReference(
  request: DesktopAttachmentReferenceRequest,
): AttachmentData {
  validateAttachmentReference(request);
  const stats = statSync(request.path);
  if (!stats.isFile()) {
    throw new Error("附件必须是本地文件。");
  }
  if (stats.size !== request.size) {
    throw new Error("附件大小已变化，请重新选择文件。");
  }

  const mimeType = request.mimeType || "application/octet-stream";
  const path = request.path;
  return {
    id: randomUUID(),
    name: basename(request.name) || basename(path),
    mimeType,
    size: stats.size,
    kind: mimeType.startsWith("image/") ? "image" : "file",
    path,
  };
}

export function resolveAttachmentUrlPath(encodedPath: string): string {
  if (!/^[a-z0-9_-]+$/i.test(encodedPath)) {
    throw new Error("Invalid attachment path");
  }
  const path = Buffer.from(encodedPath, "base64url").toString("utf8");
  if (!isAbsolute(path)) {
    throw new Error("Invalid attachment path");
  }
  return path;
}

function validateAttachmentReference(
  request: DesktopAttachmentReferenceRequest,
): void {
  if (!request || typeof request !== "object") {
    throw new Error("Invalid attachment reference");
  }
  if (typeof request.name !== "string" || !basename(request.name).trim()) {
    throw new Error("Attachment name is required");
  }
  if (typeof request.mimeType !== "string") {
    throw new Error("Attachment MIME type must be a string");
  }
  if (typeof request.path !== "string" || !isAbsolute(request.path)) {
    throw new Error("附件必须来自本地文件路径。");
  }
  if (
    !Number.isSafeInteger(request.size) ||
    request.size <= 0 ||
    request.size > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error("附件必须小于 50 MB 且不能为空。");
  }
}
