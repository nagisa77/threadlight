import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { TaskWorkspaceManager } from "../src/main/task-workspace.js";
import { resolveTerminalWorkspace } from "../../../packages/host-core/src/terminal-workspace.ts";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("TaskWorkspaceManager", () => {
  it("creates and removes an isolated standalone task directory", async () => {
    const root = await temporaryDirectory();
    const standaloneRoot = join(root, "standalone", "workspaces");
    const manager = new TaskWorkspaceManager(join(root, "worktrees"), {
      createId: () => "task-1",
      standaloneRoot,
    });

    const workspace = await manager.prepareStandalone();

    expect(workspace).toEqual({
      mode: "standalone",
      path: join(standaloneRoot, "task-1"),
    });
    await expect(access(workspace.path)).resolves.toBeUndefined();
    await manager.remove(workspace);
    await expect(access(workspace.path)).rejects.toThrow();
  });

  it("uses the project folder directly outside Git", async () => {
    const root = await temporaryDirectory();
    const project = join(root, "plain-project");
    await mkdir(project);
    const manager = new TaskWorkspaceManager(join(root, "worktrees"));

    await expect(manager.prepare("project-1", project)).resolves.toEqual({
      mode: "folder",
      path: await realpath(project),
    });
  });

  it("uses the project checkout directly when local development is selected", async () => {
    const root = await temporaryDirectory();
    const repository = join(root, "repository");
    await mkdir(repository);
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Threadlight Test"]);
    await git(repository, [
      "config",
      "user.email",
      "threadlight@example.invalid",
    ]);
    await writeFile(join(repository, "tracked.txt"), "local\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "Initial"]);
    const manager = new TaskWorkspaceManager(join(root, "worktrees"));

    await expect(
      manager.prepare("project-1", repository, "local"),
    ).resolves.toEqual({
      mode: "folder",
      path: await realpath(repository),
    });
    await expect(access(join(root, "worktrees"))).rejects.toThrow();
  });

  it("reports that explicit worktree development requires Git", async () => {
    const root = await temporaryDirectory();
    const project = join(root, "plain-project");
    await mkdir(project);
    const manager = new TaskWorkspaceManager(join(root, "worktrees"));

    await expect(
      manager.prepare("project-1", project, "worktree"),
    ).rejects.toThrow("requires a Git repository");
  });

  it("creates an isolated worktree with the current working state", async () => {
    const root = await temporaryDirectory();
    const repository = join(root, "repository");
    const project = join(repository, "packages", "app");
    await mkdir(project, { recursive: true });
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Threadlight Test"]);
    await git(repository, [
      "config",
      "user.email",
      "threadlight@example.invalid",
    ]);
    await writeFile(join(project, "tracked.txt"), "committed\n");
    await writeFile(
      join(repository, ".gitignore"),
      ".venv/\ndata/library.db\n",
    );
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "Initial"]);
    await writeFile(join(project, "tracked.txt"), "current dirty state\n");
    await writeFile(join(project, "untracked.txt"), "local context\n");
    await mkdir(join(repository, ".venv", "bin"), { recursive: true });
    await writeFile(join(repository, ".venv", "bin", "python"), "runtime\n");
    await mkdir(join(repository, "data"), { recursive: true });
    await writeFile(join(repository, "data", "library.db"), "original data\n");

    const manager = new TaskWorkspaceManager(join(root, "worktrees"), {
      createId: () => "task-1",
    });
    const workspace = await manager.prepare("project-1", project);

    expect(workspace).toMatchObject({
      mode: "worktree",
      branch: expect.stringMatching(/^threadlight\/app-/),
      repositoryRoot: await realpath(repository),
      sourceBranch: expect.stringMatching(/^(main|master)$/),
    });
    if (workspace.mode !== "worktree") throw new Error("Expected a worktree");
    expect(workspace.path).not.toBe(project);
    await expect(
      readFile(join(workspace.path, "tracked.txt"), "utf8"),
    ).resolves.toBe("current dirty state\n");
    await expect(
      readFile(join(workspace.path, "untracked.txt"), "utf8"),
    ).resolves.toBe("local context\n");
    expect((await lstat(join(workspace.root, ".venv"))).isSymbolicLink()).toBe(
      true,
    );
    await expect(
      readFile(join(workspace.root, ".venv", "bin", "python"), "utf8"),
    ).resolves.toBe("runtime\n");
    await expect(
      readFile(join(workspace.root, "data", "library.db"), "utf8"),
    ).resolves.toBe("original data\n");
    await writeFile(join(workspace.root, "data", "library.db"), "task data\n");
    await expect(
      readFile(join(repository, "data", "library.db"), "utf8"),
    ).resolves.toBe("original data\n");
    expect(await git(workspace.root, ["status", "--short"])).toContain(
      "M packages/app/tracked.txt",
    );
    expect(await git(workspace.root, ["status", "--short"])).toContain(
      "?? packages/app/untracked.txt",
    );

    await manager.remove(workspace);
    await expect(access(workspace.root)).rejects.toThrow();
    await expect(
      git(repository, ["show-ref", "--verify", `refs/heads/${workspace.branch}`]),
    ).rejects.toThrow();
  });

  it("does not silently use folder mode for a Git repository without a commit", async () => {
    const root = await temporaryDirectory();
    const repository = join(root, "repository");
    await mkdir(repository);
    await git(repository, ["init"]);
    const manager = new TaskWorkspaceManager(join(root, "worktrees"));

    await expect(
      manager.prepare("project-1", repository),
    ).rejects.toThrow("at least one commit");
  });

  it("refuses to remove a worktree outside its managed root", async () => {
    const root = await temporaryDirectory();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep\n");
    const manager = new TaskWorkspaceManager(join(root, "worktrees"));

    await expect(
      manager.remove({
        mode: "worktree",
        path: outside,
        root: outside,
        repositoryRoot: outside,
        branch: "threadlight/tampered",
        baseCommit: "fixture",
      }),
    ).resolves.toBeUndefined();
    await expect(
      readFile(join(outside, "keep.txt"), "utf8"),
    ).resolves.toBe("keep\n");
  });
});

