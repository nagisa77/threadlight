import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";

import type {
  HostFileEntry,
  HostFileListing,
  HostSystemFile,
} from "@threadlight/protocol";

const MAX_FILE_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;

export async function listHostFiles(path: string): Promise<HostFileListing> {
  const absolutePath = await resolveHostPath(path);
  const metadata = await stat(absolutePath);
  if (!metadata.isDirectory()) {
    throw new Error("Host path is not a directory.");
  }
  const entries = (
    await Promise.all(
      (await readdir(absolutePath, { withFileTypes: true })).map(
        async (entry): Promise<HostFileEntry | undefined> => {
          const entryPath = join(absolutePath, entry.name);
          if (entry.isDirectory()) {
            return {
              name: entry.name,
              path: entryPath,
              kind: "directory",
            };
          }
          if (entry.isFile()) {
            return {
              name: entry.name,
              path: entryPath,
              kind: "file",
            };
          }
          if (!entry.isSymbolicLink()) return;
          try {
            const target = await stat(entryPath);
            if (!target.isDirectory() && !target.isFile()) return;
            return {
              name: entry.name,
              path: entryPath,
              kind: target.isDirectory() ? "directory" : "file",
            };
          } catch {
            return;
          }
        },
      ),
    )
  )
    .filter((entry): entry is HostFileEntry => Boolean(entry))
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    })
    .slice(0, MAX_DIRECTORY_ENTRIES);
  const parentPath = dirname(absolutePath);
  return {
    path: absolutePath,
    ...(parentPath === absolutePath ? {} : { parentPath }),
    entries,
  };
}

export async function readHostFile(path: string): Promise<HostSystemFile> {
  const absolutePath = await resolveHostPath(path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("Host path is not a file.");
  const bytesToRead = Math.min(metadata.size, MAX_FILE_PREVIEW_BYTES + 1);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(absolutePath, "r");
  let bytesRead = 0;
  try {
    ({ bytesRead } = await file.read(buffer, 0, bytesToRead, 0));
  } finally {
    await file.close();
  }
  const content = buffer.subarray(0, bytesRead);
  const binary = content.includes(0);
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

export async function readHostFileContents(path: string): Promise<Buffer> {
  const absolutePath = await resolveHostPath(path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("Host path is not a file.");
  return readFile(absolutePath);
}

async function resolveHostPath(path: string): Promise<string> {
  const value = path.trim();
  const expanded =
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value;
  if (!expanded || !isAbsolute(expanded)) {
    throw new Error("An absolute Host path is required.");
  }
  return realpath(expanded);
}
