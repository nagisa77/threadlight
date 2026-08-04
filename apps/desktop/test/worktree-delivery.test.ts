import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationChangeTracker } from "../src/main/conversation-changes.js";
import { TaskWorkspaceManager } from "../src/main/task-workspace.js";
import {
  applyAutomaticWorktreeDelivery,
  WorktreeDeliveryManager,
} from "../src/main/worktree-delivery.js";

const directories: string[] = [];

interface PersistedJournalFixture {
  version: 1;
  projectId: string;
  threadId: string;
  committed?: {
    revision: string;
    undo?: {
      operations: Array<{
        path: string;
        content?: string;
        mode?: number;
        appliedContent?: string;
        appliedMode?: number;
      }>;
    };
  };
  pending?: {
    next?: PersistedJournalFixture["committed"];
    operations: Array<{
      path: string;
      beforeContent?: string;
      beforeMode?: number;
      afterContent?: string;
      afterMode?: number;
    }>;
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("WorktreeDeliveryManager", () => {
  it("treats a completed task without file changes as a successful no-op", async () => {
    const fixture = await createFixture();
    const revision = await revisionFor(fixture);
    const states: string[] = [];

    await expect(
      applyAutomaticWorktreeDelivery(
        fixture.delivery,
        requestFor(fixture, revision),
        (state) => states.push(state.status),
      ),
    ).resolves.toMatchObject({
      targetBranch: "main",
      files: 0,
      pendingFiles: 0,
      appliedFiles: 0,
      undoAvailable: false,
    });

    expect(states).toEqual(["syncing", "synced"]);
    await expect(
      fixture.delivery.history(requestFor(fixture, revision)),
    ).resolves.toMatchObject({
      currentRevision: revision,
      synchronizedFiles: 0,
      entries: [
        expect.objectContaining({
          status: "synced",
          files: 0,
          appliedFiles: 0,
        }),
      ],
    });
  });

  it("does not require the original branch for a no-change task", async () => {
    const fixture = await createFixture();
    git(fixture.repository, "switch", "-c", "other");
    const revision = await revisionFor(fixture);

    await expect(
      applyAutomaticWorktreeDelivery(
        fixture.delivery,
        requestFor(fixture, revision),
        () => undefined,
      ),
    ).resolves.toMatchObject({
      targetBranch: "other",
      branchChanged: true,
      files: 0,
      appliedFiles: 0,
    });
  });

  it("recognizes legacy no-change failures for status repair", async () => {
    const fixture = await createFixture();
    const revision = await revisionFor(fixture);
    const request = requestFor(fixture, revision);

    await fixture.delivery.recordFailure(
      request,
      "This task has no changes to deliver",
    );

    await expect(
      fixture.delivery.hasLegacyNoChangesFailure(request),
    ).resolves.toBe(true);
  });

  it("reports lifecycle-owned automatic delivery status and conflict details", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(originalFile, "original changed\nmiddle\nbase end\n");
    writeFileSync(taskFile, "task changed\nmiddle\nbase end\n");
    const revision = await revisionFor(fixture);
    const states: Array<{
      status: string;
      conflicts?: readonly { path: string; reason: string }[];
    }> = [];

    await expect(
      applyAutomaticWorktreeDelivery(
        fixture.delivery,
        requestFor(fixture, revision),
        (state) => {
          states.push({
            status: state.status,
            ...(state.preflight
              ? { conflicts: state.preflight.conflicts }
              : {}),
          });
        },
      ),
    ).rejects.toThrow("Delivery has 1 conflict");

    expect(states).toEqual([
      { status: "syncing" },
      {
        status: "conflict",
        conflicts: [{ path: "notes.txt", reason: "merge_conflict" }],
      },
    ]);
    expect(readFileSync(originalFile, "utf8")).toBe(
      "original changed\nmiddle\nbase end\n",
    );
  });

  it("keeps the delivery outcome independent from a disconnected status observer", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "base start\nmiddle\nautomatic\n");
    const revision = await revisionFor(fixture);

    await expect(
      applyAutomaticWorktreeDelivery(
        fixture.delivery,
        requestFor(fixture, revision),
        () => {
          throw new Error("renderer disconnected");
        },
      ),
    ).resolves.toMatchObject({ appliedFiles: 1 });
    expect(readFileSync(originalFile, "utf8")).toBe(
      "base start\nmiddle\nautomatic\n",
    );
  });

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

