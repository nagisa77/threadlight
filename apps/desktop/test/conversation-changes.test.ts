import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

  it("resolves Finder targets only for files inside the workspace", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    const outside = join(root, "outside.txt");
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "src", "index.ts"), "export {};\n");
    await writeFile(outside, "secret\n");
    await symlink(outside, join(workspace, "linked-secret.txt"));
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await expect(
      tracker.workspaceFilePath(workspace, "src/index.ts"),
    ).resolves.toBe(join(workspace, "src", "index.ts"));
    await expect(
      tracker.workspaceFilePath(workspace, "src"),
    ).rejects.toThrow("not a file");
    await expect(
      tracker.workspaceFilePath(workspace, "linked-secret.txt"),
    ).rejects.toThrow("escapes the project");
  });

  it("ignores virtual environments and generated Python caches", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, ".venv", "lib"), { recursive: true });
    await mkdir(join(workspace, "src", "__pycache__"), { recursive: true });
    await writeFile(join(workspace, "app.py"), "print('before')\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await writeFile(join(workspace, ".venv", "lib", "dependency.py"), "generated\n");
    await writeFile(
      join(workspace, "src", "__pycache__", "app.pyc"),
      "generated\n",
    );
    await writeFile(join(workspace, "app.py"), "print('after')\n");

    const snapshot = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    expect(snapshot.files.map((file) => file.path)).toEqual(["app.py"]);
  });

  it("reports project-ignored outputs as local data without requiring Git", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, ".gitignore"), "generated/\n*.tmp\n!important.tmp\n");
    await writeFile(join(workspace, "README.md"), "before\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await mkdir(join(workspace, "generated"));
    await writeFile(join(workspace, "generated", "asset.js"), "generated\n");
    await writeFile(join(workspace, "ignored.tmp"), "generated\n");
    await writeFile(join(workspace, "important.tmp"), "keep\n");

    const snapshot = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    expect(
      snapshot.files.map((file) => [file.path, !!file.localOnly]),
    ).toEqual([
      ["generated/asset.js", true],
      ["ignored.tmp", true],
      ["important.tmp", false],
    ]);
  });

  it("never captures ignored environment secrets as reviewable changes", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, ".gitignore"), ".env\n*.pem\n");
    await writeFile(join(workspace, ".env"), "API_KEY=before\n");
    await writeFile(join(workspace, "signing.pem"), "before\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await writeFile(join(workspace, ".env"), "API_KEY=after\n");
    await writeFile(join(workspace, "signing.pem"), "after\n");

    const snapshot = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    expect(snapshot.files).toEqual([]);
  });

  it("does not report baseline files as deleted when they become ignored", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "generated"), { recursive: true });
    await writeFile(join(workspace, ".gitignore"), "");
    await writeFile(join(workspace, "generated", "asset.js"), "generated\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));

    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await writeFile(join(workspace, ".gitignore"), "generated/\n");

    const snapshot = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    expect(snapshot.files.map((file) => [file.path, file.status])).toEqual([
      [".gitignore", "modified"],
    ]);
  });

  it("restores one file or every change to the task baseline", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "modified.txt"), "before\n");
    await writeFile(join(workspace, "deleted.txt"), "keep\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));
    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await writeFile(join(workspace, "modified.txt"), "after\n");
    await rm(join(workspace, "deleted.txt"));
    await writeFile(join(workspace, "added.txt"), "remove\n");

    const initial = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    const afterSingle = await tracker.restore(
      "project-1",
      "thread-1",
      workspace,
      initial.revision,
      ["modified.txt"],
    );

    await expect(
      readFile(join(workspace, "modified.txt"), "utf8"),
    ).resolves.toBe("before\n");
    expect(afterSingle.files.map(({ path }) => path)).toEqual([
      "added.txt",
      "deleted.txt",
    ]);

    const afterAll = await tracker.restore(
      "project-1",
      "thread-1",
      workspace,
      afterSingle.revision,
    );
    expect(afterAll.files).toEqual([]);
    await expect(access(join(workspace, "added.txt"))).rejects.toThrow();
    await expect(
      readFile(join(workspace, "deleted.txt"), "utf8"),
    ).resolves.toBe("keep\n");
  });

  it("rejects a restore when file content changed after the Diff loaded", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "value.txt"), "one\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));
    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await writeFile(join(workspace, "value.txt"), "two\n");
    const reviewed = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    await writeFile(join(workspace, "value.txt"), "new\n");

    await expect(
      tracker.restore(
        "project-1",
        "thread-1",
        workspace,
        reviewed.revision,
        ["value.txt"],
      ),
    ).rejects.toThrow("workspace changed");
    await expect(
      readFile(join(workspace, "value.txt"), "utf8"),
    ).resolves.toBe("new\n");
  });

  it("rejects a restore when the target was replaced by a symbolic link", async () => {
    const root = await temporaryDirectory();
    const workspace = join(root, "workspace");
    const outside = join(root, "outside.txt");
    await mkdir(workspace);
    await writeFile(join(workspace, "value.txt"), "before\n");
    await writeFile(outside, "outside\n");
    const tracker = new ConversationChangeTracker(join(root, "snapshots"));
    await tracker.ensureSnapshot("project-1", "thread-1", workspace);
    await rm(join(workspace, "value.txt"));
    const reviewed = await tracker.changes(
      "project-1",
      "thread-1",
      workspace,
    );
    await symlink(outside, join(workspace, "value.txt"));

    await expect(
      tracker.restore(
        "project-1",
        "thread-1",
        workspace,
        reviewed.revision,
        ["value.txt"],
      ),
    ).rejects.toThrow("workspace changed");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside\n");
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "threadlight-changes-"));
  temporaryDirectories.push(path);
  return path;
}
