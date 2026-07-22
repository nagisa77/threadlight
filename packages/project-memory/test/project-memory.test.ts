import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROJECT_MEMORY_RELATIVE_PATH,
  ProjectMemoryConflictError,
  ProjectMemoryStore,
} from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ProjectMemoryStore", () => {
  it("creates readable Markdown and replaces it atomically", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const store = new ProjectMemoryStore(workspaceRoot);

    const initial = await store.read();
    expect(initial.path).toBe(PROJECT_MEMORY_RELATIVE_PATH);
    expect(initial.content).toContain("# Project memory");

    const updated = await store.write(
      "# Project memory\n\n## Decisions\n\n- Use SQLite.",
      initial.revision,
    );

    expect(updated.content).toBe(
      "# Project memory\n\n## Decisions\n\n- Use SQLite.\n",
    );
    await expect(readFile(updated.absolutePath, "utf8")).resolves.toBe(
      updated.content,
    );
  });

  it("rejects stale writes and storage symlinks", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const store = new ProjectMemoryStore(workspaceRoot);
    const initial = await store.read();
    await store.write("# Updated", initial.revision);

    await expect(store.write("# Stale", initial.revision)).rejects.toBeInstanceOf(
      ProjectMemoryConflictError,
    );

    const secondWorkspace = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await symlink(outside, join(secondWorkspace, ".threadlight"));
    await expect(new ProjectMemoryStore(secondWorkspace).read()).rejects.toThrow(
      ".threadlight must be a directory inside the project",
    );
  });

  it("serializes concurrent writes so only one revision can win", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const store = new ProjectMemoryStore(workspaceRoot);
    const initial = await store.read();

    const writes = await Promise.allSettled([
      store.write("# First", initial.revision),
      store.write("# Second", initial.revision),
    ]);

    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = writes.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(ProjectMemoryConflictError),
    });
  });
});

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "threadlight-memory-"));
  directories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}
