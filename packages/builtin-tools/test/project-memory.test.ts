import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { ProjectMemoryStore } from "@threadlight/project-memory";

import { createProjectMemoryTool } from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("project_memory tool", () => {
  it("reads and replaces the full Markdown file with a short task-scoped token", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const tool = createProjectMemoryTool({
      store: new ProjectMemoryStore(workspaceRoot),
    });
    const signal = new AbortController().signal;

    const initial = (await tool.execute(
      { action: "read", content: null, read_token: null },
      { runId: "run-1", scopeId: "thread-1", signal },
    )) as { read_token: string; content: string; revision?: string };
    expect(initial.read_token).toMatch(/^mem_[A-Za-z0-9_-]{8}$/);
    expect(initial.revision).toBeUndefined();

    const updated = await tool.execute(
      {
        action: "write",
        content: "# Project memory\n\n## Conventions\n\n- Use npm.",
        read_token: initial.read_token,
      },
      { runId: "run-1", scopeId: "thread-1", signal },
    );

    expect(updated).toMatchObject({
      path: ".threadlight/MEMORY.md",
      content: expect.stringContaining("- Use npm."),
    });
  });

  it("rejects tokens from another run and tokens already consumed by a write", async () => {
    const workspaceRoot = await temporaryWorkspace();
    let token = 0;
    const tool = createProjectMemoryTool({
      store: new ProjectMemoryStore(workspaceRoot),
      tokenFactory: () => `mem_${++token}`,
    });
    const signal = new AbortController().signal;
    const initial = (await tool.execute(
      { action: "read", content: null, read_token: null },
      { runId: "run-1", scopeId: "thread-1", signal },
    )) as { read_token: string; content: string };

    await expect(
      tool.execute(
        {
          action: "write",
          content: initial.content,
          read_token: initial.read_token,
        },
        { runId: "run-2", scopeId: "thread-1", signal },
      ),
    ).rejects.toThrow("read_token is invalid or expired");

    await tool.execute(
      {
        action: "write",
        content: initial.content,
        read_token: initial.read_token,
      },
      { runId: "run-1", scopeId: "thread-1", signal },
    );
    await expect(
      tool.execute(
        {
          action: "write",
          content: initial.content,
          read_token: initial.read_token,
        },
        { runId: "run-1", scopeId: "thread-1", signal },
      ),
    ).rejects.toThrow("read_token is invalid or expired");
  });

  it("retains the underlying revision guard when memory changes after a read", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const store = new ProjectMemoryStore(workspaceRoot);
    const tool = createProjectMemoryTool({
      store,
      tokenFactory: () => "mem_test",
    });
    const signal = new AbortController().signal;
    const initial = (await tool.execute(
      { action: "read", content: null, read_token: null },
      { runId: "run-1", scopeId: "thread-1", signal },
    )) as { read_token: string };
    const external = await store.read();
    await store.write("# Project memory\n\nExternally changed.", external.revision);

    await expect(
      tool.execute(
        {
          action: "write",
          content: "# Project memory\n\nModel update.",
          read_token: initial.read_token,
        },
        { runId: "run-1", scopeId: "thread-1", signal },
      ),
    ).rejects.toThrow("Project memory changed since it was read");
  });
});

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "threadlight-memory-tool-"));
  directories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}
