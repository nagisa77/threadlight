import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { isBinaryFileContent } from "./file-preview.js";
import {
  type ConversationChangeTracker,
  type ConversationDeliveryFile,
} from "./conversation-changes.js";
import type { GitTaskWorkspace } from "./task-workspace.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

type GitRunner = (
  cwd: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;
type TextMerger = (
  target: Buffer,
  baseline: Buffer,
  task: Buffer,
) => Promise<{ content: Buffer; conflict: boolean }>;

export interface WorktreeDeliveryRequest {
  projectId: string;
  threadId: string;
  revision: string;
  projectPath: string;
  workspace: GitTaskWorkspace;
}

export interface WorktreeDeliveryConflict {
  path: string;
  reason:
    | "both_added"
    | "target_deleted"
    | "target_modified"
    | "merge_conflict"
    | "unsafe_target";
}

export interface WorktreeDeliveryPreflight {
  taskBranch: string;
  targetBranch: string;
  sourceBranch?: string;
  branchChanged: boolean;
  files: number;
  pendingFiles: number;
  alreadyAppliedFiles: number;
  conflicts: readonly WorktreeDeliveryConflict[];
}

export interface WorktreeDeliveryResult extends WorktreeDeliveryPreflight {
  appliedFiles: number;
  commit?: string;
}

interface DeliveryOperation {
  path: string;
  targetPath: string;
  expectedContent?: Buffer;
  content?: Buffer;
  mode?: number;
  alreadyApplied: boolean;
  conflict?: WorktreeDeliveryConflict;
}

interface TargetBackup {
  path: string;
  content?: Buffer;
  mode?: number;
}

export interface WorktreeDeliveryManagerOptions {
  runGit?: GitRunner;
  mergeText?: TextMerger;
}

export class WorktreeDeliveryManager {
  private readonly runGit: GitRunner;
  private readonly mergeText: TextMerger;

  constructor(
    private readonly changes: ConversationChangeTracker,
    options: WorktreeDeliveryManagerOptions = {},
  ) {
    this.runGit = options.runGit ?? runGit;
    this.mergeText = options.mergeText ?? mergeTextWithGit;
  }

  async preflight(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryPreflight> {
    return (await this.plan(request)).preflight;
  }

  async apply(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryResult> {
    const plan = await this.plan(request);
    assertReady(plan.preflight);
    const pending = plan.operations.filter(
      (operation) => !operation.alreadyApplied,
    );
    await applyOperations(request.projectPath, pending);
    return deliveredResult(plan.preflight, pending.length);
  }

  async commit(
    request: WorktreeDeliveryRequest,
    message: string,
  ): Promise<WorktreeDeliveryResult> {
    const commitMessage = message.trim();
    if (!commitMessage) throw new Error("Commit message cannot be empty");

    const plan = await this.plan(request);
    assertReady(plan.preflight);
    const pending = plan.operations.filter(
      (operation) => !operation.alreadyApplied,
    );
    await applyOperations(request.projectPath, pending);

    const paths = [
      ...new Set(
        plan.operations.map(({ targetPath }) =>
          gitPath(request.workspace.repositoryRoot, targetPath),
        ),
      ),
    ];
    try {
      await this.runGit(request.workspace.repositoryRoot, [
        "add",
        "-A",
        "--",
        ...paths,
      ]);
      await this.runGit(request.workspace.repositoryRoot, [
        "commit",
        "--only",
        "-m",
        commitMessage,
        "--",
        ...paths,
      ]);
    } catch (error) {
      throw new Error(
        `Changes were applied to ${plan.preflight.targetBranch}, but Git could not create the commit: ${errorMessage(error)}`,
      );
    }
    const { stdout } = await this.runGit(request.workspace.repositoryRoot, [
      "rev-parse",
      "HEAD",
    ]);
    return {
      ...deliveredResult(plan.preflight, pending.length),
      commit: stdout.trim(),
    };
  }

  private async plan(request: WorktreeDeliveryRequest): Promise<{
    operations: readonly DeliveryOperation[];
    preflight: WorktreeDeliveryPreflight;
  }> {
    assertWorktreeRequest(request);
    const files = await this.changes.deliveryFiles(
      request.projectId,
      request.threadId,
      request.workspace.path,
      request.revision,
    );
    if (files.length === 0) {
      throw new Error("This task has no changes to deliver");
    }

    const targetBranch = await currentBranch(
      request.workspace.repositoryRoot,
      this.runGit,
    );
    const operations = await Promise.all(
      files.map((file) =>
        planFile(file, request.projectPath, this.mergeText),
      ),
    );
    const conflicts = operations.flatMap(({ conflict }) =>
      conflict ? [conflict] : [],
    );
    const alreadyAppliedFiles = operations.filter(
      ({ alreadyApplied }) => alreadyApplied,
    ).length;
    const sourceBranch = request.workspace.sourceBranch;
    return {
      operations,
      preflight: {
        taskBranch: request.workspace.branch,
        targetBranch,
        ...(sourceBranch ? { sourceBranch } : {}),
        branchChanged: Boolean(
          sourceBranch && sourceBranch !== targetBranch,
        ),
        files: operations.length,
        pendingFiles: operations.length - alreadyAppliedFiles,
        alreadyAppliedFiles,
        conflicts,
      },
    };
  }
}

async function planFile(
  file: ConversationDeliveryFile,
  projectPath: string,
  mergeText: TextMerger,
): Promise<DeliveryOperation> {
  const targetPath = safeTargetPath(projectPath, file.path);
  const target = await readTarget(projectPath, targetPath);
  if (target.unsafe) {
    return conflict(file.path, targetPath, "unsafe_target");
  }
  const baseline = file.baselineContent;
  const task = file.taskContent;

  if (buffersEqual(target.content, task)) {
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      content: task,
      mode: file.taskMode,
      alreadyApplied: true,
    };
  }
  if (!baseline) {
    if (target.content) return conflict(file.path, targetPath, "both_added");
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      content: task,
      mode: file.taskMode,
      alreadyApplied: false,
    };
  }
  if (!task) {
    if (!target.content) {
      return {
        path: file.path,
        targetPath,
        expectedContent: target.content,
        alreadyApplied: true,
      };
    }
    if (!target.content.equals(baseline)) {
      return conflict(file.path, targetPath, "target_modified");
    }
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      alreadyApplied: false,
    };
  }
  if (!target.content) {
    return conflict(file.path, targetPath, "target_deleted");
  }
  if (target.content.equals(baseline)) {
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      content: task,
      mode: file.taskMode,
      alreadyApplied: false,
    };
  }
  if (
    file.binary ||
    isBinaryFileContent(target.content) ||
    isBinaryFileContent(baseline) ||
    isBinaryFileContent(task)
  ) {
    return conflict(file.path, targetPath, "target_modified");
  }

  const merged = await mergeText(target.content, baseline, task);
  if (merged.conflict) {
    return conflict(file.path, targetPath, "merge_conflict");
  }
  return {
    path: file.path,
    targetPath,
    expectedContent: target.content,
    content: merged.content,
    mode: file.taskMode,
    alreadyApplied: merged.content.equals(target.content),
  };
}

