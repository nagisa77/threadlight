import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface RemoteWorkspaceEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface RemoteWorkspaceFile {
  path: string;
  content: string;
  binary: boolean;
  size: number;
}

export interface RemoteWorkspaceChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  binary: boolean;
  oldText?: string;
  newText?: string;
}

export interface RemoteWorkspaceChanges {
  revision: string;
  files: RemoteWorkspaceChangedFile[];
}

export class RemoteWorkspace {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async list(path = ""): Promise<RemoteWorkspaceEntry[]> {
    const absolute = this.resolvePath(path);
    const entries = await readdir(absolute, { withFileTypes: true });
    return entries
      .filter((entry) => entry.name !== ".git")
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry): RemoteWorkspaceEntry => {
        const childPath = relative(
          this.root,
          resolve(absolute, entry.name),
        ).split(sep).join("/");
        return {
          name: entry.name,
          path: childPath,
          kind: entry.isDirectory() ? "directory" : "file",
        };
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
  }

  async file(path: string): Promise<RemoteWorkspaceFile> {
    if (!path) throw new Error("A workspace file path is required.");
    const absolute = this.resolvePath(path);
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error("Workspace path is not a file.");
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error("Workspace file exceeds the 2 MB review limit.");
    }
    const contents = await readFile(absolute);
    const binary = contents.includes(0);
    return {
      path: relative(this.root, absolute).split(sep).join("/"),
      content: binary ? "" : contents.toString("utf8"),
      binary,
      size: stat.size,
    };
  }

  async changes(): Promise<RemoteWorkspaceChanges> {
    const status = await this.git([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
    const records = status.split("\0").filter(Boolean);
    const files: RemoteWorkspaceChangedFile[] = [];

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      const code = record.slice(0, 2);
      let path = record.slice(3);
      let oldPath: string | undefined;
      if (code.includes("R")) {
        oldPath = records[++index] ?? path;
      }
      files.push(await this.changedFile(path, code, oldPath));
    }

    files.sort((left, right) => left.path.localeCompare(right.path));
    return {
      revision: createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex")
        .slice(0, 16),
      files,
    };
  }

  private async changedFile(
    path: string,
    code: string,
    oldPath?: string,
  ): Promise<RemoteWorkspaceChangedFile> {
    const untracked = code === "??";
    const deleted = code.includes("D");
    const added = untracked || code.includes("A");
    const renamed = code.includes("R");
    const oldBuffer =
      added
        ? undefined
        : await this.gitBuffer(["show", `HEAD:${oldPath ?? path}`]).catch(
            () => undefined,
          );
    const newBuffer =
      deleted
        ? undefined
        : await readFile(this.resolvePath(path)).catch(() => undefined);
    const binary =
      Boolean(oldBuffer?.includes(0)) || Boolean(newBuffer?.includes(0));
    const oldText = binary ? undefined : oldBuffer?.toString("utf8");
    const newText = binary ? undefined : newBuffer?.toString("utf8");
    const counts = lineCounts(oldText ?? "", newText ?? "");

    return {
      path,
      status: renamed
        ? "renamed"
        : untracked
          ? "untracked"
          : deleted
            ? "deleted"
            : added
              ? "added"
              : "modified",
      additions: counts.additions,
      deletions: counts.deletions,
      binary,
      ...(oldText !== undefined ? { oldText } : {}),
      ...(newText !== undefined ? { newText } : {}),
    };
  }

  private resolvePath(path: string): string {
    const absolute = resolve(this.root, path);
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${sep}`)) {
      throw new Error("Workspace path escapes the runtime root.");
    }
    return absolute;
  }

  private async git(args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return result.stdout;
  }

  private async gitBuffer(args: string[]): Promise<Buffer> {
    const result = await execFileAsync("git", args, {
      cwd: this.root,
      encoding: "buffer",
      maxBuffer: MAX_FILE_BYTES,
    });
    return result.stdout;
  }
}

function lineCounts(
  oldText: string,
  newText: string,
): { additions: number; deletions: number } {
  if (oldText === newText) return { additions: 0, deletions: 0 };
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];
  const common = new Set(oldLines);
  const reverse = new Set(newLines);
  return {
    additions: newLines.filter((line) => !common.has(line)).length,
    deletions: oldLines.filter((line) => !reverse.has(line)).length,
  };
}