  it("incrementally applies repeated edits to the same line across turns", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "first turn\nmiddle\nbase end\n");
    const firstRevision = await revisionFor(fixture);

    await fixture.delivery.apply(requestFor(fixture, firstRevision));
    expect(readFileSync(originalFile, "utf8")).toBe(
      "first turn\nmiddle\nbase end\n",
    );

    writeFileSync(taskFile, "second turn\nmiddle\nbase end\n");
    const secondRevision = await revisionFor(fixture);
    await expect(
      fixture.delivery.preflight(requestFor(fixture, secondRevision)),
    ).resolves.toMatchObject({ pendingFiles: 1, conflicts: [] });
    await fixture.delivery.apply(requestFor(fixture, secondRevision));

    expect(readFileSync(originalFile, "utf8")).toBe(
      "second turn\nmiddle\nbase end\n",
    );
  });

  it("continues incremental delivery after the manager is recreated for a Host restart", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "first turn\nmiddle\nbase end\n");
    await fixture.delivery.apply(
      requestFor(fixture, await revisionFor(fixture)),
    );

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    writeFileSync(taskFile, "second turn\nmiddle\nbase end\n");
    const revision = await revisionFor(fixture);
    await expect(
      restarted.preflight(requestFor(fixture, revision)),
    ).resolves.toMatchObject({ pendingFiles: 1, conflicts: [] });
    await restarted.apply(requestFor(fixture, revision));

    expect(readFileSync(originalFile, "utf8")).toBe(
      "second turn\nmiddle\nbase end\n",
    );
  });

  it("recovers a fully written delivery whose journal commit was interrupted", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    writeFileSync(taskFile, "first turn\nmiddle\nbase end\n");
    await fixture.delivery.apply(
      requestFor(fixture, await revisionFor(fixture)),
    );
    const journalPath = deliveryJournalFile(fixture.repository);
    const firstJournal = JSON.parse(
      readFileSync(journalPath, "utf8"),
    ) as PersistedJournalFixture;

    writeFileSync(taskFile, "second turn\nmiddle\nbase end\n");
    const revision = await revisionFor(fixture);
    await fixture.delivery.apply(requestFor(fixture, revision));
    const secondJournal = JSON.parse(
      readFileSync(journalPath, "utf8"),
    ) as PersistedJournalFixture;
    const next = secondJournal.committed;
    const operations = next?.undo?.operations;
    if (!next || !operations) throw new Error("Expected persisted undo state");
    const interrupted: PersistedJournalFixture = {
      version: 1,
      projectId: "project-1",
      threadId: "thread-1",
      committed: firstJournal.committed,
      pending: {
        next,
        operations: operations.map((operation) => ({
          path: operation.path,
          beforeContent: operation.content,
          beforeMode: operation.mode,
          afterContent: operation.appliedContent,
          afterMode: operation.appliedMode,
        })),
      },
    };
    writeFileSync(journalPath, `${JSON.stringify(interrupted)}\n`);

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    await expect(
      restarted.preflight(requestFor(fixture, revision)),
    ).resolves.toMatchObject({ pendingFiles: 0, conflicts: [] });
    const recovered = JSON.parse(
      readFileSync(journalPath, "utf8"),
    ) as PersistedJournalFixture;
    expect(recovered.pending).toBeUndefined();
    expect(recovered.committed?.revision).toBe(revision);
  });

  it("undoes the latest automatic application", async () => {
    const fixture = await createFixture();
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\nautomatic\n",
    );
    const revision = await revisionFor(fixture);
    await expect(
      fixture.delivery.apply(requestFor(fixture, revision)),
    ).resolves.toMatchObject({ appliedFiles: 1, undoAvailable: true });

    await expect(
      fixture.delivery.undo(requestFor(fixture, revision)),
    ).resolves.toMatchObject({
      targetBranch: "main",
      revertedFiles: 1,
      revision,
    });
    expect(readFileSync(originalFile, "utf8")).toBe(
      "base start\nmiddle\nbase end\n",
    );
  });

  it("restores persisted content and mode when undoing after a Host restart", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "base start\nmiddle\nautomatic\n");
    chmodSync(taskFile, 0o755);
    const revision = await revisionFor(fixture);
    await fixture.delivery.apply(requestFor(fixture, revision));
    expect(statSync(originalFile).mode & 0o777).toBe(0o755);

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    await expect(
      restarted.undo(requestFor(fixture, revision)),
    ).resolves.toMatchObject({ revertedFiles: 1, revision });

    expect(readFileSync(originalFile, "utf8")).toBe(
      "base start\nmiddle\nbase end\n",
    );
    expect(statSync(originalFile).mode & 0o777).toBe(0o644);
  });

  it("persists delivery history and recovery points across Host restarts", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\npersisted history\n",
    );
    const revision = await revisionFor(fixture);
    await fixture.delivery.apply(requestFor(fixture, revision));

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    await expect(
      restarted.history({
        projectId: "project-1",
        threadId: "thread-1",
        projectPath: fixture.repository,
      }),
    ).resolves.toMatchObject({
      targetBranch: "main",
      currentRevision: revision,
      synchronizedFiles: 1,
      undoPoint: {
        revision,
        files: ["notes.txt"],
      },
      entries: [
        {
          revision,
          status: "synced",
          targetBranch: "main",
          appliedFiles: 1,
        },
      ],
    });

    await restarted.undo(requestFor(fixture, revision));
    const afterUndo = await restarted.history({
      projectId: "project-1",
      threadId: "thread-1",
      projectPath: fixture.repository,
    });
    expect(afterUndo.undoPoint).toBeUndefined();
    expect(afterUndo.entries.map(({ status }) => status)).toEqual([
      "synced",
      "undone",
    ]);
  });

  it("persists conflict diagnostics for the delivery center", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.repository, "notes.txt"),
      "original conflict\nmiddle\nbase end\n",
    );
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "task conflict\nmiddle\nbase end\n",
    );
    const revision = await revisionFor(fixture);

    await expect(
      applyAutomaticWorktreeDelivery(
        fixture.delivery,
        requestFor(fixture, revision),
        () => undefined,
      ),
    ).rejects.toThrow("conflict");

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    const history = await restarted.history({
      projectId: "project-1",
      threadId: "thread-1",
      projectPath: fixture.repository,
    });
    expect(history.entries).toMatchObject([
      {
        status: "conflict",
        revision,
        conflicts: [{ path: "notes.txt", reason: "merge_conflict" }],
      },
    ]);
  });

  it("does not overwrite original-workspace edits while undoing", async () => {
    const fixture = await createFixture();
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\nautomatic\n",
    );
    const revision = await revisionFor(fixture);
    await fixture.delivery.apply(requestFor(fixture, revision));
    writeFileSync(originalFile, "manual follow-up\n");

    await expect(
      fixture.delivery.undo(requestFor(fixture, revision)),
    ).rejects.toThrow("changed after the automatic application");
    expect(readFileSync(originalFile, "utf8")).toBe("manual follow-up\n");
  });

  it("syncs a task file that is reverted to its original contents", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "changed\nmiddle\nbase end\n");
    await fixture.delivery.apply(
      requestFor(fixture, await revisionFor(fixture)),
    );

    writeFileSync(taskFile, "base start\nmiddle\nbase end\n");
    const revertedRevision = await revisionFor(fixture);
    await expect(
      fixture.delivery.apply(requestFor(fixture, revertedRevision)),
    ).resolves.toMatchObject({ appliedFiles: 1 });
    expect(readFileSync(originalFile, "utf8")).toBe(
      "base start\nmiddle\nbase end\n",
    );
  });

  it("syncs a task file reverted to its baseline after a Host restart", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "changed\nmiddle\nbase end\n");
    await fixture.delivery.apply(
      requestFor(fixture, await revisionFor(fixture)),
    );

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    writeFileSync(taskFile, "base start\nmiddle\nbase end\n");
    const revision = await revisionFor(fixture);
    await expect(
      restarted.apply(requestFor(fixture, revision)),
    ).resolves.toMatchObject({ appliedFiles: 1 });
    expect(readFileSync(originalFile, "utf8")).toBe(
      "base start\nmiddle\nbase end\n",
    );
  });

  it("fails closed when a persisted delivery journal is corrupted", async () => {
    const fixture = await createFixture();
    const taskFile = join(fixture.workspace.path, "notes.txt");
    const originalFile = join(fixture.repository, "notes.txt");
    writeFileSync(taskFile, "base start\nmiddle\nautomatic\n");
    const revision = await revisionFor(fixture);
    await fixture.delivery.apply(requestFor(fixture, revision));
    const journalDirectory = join(
      fixture.repository,
      ".threadlight",
      "delivery-journal",
    );
    const journalFiles = readdirSync(journalDirectory);
    expect(journalFiles).toHaveLength(1);
    expect(statSync(journalDirectory).mode & 0o777).toBe(0o700);
    const journalPath = join(journalDirectory, journalFiles[0]!);
    expect(statSync(journalPath).mode & 0o777).toBe(0o600);
    writeFileSync(journalPath, "not json\n");

    const restarted = new WorktreeDeliveryManager(fixture.tracker);
    await expect(
      restarted.preflight(requestFor(fixture, revision)),
    ).rejects.toThrow("delivery journal is invalid");
    expect(readFileSync(originalFile, "utf8")).toBe(
      "base start\nmiddle\nautomatic\n",
    );
  });

  it("removes persisted delivery state when the task is deleted", async () => {
    const fixture = await createFixture();
    writeFileSync(
      join(fixture.workspace.path, "notes.txt"),
      "base start\nmiddle\nautomatic\n",
    );
    await fixture.delivery.apply(
      requestFor(fixture, await revisionFor(fixture)),
    );
    const journalDirectory = join(
      fixture.repository,
      ".threadlight",
      "delivery-journal",
    );
    expect(readdirSync(journalDirectory)).toHaveLength(1);

    await fixture.delivery.deleteJournal({
      projectId: "project-1",
      threadId: "thread-1",
      projectPath: fixture.repository,
    });

    expect(readdirSync(journalDirectory)).toEqual([]);
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

  it("applies Git-ignored local data without pretending it can be committed", async () => {
    const fixture = await createFixture(true);
    writeFileSync(join(fixture.workspace.path, "data", "library.db"), "task data\n");
    const revision = await revisionFor(fixture);

    await expect(
      fixture.delivery.preflight(requestFor(fixture, revision)),
    ).resolves.toMatchObject({
      files: 1,
      localOnlyFiles: 1,
      conflicts: [],
    });
    await expect(
      fixture.delivery.commit(requestFor(fixture, revision), "Commit data"),
    ).rejects.toThrow("only changed local data");

    const result = await fixture.delivery.apply(requestFor(fixture, revision));
    expect(result.appliedFiles).toBe(1);
    expect(readFileSync(join(fixture.repository, "data", "library.db"), "utf8"))
      .toBe("task data\n");
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

async function createFixture(withLocalData = false) {
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
  if (withLocalData) {
    writeFileSync(join(repository, ".gitignore"), "data/library.db\n");
    mkdirSync(join(repository, "data"), { recursive: true });
    writeFileSync(join(repository, "data", "library.db"), "original data\n");
  }
  git(repository, "add", "notes.txt", ...(withLocalData ? [".gitignore"] : []));
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

function deliveryJournalFile(repository: string): string {
  const directory = join(repository, ".threadlight", "delivery-journal");
  const files = readdirSync(directory);
  if (files.length !== 1) throw new Error("Expected one delivery journal");
  return join(directory, files[0]!);
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
