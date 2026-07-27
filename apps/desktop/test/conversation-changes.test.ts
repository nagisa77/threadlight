import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationChangeTracker } from "../src/main/conversation-changes.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("ConversationChangeTracker", () => {
  it("records changes against a task baseline without relying on git", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(
      join(workspace, "src", "existing.ts"),
      "export const value = 'already dirty';\n",
    );
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await writeFile(
      join(workspace, "src", "existing.ts"),
      "export const value = 'changed by this task';\n",
    );
    await writeFile(join(workspace, "src", "created.ts"), "export const n = 1;\n");

    const snapshot = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );

    expect(snapshot.files.map((file) => [file.path, file.status])).toEqual([
      ["src/created.ts", "added"],
      ["src/existing.ts", "modified"],
    ]);
    expect(snapshot.files[1]).toMatchObject({
      oldContent: "export const value = 'already dirty';\n",
      newContent: "export const value = 'changed by this task';\n",
    });
    expect(snapshot.additions).toBe(2);
    expect(snapshot.deletions).toBe(1);
  });

  it("commits a pre-runtime snapshot to the thread id", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "README.md"), "before\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await tracker.beginPendingSnapshot("project-1", "request-4", workspace);
    await tracker.commitPendingSnapshot(
      "project-1",
      "request-4",
      "thread-from-runtime",
    );
    await writeFile(join(workspace, "README.md"), "after\n");

    const snapshot = await tracker.changes(
      "project-1",
      "thread-from-runtime",
      workspace,
    );
    expect(snapshot.files[0]).toMatchObject({
      path: "README.md",
      oldContent: "before\n",
      newContent: "after\n",
    });
  });

  it("deduplicates concurrent baseline creation for an older task", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "README.md"), "before\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await Promise.all([
      tracker.ensureSnapshot("project-1", "thread-1", workspace),
      tracker.ensureSnapshot("project-1", "thread-1", workspace),
      tracker.changes("project-1", "thread-1", workspace),
    ]);
    await writeFile(join(workspace, "README.md"), "after\n");

    await expect(
      tracker.changes("project-1", "thread-1", workspace),
    ).resolves.toMatchObject({
      files: [{ path: "README.md", oldContent: "before\n", newContent: "after\n" }],
    });
  });

  it("lists files lazily and rejects paths outside the workspace", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "# Project\n");
    await writeFile(join(workspace, "src", "index.ts"), "export {};\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await expect(tracker.listWorkspace(workspace)).resolves.toEqual([
      { name: "src", path: "src", type: "directory" },
      { name: "README.md", path: "README.md", type: "file" },
    ]);
    await expect(tracker.readWorkspaceFile(workspace, "../secret")).rejects.toThrow(
      "escapes the project",
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "threadlight-changes-"));
  temporaryDirectories.push(path);
  return path;
}
