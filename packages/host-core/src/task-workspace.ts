import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  workspaceEphemeralMatcher,
  workspaceRuntimeLinkMatcher,
} from "./workspace-state-policy.js";

export interface FolderTaskWorkspace {
  mode: "folder";
  path: string;
}

export interface StandaloneTaskWorkspace {
  mode: "standalone";
  path: string;
}

export interface GitTaskWorkspace {
  mode: "worktree";
  path: string;
  root: string;
  repositoryRoot: string;
  branch: string;
  baseCommit: string;
  sourceBranch?: string;
}

export type TaskWorkspace =
  | FolderTaskWorkspace
  | StandaloneTaskWorkspace
  | GitTaskWorkspace;

export interface TaskWorkspaceManagerOptions {
  createId?: () => string;
  standaloneRoot?: string;
  runGit?: (
    cwd: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export class TaskWorkspaceManager {
  private readonly createId: () => string;
  private readonly runGit: NonNullable<TaskWorkspaceManagerOptions["runGit"]>;
  private readonly standaloneRoot?: string;

  constructor(
    private readonly root: string,
    options: TaskWorkspaceManagerOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.runGit = options.runGit ?? runGit;
    this.standaloneRoot = options.standaloneRoot;
  }

  async prepare(
    projectId: string,
    projectPath: string,
  ): Promise<TaskWorkspace> {
    const canonicalProjectPath = await realpath(projectPath);
    const repository = await this.repository(canonicalProjectPath);
    if (!repository) {
      return { mode: "folder", path: canonicalProjectPath };
    }

    const id = this.createId();
    const shortId = createHash("sha256").update(id).digest("hex").slice(0, 10);
    const projectName = gitBranchSegment(basename(canonicalProjectPath));
    const branch = `threadlight/${projectName}-${shortId}`;
    const worktreeRoot = join(
      this.root,
      key(projectId),
      shortId,
    );
    await mkdir(dirname(worktreeRoot), { recursive: true, mode: 0o700 });

    try {
      await this.runGit(repository.root, [
        "worktree",
        "add",
        "-b",
        branch,
        worktreeRoot,
        repository.baseCommit,
      ]);
      await this.copyWorkingState(repository.root, worktreeRoot);
      await this.copyIgnoredWorkingState(repository.root, worktreeRoot);
      await this.initializeSubmodules(worktreeRoot);
    } catch (error) {
      await this.cleanupFailedWorktree(
        repository.root,
        worktreeRoot,
        branch,
      );
      throw error;
    }

    const projectRelativePath = relative(
      repository.root,
      canonicalProjectPath,
    );
    return {
      mode: "worktree",
      path: resolve(worktreeRoot, projectRelativePath),
      root: worktreeRoot,
      repositoryRoot: repository.root,
      branch,
      baseCommit: repository.baseCommit,
      ...(repository.sourceBranch
        ? { sourceBranch: repository.sourceBranch }
        : {}),
    };
  }

  async prepareStandalone(): Promise<StandaloneTaskWorkspace> {
    if (!this.standaloneRoot) {
      throw new Error("Standalone task workspaces are not configured");
    }
    const path = join(this.standaloneRoot, this.createId());
    await mkdir(path, { recursive: true, mode: 0o700 });
    return { mode: "standalone", path };
  }

  async remove(workspace: TaskWorkspace): Promise<void> {
    if (workspace.mode === "standalone") {
      if (!this.standaloneRoot) return;
      const managedRoot = resolve(this.standaloneRoot);
      const workspacePath = resolve(workspace.path);
      if (
        workspacePath === managedRoot ||
        !isInside(managedRoot, workspacePath)
      ) {
        return;
      }
      await rm(workspacePath, { recursive: true, force: true });
      return;
    }
    if (workspace.mode !== "worktree") return;
    const managedRoot = resolve(this.root);
    const worktreeRoot = resolve(workspace.root);
    if (
      worktreeRoot === managedRoot ||
      !isInside(managedRoot, worktreeRoot) ||
      !isInside(worktreeRoot, workspace.path)
    ) {
      return;
    }
    await this.runGit(workspace.repositoryRoot, [
      "worktree",
      "remove",
      "--force",
      worktreeRoot,
    ]).catch(async () => {
      await rm(worktreeRoot, { recursive: true, force: true });
      await this.runGit(workspace.repositoryRoot, [
        "worktree",
        "prune",
      ]).catch(() => undefined);
    });
    if (workspace.branch.startsWith("threadlight/")) {
      await this.runGit(workspace.repositoryRoot, [
        "branch",
        "-D",
        workspace.branch,
      ]).catch(() => undefined);
    }
  }

  private async repository(
    projectPath: string,
  ): Promise<{
    root: string;
    baseCommit: string;
    sourceBranch?: string;
  } | undefined> {
    let rootOutput: string;
    try {
      ({ stdout: rootOutput } = await this.runGit(projectPath, [
        "rev-parse",
        "--show-toplevel",
      ]));
    } catch (error) {
      if (isNotGitRepositoryError(error)) return;
      throw error;
    }

    const root = await realpath(rootOutput.trim());
    if (!isInside(root, projectPath)) return;
    let commitOutput: string;
    try {
      ({ stdout: commitOutput } = await this.runGit(projectPath, [
        "rev-parse",
        "--verify",
        "HEAD",
      ]));
    } catch {
      throw new Error(
        "Git projects require at least one commit before Threadlight can create a task worktree.",
      );
    }
    const baseCommit = commitOutput.trim();
    if (!baseCommit) {
      throw new Error(
        "Git projects require at least one commit before Threadlight can create a task worktree.",
      );
    }
    const { stdout: branchOutput } = await this.runGit(projectPath, [
      "branch",
      "--show-current",
    ]);
    const sourceBranch = branchOutput.trim() || "detached HEAD";
    return {
      root,
      baseCommit,
      sourceBranch,
    };
  }

  private async copyWorkingState(
    repositoryRoot: string,
    worktreeRoot: string,
  ): Promise<void> {
    const { stdout: patch } = await this.runGit(repositoryRoot, [
      "diff",
      "--binary",
      "--full-index",
      "HEAD",
      "--",
    ]);
    if (patch) {
      await applyPatch(worktreeRoot, patch);
    }

    const { stdout } = await this.runGit(repositoryRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    for (const path of stdout.split("\0").filter(Boolean)) {
      const normalized = normalizeGitPath(path);
      const source = resolve(repositoryRoot, normalized);
      const destination = resolve(worktreeRoot, normalized);
      if (!isInside(repositoryRoot, source) || !isInside(worktreeRoot, destination)) {
        throw new Error("Git reported an unsafe untracked path");
      }
      const metadata = await lstat(source);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      if (metadata.isSymbolicLink()) {
        await symlink(await readlink(source), destination);
      } else if (metadata.isFile()) {
        await copyFile(source, destination);
      }
    }
  }

  private async copyIgnoredWorkingState(
    repositoryRoot: string,
    worktreeRoot: string,
  ): Promise<void> {
    const { stdout } = await this.runGit(repositoryRoot, [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]);
    const ephemeral = workspaceEphemeralMatcher();
    const runtimeLinks = workspaceRuntimeLinkMatcher();

    for (const reportedPath of stdout.split("\0").filter(Boolean)) {
      const directory = reportedPath.endsWith("/");
      const normalized = normalizeGitPath(
        directory ? reportedPath.slice(0, -1) : reportedPath,
      );
      const matchPath = directory ? reportedPath : normalized.split(sep).join("/");
      const source = resolve(repositoryRoot, normalized);
      const destination = resolve(worktreeRoot, normalized);
      if (
        !isInside(repositoryRoot, source) ||
        !isInside(worktreeRoot, destination)
      ) {
        throw new Error("Git reported an unsafe ignored path");
      }

      const metadata = await lstat(source);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      if (directory && runtimeLinks.ignores(matchPath)) {
        await symlink(source, destination, "dir");
        continue;
      }
      if (ephemeral.ignores(matchPath) || metadata.isSymbolicLink()) {
        continue;
      }
      if (metadata.isDirectory()) {
        await cp(source, destination, {
          recursive: true,
          force: false,
          errorOnExist: true,
          mode: constants.COPYFILE_FICLONE,
        });
      } else if (metadata.isFile()) {
        await copyFile(source, destination, constants.COPYFILE_FICLONE);
      }
    }
  }

  private async initializeSubmodules(worktreeRoot: string): Promise<void> {
    // `git worktree add` never checks out submodule content, so a freshly
    // created task worktree has empty submodule directories. Populate them
    // so the baseline snapshot and the task see the same state. This is
    // best effort: submodule content is excluded from change scans and
    // delivery regardless of whether it is present.
    await this.runGit(worktreeRoot, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--recursive",
    ]).catch(() => undefined);
  }

  private async cleanupFailedWorktree(
    repositoryRoot: string,
    worktreeRoot: string,
    branch: string,
  ): Promise<void> {
    await this.runGit(repositoryRoot, [
      "worktree",
      "remove",
      "--force",
      worktreeRoot,
    ]).catch(() => undefined);
    await rm(worktreeRoot, { recursive: true, force: true });
    await this.runGit(repositoryRoot, ["branch", "-D", branch]).catch(
      () => undefined,
    );
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
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function applyPatch(cwd: string, patch: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "git",
      ["apply", "--binary", "--whitespace=nowarn", "-"],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `Unable to copy the current Git working state: ${Buffer.concat(stderr).toString("utf8").trim() || `git apply exited with code ${code}`}`,
          ),
        );
      }
    });
    child.stdin.end(patch);
  });
}

function normalizeGitPath(value: string): string {
  const normalized = value.split("/").join(sep);
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw new Error("Git reported an unsafe untracked path");
  }
  return normalized;
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target));
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  );
}

function gitBranchSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 36);
  return normalized || "task";
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const stderr =
    "stderr" in error && typeof error.stderr === "string"
      ? error.stderr
      : "";
  return `${error.message}\n${stderr}`.includes("not a git repository");
}

function key(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
