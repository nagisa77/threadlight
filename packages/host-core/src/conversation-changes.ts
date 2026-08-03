import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { diffLines } from "diff";
import ignore from "ignore";

import {
  isBinaryFileContent,
  MAX_FILE_PREVIEW_BYTES,
} from "./file-preview.js";
import {
  workspaceEphemeralMatcher,
  workspaceSensitiveMatcher,
} from "./workspace-state-policy.js";

const SNAPSHOT_VERSION = 1;
const execFileAsync = promisify(execFile);

interface SnapshotEntry {
  path: string;
  hash: string;
  size: number;
  mode?: number;
  binary: boolean;
  reviewable: boolean;
  localOnly?: boolean;
}

interface SnapshotManifest {
  version: number;
  projectId: string;
  threadId: string;
  createdAt: string;
  entries: readonly SnapshotEntry[];
}

export interface ConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  localOnly?: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface ConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly ConversationFileChange[];
}

export interface ConversationDeliveryFile {
  path: string;
  status: ConversationFileChange["status"];
  binary: boolean;
  localOnly?: boolean;
  baselineContent?: Buffer;
  taskContent?: Buffer;
  taskMode?: number;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface WorkspaceFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export class ConversationRestoreConflictError extends Error {
  constructor() {
    super(
      "The workspace changed after this Diff was loaded. Refresh the changes before restoring.",
    );
    this.name = "ConversationRestoreConflictError";
  }
}

export class ConversationChangeTracker {
  private readonly captures = new Map<string, Promise<void>>();

  constructor(private readonly snapshotRoot: string) {}

  async beginPendingSnapshot(
    projectId: string,
    requestId: string,
    workspacePath: string,
  ): Promise<void> {
    const target = this.pendingPath(projectId, requestId);
    await this.capture(target, projectId, `pending:${requestId}`, workspacePath);
  }

  async commitPendingSnapshot(
    projectId: string,
    requestId: string,
    threadId: string,
  ): Promise<void> {
    const pending = this.pendingPath(projectId, requestId);
    const target = this.threadPath(projectId, threadId);
    try {
      await stat(target);
      await rm(pending, { recursive: true, force: true });
      return;
    } catch {
      // The task does not have a committed baseline yet.
    }
    await mkdir(dirname(target), { recursive: true });
    await rewriteManifestThreadId(pending, threadId);
    await rename(pending, target);
  }

  async discardPendingSnapshot(
    projectId: string,
    requestId: string,
  ): Promise<void> {
    await rm(this.pendingPath(projectId, requestId), {
      recursive: true,
      force: true,
    });
  }

  async ensureSnapshot(
    projectId: string,
    threadId: string,
    workspacePath: string,
  ): Promise<void> {
    const target = this.threadPath(projectId, threadId);
    try {
      await stat(join(target, "manifest.json"));
      return;
    } catch {
      const pending = this.captures.get(target);
      if (pending) {
        await pending;
        return;
      }
      const capture = this.capture(
        target,
        projectId,
        threadId,
        workspacePath,
      ).finally(() => {
        this.captures.delete(target);
      });
      this.captures.set(target, capture);
      await capture;
    }
  }

  async deleteSnapshot(projectId: string, threadId: string): Promise<void> {
    await rm(this.threadPath(projectId, threadId), {
      recursive: true,
      force: true,
    });
  }

