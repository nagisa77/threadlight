import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectSearchService } from "../src/main/project-search.js";
import type { DesktopProject } from "../src/shared/desktop-api.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProjectSearchService", () => {
  it("searches messages, tools, command output, memory, and file paths", async () => {
    const fixture = createFixture();
    const service = new ProjectSearchService();

    const cases = [
      ["retry budget", "message"],
      ["Run verification", "message"],
      ["exec_command", "tool"],
      ["build completed successfully", "command"],
      ["provider-neutral", "memory"],
      ["search-index.ts", "file"],
    ] as const;

    for (const [query, kind] of cases) {
      const results = await service.search({
        project: fixture.project,
        workspacePath: fixture.root,
        query,
        mode: "all",
        limit: 80,
      });
      expect(results.some((result) => result.kind === kind), query).toBe(true);
    }
  });

  it("returns file-only results for quick open, including an empty query", async () => {
    const fixture = createFixture();
    const results = await new ProjectSearchService().search({
      project: fixture.project,
      workspacePath: fixture.root,
      query: "",
      mode: "files",
      limit: 80,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.kind === "file")).toBe(true);
    expect(results.map((result) => result.path)).toContain(
      "src/search-index.ts",
    );
  });

  it("does not read a symlinked conversation file", async () => {
    const fixture = createFixture();
    const outside = join(fixture.parent, "outside.json");
    writeFileSync(
      outside,
      JSON.stringify({
        version: 1,
        threadId: "thread-2",
        messages: [
          { id: "secret", role: "user", text: "sensitive phrase" },
        ],
      }),
    );
    symlinkSync(
      outside,
      join(
        fixture.root,
        ".threadlight",
        "conversations",
        "thread-2.json",
      ),
    );
    const project: DesktopProject = {
      ...fixture.project,
      conversations: [
        ...fixture.project.conversations,
        {
          id: "thread-2",
          title: "Linked",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const results = await new ProjectSearchService().search({
      project,
      workspacePath: fixture.root,
      query: "sensitive phrase",
      mode: "all",
      limit: 80,
    });
    expect(results).toEqual([]);
  });
});

function createFixture(): {
  parent: string;
  root: string;
  project: DesktopProject;
} {
  const parent = mkdtempSync(join(tmpdir(), "threadlight-search-"));
  directories.push(parent);
  const root = join(parent, "project");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".threadlight", "conversations"), {
    recursive: true,
  });
  writeFileSync(join(root, "src", "search-index.ts"), "export const index = 1;\n");
  writeFileSync(
    join(root, ".threadlight", "MEMORY.md"),
    "# Architecture\n\nKeep the agent loop provider-neutral.\n",
  );
  writeFileSync(
    join(root, ".threadlight", "conversations", "thread-1.json"),
    JSON.stringify({
      version: 1,
      threadId: "thread-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: "message-1",
          role: "assistant",
          text: "The retry budget is now configurable.",
          progress: [
            {
              text: "Run verification",
              activities: [
                {
                  id: "call-1",
                  name: "exec_command",
                  status: "completed",
                  detail: "$ npm test",
                  process: {
                    command: "npm test",
                    cwd: root,
                    stdout: "Build completed successfully",
                    stderr: "",
                  },
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  git(root, "init", "-b", "main");
  git(root, "add", "src/search-index.ts");
  git(root, "config", "user.email", "threadlight@example.test");
  git(root, "config", "user.name", "Threadlight Test");
  git(root, "commit", "-m", "Initial");

  return {
    parent,
    root,
    project: {
      id: "project-1",
      name: "project",
      basePath: root,
      lastOpenedAt: new Date().toISOString(),
      conversations: [
        {
          id: "thread-1",
          title: "Search work",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
}