describe("resolveTerminalWorkspace", () => {
  it("keeps task and original terminal contexts distinct", async () => {
    const root = await temporaryDirectory();
    const original = join(root, "original");
    const task = join(root, "task");
    await mkdir(original);
    await git(original, ["init", "-b", "main"]);
    await git(original, ["config", "user.name", "Threadlight Test"]);
    await git(original, ["config", "user.email", "test@threadlight.local"]);
    await writeFile(join(original, "tracked.txt"), "original\n");
    await git(original, ["add", "tracked.txt"]);
    await git(original, ["commit", "-m", "Initial"]);
    await git(original, ["worktree", "add", "-b", "threadlight/task", task]);
    const project = {
      id: "project-1",
      name: "project",
      basePath: original,
      lastOpenedAt: new Date(0).toISOString(),
      conversations: [
        {
          id: "thread-1",
          title: "Task",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          workspace: {
            mode: "worktree" as const,
            path: task,
            root: task,
            repositoryRoot: original,
            branch: "threadlight/task",
            baseCommit: "fixture",
          },
        },
      ],
    };

    expect(resolveTerminalWorkspace(project, "thread-1")).toEqual({
      cwd: await realpath(task),
      branch: "threadlight/task",
    });
    expect(
      resolveTerminalWorkspace(project, "thread-1", "original"),
    ).toEqual({ cwd: await realpath(original), branch: "main" });
    expect(() =>
      resolveTerminalWorkspace(project, "missing-thread"),
    ).toThrow("Unknown conversation: missing-thread");
  });

  it("uses the home directory for standalone terminals without a task workspace", async () => {
    const root = await temporaryDirectory();
    const standaloneRoot = join(root, "standalone", "workspaces");
    await mkdir(standaloneRoot, { recursive: true });
    const project = {
      id: "standalone",
      name: "Standalone",
      basePath: standaloneRoot,
      scope: "standalone" as const,
      lastOpenedAt: new Date(0).toISOString(),
      conversations: [],
    };

    expect(resolveTerminalWorkspace(project)).toEqual({
      cwd: await realpath(homedir()),
    });
    expect(resolveTerminalWorkspace(project, undefined, "original")).toEqual({
      cwd: await realpath(homedir()),
    });
  });

  it("uses the standalone task workspace once a conversation exists", async () => {
    const root = await temporaryDirectory();
    const standaloneRoot = join(root, "standalone", "workspaces");
    const task = join(standaloneRoot, "workspace-id");
    await mkdir(task, { recursive: true });
    const project = {
      id: "standalone",
      name: "Standalone",
      basePath: standaloneRoot,
      scope: "standalone" as const,
      lastOpenedAt: new Date(0).toISOString(),
      conversations: [
        {
          id: "thread-1",
          title: "Task",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          workspace: {
            mode: "standalone" as const,
            path: task,
          },
        },
      ],
    };

    expect(resolveTerminalWorkspace(project, "thread-1")).toEqual({
      cwd: await realpath(task),
    });
    expect(resolveTerminalWorkspace(project, "thread-1", "original")).toEqual({
      cwd: await realpath(homedir()),
    });
  });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
  });
  return stdout;
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "threadlight-task-workspace-"));
  temporaryDirectories.push(path);
  return path;
}
