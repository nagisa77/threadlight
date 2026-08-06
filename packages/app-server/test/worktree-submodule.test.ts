import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConversationChangeTracker,
  TaskWorkspaceManager,
  WorktreeDeliveryManager,
} from "@threadlight/host-core";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("submodule worktrees", () => {
  it("initializes submodules in task worktrees and keeps submodule content out of changes and delivery", async () => {
    const root = temporaryDirectory("threadlight-submodule-");
    const submodule = createSubmoduleRepo(join(root, "vendor-lib"));
    const project = createParentRepo(join(root, "project"), submodule);

    const manager = new TaskWorkspaceManager(join(root, "worktrees"));
    const workspace = await manager.prepare("project-1", project);
    try {
      expect(workspace.mode).toBe("worktree");
      if (workspace.mode !== "worktree") return;

      // `git worktree add` leaves submodule directories empty; the workspace
      // manager must populate them so the baseline matches the task view.
      expect(existsSync(join(workspace.root, "vendor", "lib", "core.c"))).toBe(
        true,
      );

      // Submodule content is owned by another repository: it must never show
      // up as a parent-repo change, while ordinary files still do.
      const changes = new ConversationChangeTracker(join(root, "snapshots"));
      await changes.ensureSnapshot("project-1", "thread-1", workspace.path);
      writeFileSync(
        join(workspace.root, "vendor", "lib", "core.c"),
        "changed inside submodule\n",
      );
      writeFileSync(
        join(workspace.root, "src", "index.ts"),
        "export const value = 'task change';\n",
      );
      const snapshot = await changes.changes(
        "project-1",
        "thread-1",
        workspace.path,
      );
      const paths = snapshot.files.map((file) => file.path);
      expect(paths).not.toContain("vendor/lib/core.c");
      expect(paths).toContain("src/index.ts");

      // Automatic sync applies the ordinary file, never touches the
      // submodule in the original workspace, and finishes without errors.
      const delivery = new WorktreeDeliveryManager(changes);
      const result = await delivery.apply({
        projectId: "project-1",
        threadId: "thread-1",
        revision: snapshot.revision,
        projectPath: realpathSync(project),
        workspace,
      });
      expect(result.conflicts).toEqual([]);
      expect(result.appliedFiles).toBe(1);
      expect(readFileSync(join(project, "src", "index.ts"), "utf8")).toBe(
        "export const value = 'task change';\n",
      );
      expect(
        readFileSync(join(project, "vendor", "lib", "core.c"), "utf8"),
      ).toBe("submodule content\n");
      const status = execFileSync(
        "git",
        ["status", "--porcelain", "--", "vendor"],
        { cwd: project, encoding: "utf8" },
      );
      expect(status.trim()).toBe("");
    } finally {
      await manager.remove(workspace);
    }
  });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function createSubmoduleRepo(path: string): string {
  mkdirSync(path);
  runGit(path, ["init", "-q"]);
  runGit(path, ["config", "user.email", "test@threadlight.local"]);
  runGit(path, ["config", "user.name", "Threadlight Test"]);
  writeFileSync(join(path, "core.c"), "submodule content\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "-qm", "initial"]);
  return path;
}

function createParentRepo(path: string, submodule: string): string {
  mkdirSync(path);
  runGit(path, ["init", "-q"]);
  runGit(path, ["config", "user.email", "test@threadlight.local"]);
  runGit(path, ["config", "user.name", "Threadlight Test"]);
  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(
    join(path, "src", "index.ts"),
    "export const value = 'base';\n",
  );
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "-qm", "initial"]);
  runGit(path, [
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    submodule,
    "vendor/lib",
  ]);
  runGit(path, ["commit", "-qm", "add submodule"]);
  return path;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
