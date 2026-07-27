import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createWorkspaceInspectTool } from "../src/index.js";

const context = {
  runId: "run-1",
  signal: new AbortController().signal,
};

describe("workspace_inspect", () => {
  it("lists, searches, and reads without exposing generated directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "threadlight-inspect-"));
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(root, "node_modules"));
      await writeFile(
        join(root, "src", "feature.ts"),
        "export const planControl = true;\nexport const done = false;\n",
      );
      await writeFile(
        join(root, "node_modules", "hidden.ts"),
        "planControl should not be searched",
      );
      const tool = createWorkspaceInspectTool({ workspaceRoot: root });

      await expect(
        tool.execute(
          { action: "list", path: null, max_depth: 3 },
          context,
        ),
      ).resolves.toMatchObject({
        entries: ["src/", "src/feature.ts"],
      });
      await expect(
        tool.execute(
          {
            action: "search",
            path: null,
            query: "plancontrol",
          },
          context,
        ),
      ).resolves.toMatchObject({
        matches: [
          {
            path: "src/feature.ts",
            line: 1,
            text: "export const planControl = true;",
          },
        ],
      });
      await expect(
        tool.execute(
          {
            action: "read",
            path: "src/feature.ts",
            start_line: 2,
            end_line: 2,
          },
          context,
        ),
      ).resolves.toMatchObject({
        startLine: 2,
        endLine: 2,
        content: "export const done = false;",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects paths outside the configured workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "threadlight-inspect-"));
    try {
      const tool = createWorkspaceInspectTool({ workspaceRoot: root });
      await expect(
        tool.execute(
          { action: "read", path: "../outside.txt" },
          context,
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