async function applyOperations(
  projectPath: string,
  operations: readonly DeliveryOperation[],
): Promise<void> {
  if (operations.length === 0) return;
  const backups = await Promise.all(
    operations.map(async ({ targetPath, expectedContent }) => {
      const target = await readTarget(projectPath, targetPath);
      if (target.unsafe) {
        throw new Error("The original workspace changed during delivery");
      }
      if (!buffersEqual(target.content, expectedContent)) {
        throw new Error(
          "The original workspace changed after delivery preflight. Run the preflight again.",
        );
      }
      return {
        path: targetPath,
        content: target.content,
        mode: target.mode,
      } satisfies TargetBackup;
    }),
  );
  try {
    for (const operation of operations) {
      if (operation.content === undefined) {
        await rm(operation.targetPath, { force: true });
        continue;
      }
      await mkdir(dirname(operation.targetPath), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(operation.targetPath, operation.content);
      if (operation.mode !== undefined) {
        await chmod(operation.targetPath, operation.mode & 0o777);
      }
    }
  } catch (error) {
    await Promise.all(backups.map(restoreBackup));
    throw error;
  }
}

async function restoreBackup(backup: TargetBackup): Promise<void> {
  if (backup.content === undefined) {
    await rm(backup.path, { force: true });
    return;
  }
  await mkdir(dirname(backup.path), { recursive: true, mode: 0o700 });
  await writeFile(backup.path, backup.content);
  if (backup.mode !== undefined) {
    await chmod(backup.path, backup.mode & 0o777);
  }
}

function deliveredResult(
  preflight: WorktreeDeliveryPreflight,
  appliedFiles: number,
): WorktreeDeliveryResult {
  return {
    ...preflight,
    pendingFiles: 0,
    alreadyAppliedFiles: preflight.alreadyAppliedFiles + appliedFiles,
    appliedFiles,
  };
}

function assertReady(preflight: WorktreeDeliveryPreflight): void {
  if (preflight.branchChanged) {
    throw new Error(
      `The original worktree is now on ${preflight.targetBranch}, but this task started from ${preflight.sourceBranch}. Switch back before delivering.`,
    );
  }
  if (preflight.conflicts.length > 0) {
    throw new Error(
      `Delivery has ${preflight.conflicts.length} conflict${preflight.conflicts.length === 1 ? "" : "s"}. Resolve the original workspace changes and try again.`,
    );
  }
}

function assertWorktreeRequest(request: WorktreeDeliveryRequest): void {
  if (!isInside(request.workspace.repositoryRoot, request.projectPath)) {
    throw new Error("The project path is outside the original repository");
  }
  if (!isInside(request.workspace.root, request.workspace.path)) {
    throw new Error("The task path is outside its managed worktree");
  }
}

async function currentBranch(
  repositoryRoot: string,
  run: GitRunner,
): Promise<string> {
  const { stdout } = await run(repositoryRoot, [
    "branch",
    "--show-current",
  ]);
  return stdout.trim() || "detached HEAD";
}

async function readTarget(
  projectPath: string,
  path: string,
): Promise<{ content?: Buffer; mode?: number; unsafe: boolean }> {
  if (!isInside(projectPath, path)) return { unsafe: true };
  const root = resolve(projectPath);
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    try {
      const metadata = await lstat(current);
      const target = index === parts.length - 1;
      if (
        metadata.isSymbolicLink() ||
        (!target && !metadata.isDirectory()) ||
        (target && !metadata.isFile())
      ) {
        return { unsafe: true };
      }
      if (target) {
        return {
          content: await readFile(current),
          mode: metadata.mode,
          unsafe: false,
        };
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { unsafe: false };
      }
      throw error;
    }
  }
  return { unsafe: true };
}