  async changes(
    projectId: string,
    threadId: string,
    workspacePath: string,
  ): Promise<ConversationChangesSnapshot> {
    await this.ensureSnapshot(projectId, threadId, workspacePath);
    const snapshotPath = this.threadPath(projectId, threadId);
    const manifest = await readManifest(snapshotPath);
    const current = await scanWorkspace(workspacePath);
    const matcher = await workspaceMatchers(workspacePath);
    const baselineByPath = new Map(
      manifest.entries
        .filter((entry) => !matcher.excludes(entry.path))
        .map((entry) => [entry.path, entry]),
    );
    const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
    const paths = [...new Set([...baselineByPath.keys(), ...currentByPath.keys()])]
      .sort((left, right) => left.localeCompare(right));
    const files: ConversationFileChange[] = [];
    const revisionParts: string[] = [];

    for (const path of paths) {
      const before = baselineByPath.get(path);
      const after = currentByPath.get(path);
      if (before?.hash === after?.hash) continue;

      const binary = !!before?.binary || !!after?.binary;
      const localOnly = !!before?.localOnly || !!after?.localOnly;
      const oldContent =
        before?.reviewable && !binary
          ? await readFile(join(snapshotPath, "files", path), "utf8")
          : undefined;
      const newContent =
        after?.reviewable && !binary
          ? await readFile(resolveWorkspacePath(workspacePath, path), "utf8")
          : undefined;
      const counts = binary
        ? { additions: 0, deletions: 0 }
        : lineChangeCounts(oldContent ?? "", newContent ?? "");

      files.push({
        path,
        status: !before ? "added" : !after ? "deleted" : "modified",
        additions: counts.additions,
        deletions: counts.deletions,
        binary,
        ...(localOnly ? { localOnly: true } : {}),
        ...(oldContent !== undefined ? { oldContent } : {}),
        ...(newContent !== undefined ? { newContent } : {}),
      });
      revisionParts.push(
        `${!before ? "added" : !after ? "deleted" : "modified"}:${localOnly ? "local" : "git"}:${path}:${before?.hash ?? ""}:${after?.hash ?? ""}`,
      );
    }

    const additions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    return {
      threadId,
      additions,
      deletions,
      revision: createHash("sha256")
        .update(revisionParts.join("\n"))
        .digest("hex"),
      files,
    };
  }

  async restore(
    projectId: string,
    threadId: string,
    workspacePath: string,
    revision: string,
    paths?: readonly string[],
  ): Promise<ConversationChangesSnapshot> {
    const current = await this.changes(projectId, threadId, workspacePath);
    if (!revision || current.revision !== revision) {
      throw new ConversationRestoreConflictError();
    }
    const selectedPaths =
      paths === undefined
        ? current.files.map(({ path }) => path)
        : [...new Set(paths.map(normalizeRelativePath))];
    const changedPaths = new Set(current.files.map(({ path }) => path));
    if (
      selectedPaths.length === 0 ||
      selectedPaths.some((path) => !changedPaths.has(path))
    ) {
      throw new ConversationRestoreConflictError();
    }

    const snapshotPath = this.threadPath(projectId, threadId);
    const manifest = await readManifest(snapshotPath);
    const baselineByPath = new Map(
      manifest.entries.map((entry) => [entry.path, entry]),
    );
    for (const path of selectedPaths) {
      const target = resolveWorkspacePath(workspacePath, path);
      await assertSafeRestoreTarget(workspacePath, target);
      const baseline = baselineByPath.get(path);
      if (!baseline) {
        await rm(target, { recursive: true, force: true });
        continue;
      }
      const source = join(snapshotPath, "files", path);
      await mkdir(dirname(target), { recursive: true });
      await rm(target, { recursive: true, force: true });
      await cp(source, target, { force: true });
      if (baseline.mode !== undefined) {
        await chmod(target, baseline.mode & 0o777);
      }
    }
    return this.changes(projectId, threadId, workspacePath);
  }

  async deliveryFiles(
    projectId: string,
    threadId: string,
    workspacePath: string,
    revision: string,
  ): Promise<readonly ConversationDeliveryFile[]> {
    const changes = await this.changes(projectId, threadId, workspacePath);
    if (!revision || changes.revision !== revision) {
      throw new ConversationRestoreConflictError();
    }

    const snapshotPath = this.threadPath(projectId, threadId);
    const manifest = await readManifest(snapshotPath);
    const current = await scanWorkspace(workspacePath);
    const baselineByPath = new Map(
      manifest.entries.map((entry) => [entry.path, entry]),
    );
    const currentByPath = new Map(current.map((entry) => [entry.path, entry]));

    const files = await Promise.all(
      changes.files.map(async (change) => {
        const baseline = baselineByPath.get(change.path);
        const task = currentByPath.get(change.path);
        const taskPath = resolveWorkspacePath(workspacePath, change.path);
        const [baselineContent, taskContent] = await Promise.all([
          baseline
            ? readRevisionFile(
                join(snapshotPath, "files", change.path),
                baseline.hash,
              )
            : undefined,
          task
            ? readRevisionFile(taskPath, task.hash)
            : assertRevisionFileMissing(taskPath).then(() => undefined),
        ]);
        return {
          path: change.path,
          status: change.status,
          binary: change.binary,
          ...(change.localOnly ? { localOnly: true } : {}),
          ...(baselineContent !== undefined ? { baselineContent } : {}),
          ...(taskContent !== undefined
            ? { taskContent, taskMode: task?.mode }
            : {}),
        };
      }),
    );
    const confirmed = await this.changes(
      projectId,
      threadId,
      workspacePath,
    );
    if (confirmed.revision !== revision) {
      throw new ConversationRestoreConflictError();
    }
    return files;
  }

