import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationChangeTracker } from "../src/main/conversation-changes.js";
import { TaskWorkspaceManager } from "../src/main/task-workspace.js";
import { WorktreeDeliveryManager } from "../src/main/worktree-delivery.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("WorktreeDeliveryManager", () => {
  it("preflights and applies a clean three-way merge to the original branch", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.repository, "notes.txt"),
      "original changed\nmiddle\nbase end\n",
    );
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\ntask changed\n",
    );
    const revision = await revisionFor(fixture);

    const preflight = await fixture.delivery.preflight(
      requestFor(fixture, revision),
    );
    expect(preflight).toMatchObject({
      sourceBranch: "main",
      targetBranch: "main",
      branchChanged: false,
      files: 1,
      pendingFiles: 1,
      conflicts: [],
    });

    const result = await fixture.delivery.apply(
      requestFor(fixture, revision),
    );
    expect(result.appliedFiles).toBe(1);
    expect(readFileSync(join(fixture.repository, "notes.txt"), "utf8")).toBe(
      "original changed\nmiddle\ntask changed\n",
    );
  });

  it("reports same-line conflicts without changing the original workspace", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.repository, "notes.txt"),
      "original changed\nmiddle\nbase end\n",
    );
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "task changed\nmiddle\nbase end\n",
    );
    const revision = await revisionFor(fixture);
    const original = readFileSync(
      join(fixture.repository, "notes.txt"),
      "utf8",
    );

    const preflight = await fixture.delivery.preflight(
      requestFor(fixture, revision),
    );
    expect(preflight.conflicts).toEqual([
      { path: "notes.txt", reason: "merge_conflict" },
    ]);
    await expect(
      fixture.delivery.apply(requestFor(fixture, revision)),
    ).rejects.toThrow("Delivery has 1 conflict");
    expect(readFileSync(join(fixture.repository, "notes.txt"), "utf8")).toBe(
      original,
    );
  });

  it("applies, stages, and commits only the delivered paths", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\ndelivered\n",
    );
    writeFileSync(join(fixture.repository, "unrelated.txt"), "keep staged\n");
    git(fixture.repository, "add", "unrelated.txt");
    const revision = await revisionFor(fixture);

    const result = await fixture.delivery.commit(
      requestFor(fixture, revision),
      "Deliver task changes",
    );

    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git(fixture.repository, "log", "-1", "--format=%s")).toBe(
      "Deliver task changes",
    );
    expect(git(fixture.repository, "show", "--format=", "--name-only", "HEAD"))
      .toBe("notes.txt");
    expect(git(fixture.repository, "diff", "--cached", "--name-only")).toBe(
      "unrelated.txt",
    );
  });

  it("blocks delivery after the original worktree switches branches", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\ndelivered\n",
    );
    git(fixture.repository, "switch", "-c", "other");
    const revision = await revisionFor(fixture);

    const preflight = await fixture.delivery.preflight(
      requestFor(fixture, revision),
    );
    expect(preflight).toMatchObject({
      sourceBranch: "main",
      targetBranch: "other",
      branchChanged: true,
    });
    await expect(
      fixture.delivery.apply(requestFor(fixture, revision)),
    ).rejects.toThrow("Switch back before delivering");
  });

  it("rejects a stale reviewed revision before delivery", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\nreviewed\n",
    );
    const revision = await revisionFor(fixture);
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\nchanged after review\n",
    );

    await expect(
      fixture.delivery.preflight(requestFor(fixture, revision)),
    ).rejects.toThrow("workspace changed after this Diff was loaded");
    expect(readFileSync(join(fixture.repository, "notes.txt"), "utf8")).toBe(
      "base start\nmiddle\nbase end\n",
    );
  });
});

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "threadlight-delivery-"));
  directories.push(root);
  const repository = join(root, "repository");
  git(root, "init", "-b", "main", repository);
  git(repository, "config", "user.email", "threadlight@example.test");
  git(repository, "config", "user.name", "Threadlight Test");
  writeFileSync(
    join(repository, "notes.txt"),
    "base start\nmiddle\nbase end\n",
  );
  git(repository, "add", "notes.txt");
  git(repository, "commit", "-m", "Initial");

  const workspaceManager = new TaskWorkspaceManager(join(root, "worktrees"), {
    createId: () => "task-1",
  });
  const workspace = await workspaceManager.prepare("project-1", repository);
  if (workspace.mode !== "worktree") throw new Error("Expected worktree");
  const tracker = new ConversationChangeTracker(join(root, "snapshots"));
  await tracker.ensureSnapshot("project-1", "thread-1", workspace.path);
  return {
    repository,
    workspace,
    tracker,
    delivery: new WorktreeDeliveryManager(tracker),
  };
}

async function revisionFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<string> {
  return (
    await fixture.tracker.changes(
      "project-1",
      "thread-1",
      fixture.workspace.path,
    )
  ).revision;
}

function requestFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  revision: string,
) {
  return {
    projectId: "project-1",
    threadId: "thread-1",
    revision,
    projectPath: fixture.workspace.repositoryRoot,
    workspace: fixture.workspace,
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
  }).trim();
}