function safeTargetPath(projectPath: string, relativePath: string): string {
  const target = resolve(projectPath, relativePath);
  if (!isInside(projectPath, target)) {
    throw new Error("Delivery path escapes the original project");
  }
  return target;
}

function gitPath(repositoryRoot: string, targetPath: string): string {
  const path = relative(repositoryRoot, targetPath);
  if (
    !path ||
    isAbsolute(path) ||
    path === ".." ||
    path.startsWith(`..${sep}`)
  ) {
    throw new Error("Delivery path escapes the original repository");
  }
  return path.split(sep).join("/");
}

async function mergeTextWithGit(
  target: Buffer,
  baseline: Buffer,
  task: Buffer,
): Promise<{ content: Buffer; conflict: boolean }> {
  const directory = await mkdtemp(join(tmpdir(), "threadlight-merge-"));
  const targetPath = join(directory, "target");
  const baselinePath = join(directory, "baseline");
  const taskPath = join(directory, "task");
  try {
    await Promise.all([
      writeFile(targetPath, target),
      writeFile(baselinePath, baseline),
      writeFile(taskPath, task),
    ]);
    return await new Promise((resolvePromise, reject) => {
      execFile(
        "git",
        [
          "merge-file",
          "-p",
          "-L",
          "original",
          "-L",
          "task base",
          "-L",
          "task",
          targetPath,
          baselinePath,
          taskPath,
        ],
        {
          encoding: "buffer",
          env: { ...process.env, LC_ALL: "C" },
          maxBuffer: MAX_GIT_OUTPUT_BYTES,
        },
        (error, stdout, stderr) => {
          const code =
            error && "code" in error && typeof error.code === "number"
              ? error.code
              : 0;
          if (!error || code === 1) {
            resolvePromise({
              content: Buffer.from(stdout),
              conflict: code === 1,
            });
            return;
          }
          reject(
            new Error(
              Buffer.from(stderr).toString("utf8").trim() ||
                "Git could not perform the three-way merge",
            ),
          );
        },
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function conflict(
  path: string,
  targetPath: string,
  reason: WorktreeDeliveryConflict["reason"],
): DeliveryOperation {
  return {
    path,
    targetPath,
    expectedContent: undefined,
    alreadyApplied: false,
    conflict: { path, reason },
  };
}

function buffersEqual(
  left: Buffer | undefined,
  right: Buffer | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.equals(right);
}

function isInside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