  async listWorkspace(
    workspacePath: string,
    relativePath = "",
  ): Promise<readonly WorkspaceEntry[]> {
    const directory = resolveWorkspacePath(workspacePath, relativePath);
    await assertInsideWorkspace(workspacePath, directory);
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        path: normalizeRelativePath(join(relativePath, entry.name)),
        type: entry.isDirectory() ? "directory" as const : "file" as const,
      }))
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  }

  async readWorkspaceFile(
    workspacePath: string,
    relativePath: string,
  ): Promise<WorkspaceFile> {
    const absolutePath = await this.workspaceFilePath(
      workspacePath,
      relativePath,
    );
    const content = await readFile(absolutePath);
    const binary = isBinaryFileContent(content);
    return {
      path: normalizeRelativePath(relativePath),
      name: basename(relativePath),
      binary,
      size: content.byteLength,
      ...(!binary && content.byteLength <= MAX_FILE_PREVIEW_BYTES
        ? { content: content.toString("utf8") }
        : {}),
    };
  }

  async workspaceFilePath(
    workspacePath: string,
    relativePath: string,
  ): Promise<string> {
    const absolutePath = resolveWorkspacePath(workspacePath, relativePath);
    await assertInsideWorkspace(workspacePath, absolutePath);
    const metadata = await stat(absolutePath);
    if (!metadata.isFile()) throw new Error("Workspace path is not a file");
    return absolutePath;
  }

  private async capture(
    target: string,
    projectId: string,
    threadId: string,
    workspacePath: string,
  ): Promise<void> {
    const temporary = `${target}.creating-${process.pid}-${randomUUID()}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(join(temporary, "files"), { recursive: true });
    const entries = await scanWorkspace(workspacePath);

    for (const entry of entries) {
      const source = resolveWorkspacePath(workspacePath, entry.path);
      const destination = join(temporary, "files", entry.path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination);
    }

    const manifest: SnapshotManifest = {
      version: SNAPSHOT_VERSION,
      projectId,
      threadId,
      createdAt: new Date().toISOString(),
      entries,
    };
    await writeFile(
      join(temporary, "manifest.json"),
      `${JSON.stringify(manifest)}\n`,
      "utf8",
    );
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await rename(temporary, target);
  }

  private pendingPath(projectId: string, requestId: string): string {
    return join(
      this.snapshotRoot,
      key(projectId),
      "pending",
      key(requestId),
    );
  }

  private threadPath(projectId: string, threadId: string): string {
    return join(
      this.snapshotRoot,
      key(projectId),
      "threads",
      key(threadId),
    );
  }
}

async function scanWorkspace(workspacePath: string): Promise<SnapshotEntry[]> {
  const root = await realpath(workspacePath);
  const entries: SnapshotEntry[] = [];
  const matcher = await workspaceMatchers(root);

  async function visit(directory: string, relativeDirectory: string) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const childRelative = normalizeRelativePath(
        join(relativeDirectory, child.name),
      );
      if (child.isDirectory()) {
        if (!matcher.excludes(`${childRelative}/`)) {
          await visit(join(directory, child.name), childRelative);
        }
        continue;
      }
      if (!child.isFile()) continue;
      if (matcher.excludes(childRelative)) continue;
      const absolutePath = join(root, childRelative);
      const content = await readFile(absolutePath);
      const metadata = await stat(absolutePath);
      const binary = isBinaryFileContent(content);
      entries.push({
        path: childRelative,
        hash: createHash("sha256").update(content).digest("hex"),
        size: content.byteLength,
        mode: metadata.mode,
        binary,
        reviewable: !binary && content.byteLength <= MAX_FILE_PREVIEW_BYTES,
        ...(matcher.projectIgnores(childRelative)
          ? { localOnly: true }
          : {}),
      });
    }
  }

  await visit(root, "");
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function workspaceMatchers(workspacePath: string) {
  const root = await realpath(workspacePath);
  const ephemeral = workspaceEphemeralMatcher();
  const project = ignore();
  const sensitive = workspaceSensitiveMatcher();
  const gitIgnored = await gitIgnoredPaths(root);
  try {
    project.add(await readFile(join(root, ".gitignore"), "utf8"));
  } catch {
    // A workspace does not need to be a Git repository.
  }
  const projectIgnores = (path: string) =>
    gitIgnored.has(path.replace(/\/$/, "")) || project.ignores(path);
  return {
    projectIgnores,
    excludes(path: string) {
      return (
        ephemeral.ignores(path) ||
        (projectIgnores(path) && sensitive.ignores(path))
      );
    },
  };
}

async function gitIgnoredPaths(workspacePath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
      ],
      {
        cwd: workspacePath,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
        },
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return new Set(stdout.split("\0").filter(Boolean));
  } catch {
    return new Set();
  }
}

function resolveWorkspacePath(workspacePath: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const root = resolve(workspacePath);
  const target = resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Workspace path escapes the project");
  }
  return target;
}

async function assertInsideWorkspace(
  workspacePath: string,
  targetPath: string,
): Promise<void> {
  const root = await realpath(workspacePath);
  const target = await realpath(targetPath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Workspace path escapes the project");
  }
}

async function assertSafeRestoreTarget(
  workspacePath: string,
  targetPath: string,
): Promise<void> {
  const root = resolve(workspacePath);
  const relativePath = relative(root, targetPath);
  const parts = relativePath.split(sep).filter(Boolean);
  let current = root;

  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    try {
      const metadata = await lstat(current);
      const isTarget = index === parts.length - 1;
      if (
        metadata.isSymbolicLink() ||
        (!isTarget && !metadata.isDirectory()) ||
        (isTarget && !metadata.isFile())
      ) {
        throw new ConversationRestoreConflictError();
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }
}

function normalizeRelativePath(value: string): string {
  const normalized = value.split(sep).join("/").replace(/^\.\/+/, "");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Workspace path escapes the project");
  }
  return normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readRevisionFile(
  path: string,
  expectedHash: string,
): Promise<Buffer> {
  let content: Buffer;
  try {
    content = await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ConversationRestoreConflictError();
    }
    throw error;
  }
  const hash = createHash("sha256").update(content).digest("hex");
  if (hash !== expectedHash) throw new ConversationRestoreConflictError();
  return content;
}

async function assertRevisionFileMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new ConversationRestoreConflictError();
}

function lineChangeCounts(
  before: string,
  after: string,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) additions += part.count ?? 0;
    if (part.removed) deletions += part.count ?? 0;
  }
  return { additions, deletions };
}

async function readManifest(snapshotPath: string): Promise<SnapshotManifest> {
  const value = JSON.parse(
    await readFile(join(snapshotPath, "manifest.json"), "utf8"),
  ) as SnapshotManifest;
  if (value.version !== SNAPSHOT_VERSION || !Array.isArray(value.entries)) {
    throw new Error("Unsupported conversation change snapshot");
  }
  return value;
}

async function rewriteManifestThreadId(
  snapshotPath: string,
  threadId: string,
): Promise<void> {
  const manifest = await readManifest(snapshotPath);
  await writeFile(
    join(snapshotPath, "manifest.json"),
    `${JSON.stringify({ ...manifest, threadId })}\n`,
    "utf8",
  );
}

function key(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
