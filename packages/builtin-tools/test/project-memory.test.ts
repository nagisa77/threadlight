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
  it("reads and replaces the full Markdown file with a revision guard", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const tool = createProjectMemoryTool({
      store: new ProjectMemoryStore(workspaceRoot),
    });
    const signal = new AbortController().signal;

    const initial = (await tool.execute(
      { action: "read", content: null, expected_revision: null },
      { runId: "run-1", signal },
    )) as { revision: string; content: string };
    const updated = await tool.execute(
      {
        action: "write",
        content: "# Project memory\n\n## Conventions\n\n- Use npm.",
        expected_revision: initial.revision,
      },
      { runId: "run-1", signal },
    );

    expect(updated).toMatchObject({
      path: ".threadlight/MEMORY.md",
      content: expect.stringContaining("- Use npm."),
    });
  });
});

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "threadlight-memory-tool-"));
  directories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return workspace;
}
