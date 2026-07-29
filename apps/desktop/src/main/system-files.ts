import { open, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

import {
  isBinaryFileContent,
  MAX_FILE_PREVIEW_BYTES,
} from "./file-preview.js";

export interface SystemFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export async function readSystemFile(path: string): Promise<SystemFile> {
  const absolutePath = await resolveSystemFilePath(path);
  const metadata = await stat(absolutePath);
  const bytesToRead = Math.min(
    metadata.size,
    MAX_FILE_PREVIEW_BYTES + 1,
  );
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(absolutePath, "r");
  let bytesRead = 0;
  try {
    ({ bytesRead } = await file.read(buffer, 0, bytesToRead, 0));
  } finally {
    await file.close();
  }
  const content = buffer.subarray(0, bytesRead);
  const binary = isBinaryFileContent(content);
  return {
    path: absolutePath,
    name: basename(absolutePath),
    binary,
    size: metadata.size,
    ...(!binary && metadata.size <= MAX_FILE_PREVIEW_BYTES
      ? { content: content.toString("utf8") }
      : {}),
  };
}

export async function resolveSystemFilePath(path: string): Promise<string> {
  if (!path || !isAbsolute(path)) {
    throw new Error("System file path must be absolute");
  }
  const absolutePath = await realpath(path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("System path is not a file");
  return absolutePath;
}
