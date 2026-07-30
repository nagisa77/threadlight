import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { TaskWorkspaceManager } from "../src/main/task-workspace.js";

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
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "Initial"]);
    await writeFile(join(project, "tracked.txt"), "current dirty state\n");
    await writeFile(join(project, "untracked.txt"), "local context\n");

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
