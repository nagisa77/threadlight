import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CodeHostDeliveryManager,
  type CodeHostDeliveryStatus,
  type CodeHostProvider,
  type CodeHostPullRequest,
} from "../src/main/code-host-delivery.js";
import { ConversationChangeTracker } from "../src/main/conversation-changes.js";
import { GitHubCliProvider } from "../src/main/github-cli-provider.js";
import { TaskWorkspaceManager } from "../src/main/task-workspace.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CodeHostDeliveryManager", () => {
  it("commits only reviewed task files and pushes the isolated branch", async () => {
    const fixture = await createFixture(true);
    writeFileSync(join(fixture.workspace.path, "notes.txt"), "published\n");
    const revision = (
      await fixture.tracker.changes(
        "project-1",
        "thread-1",
        fixture.workspace.path,
      )
    ).revision;

    const result = await fixture.manager.commitAndPush(
      requestFor(fixture, revision),
      "Publish reviewed changes",
    );

    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(fixture.provider.pushed).toEqual([
      {
        path: fixture.workspace.path,
        branch: fixture.workspace.branch,
      },
    ]);
    expect(
      git(
        fixture.workspace.path,
        "show",
        "--format=",
        "--name-only",
        "HEAD",
      ),
    ).toBe("notes.txt");
    expect(
      git(fixture.workspace.path, "diff", "--cached", "--name-only"),
    ).toBe("unrelated.txt");
    expect(readFileSync(join(fixture.repository, "notes.txt"), "utf8")).toBe(
      "base\n",
    );
  });

  it("creates a Draft PR only after the task branch is pushed", async () => {
    const fixture = await createFixture();
    const revision = (
      await fixture.tracker.changes(
        "project-1",
        "thread-1",
        fixture.workspace.path,
      )
    ).revision;

    await expect(
      fixture.manager.createDraftPullRequest(
        requestFor(fixture, revision),
        { title: "Task PR" },
      ),
    ).rejects.toThrow("Commit and push");

    fixture.provider.isPushed = true;
    const status = await fixture.manager.createDraftPullRequest(
      requestFor(fixture, revision),
      { title: "Task PR", body: "Reviewed in Threadlight" },
    );
    expect(fixture.provider.created).toEqual([
      {
        path: fixture.workspace.path,
        head: fixture.workspace.branch,
        base: "main",
        title: "Task PR",
        body: "Reviewed in Threadlight",
      },
    ]);
    expect(status.pullRequest?.draft).toBe(true);
  });

  it("does not publish Git-ignored local data to a branch", async () => {
    const fixture = await createFixture(false, true);
    writeFileSync(join(fixture.workspace.path, "data", "library.db"), "task data\n");
    const revision = (
      await fixture.tracker.changes(
        "project-1",
        "thread-1",
        fixture.workspace.path,
      )
    ).revision;

    await expect(
      fixture.manager.commitAndPush(
        requestFor(fixture, revision),
        "Publish local data",
      ),
    ).rejects.toThrow("only changed local data");
    expect(fixture.provider.pushed).toEqual([]);
  });
});

describe("GitHubCliProvider", () => {
  it("normalizes CI checks, reviews, and inline comments from scripted gh output", async () => {
    const commands: string[] = [];
    const provider = new GitHubCliProvider({
      run: async (command, args) => {
        const key = `${command} ${args.join(" ")}`;
        commands.push(key);
        if (key === "gh auth status") return output("");
        if (key === "gh repo view --json nameWithOwner") {
          return output('{"nameWithOwner":"acme/threadlight"}');
        }
        if (key.includes("git config branch.threadlight/task.remote")) {
          return output("origin\n");
        }
        if (key.includes("git show-ref --verify")) return output("");
        if (key === "git rev-list --count @{upstream}..HEAD") {
          return output("0\n");
        }
        if (key.startsWith("gh pr view threadlight/task")) {
          return output(
            JSON.stringify({
              number: 12,
              url: "https://github.test/acme/threadlight/pull/12",
              title: "Ship task",
              isDraft: true,
              state: "OPEN",
              headRefName: "threadlight/task",
              baseRefName: "main",
              reviewDecision: "CHANGES_REQUESTED",
              statusCheckRollup: [
                {
                  name: "test",
                  status: "COMPLETED",
                  conclusion: "FAILURE",
                  detailsUrl: "https://github.test/check/1",
                },
              ],
              reviews: [
                {
                  id: "review-1",
                  author: { login: "reviewer" },
                  body: "Please adjust this.",
                  state: "CHANGES_REQUESTED",
                  submittedAt: "2026-07-30T10:00:00Z",
                },
              ],
              comments: [],
            }),
          );
        }
        if (key.includes("gh api repos/acme/threadlight/pulls/12/comments")) {
          return output(
            JSON.stringify([
              {
                id: 99,
                user: { login: "reviewer" },
                body: "Handle this edge case.",
                created_at: "2026-07-30T10:01:00Z",
                html_url: "https://github.test/comment/99",
                path: "src/index.ts",
                line: 42,
              },
            ]),
          );
        }
        throw new Error(`Unexpected command: ${key}`);
      },
    });

    const status = await provider.status(
      "/repository",
      "threadlight/task",
      "main",
    );

    expect(status).toMatchObject({
      available: true,
      repository: "acme/threadlight",
      pushed: true,
      pullRequest: {
        number: 12,
        ciStatus: "failure",
        reviewDecision: "CHANGES_REQUESTED",
        checks: [{ name: "test", status: "failure" }],
        comments: [
          {
            id: "99",
            kind: "inline",
            path: "src/index.ts",
            line: 42,
          },
          { id: "review-1", kind: "review" },
        ],
      },
    });
    expect(commands).toContain("gh auth status");
  });

  it("creates pull requests with the Draft flag and explicit branches", async () => {
    const commands: string[] = [];
    const provider = new GitHubCliProvider({
      run: async (command, args) => {
        const key = `${command} ${args.join(" ")}`;
        commands.push(key);
        if (key.startsWith("gh pr create ")) return output("");
        if (key === "gh repo view --json nameWithOwner") {
          return output('{"nameWithOwner":"acme/threadlight"}');
        }
        if (key.startsWith("gh pr view ")) {
          return output(
            JSON.stringify({
              number: 7,
              url: "https://github.test/acme/threadlight/pull/7",
              title: "Draft task",
              isDraft: true,
              state: "OPEN",
              headRefName: "threadlight/task",
              baseRefName: "main",
              statusCheckRollup: [],
              reviews: [],
              comments: [],
            }),
          );
        }
        if (key.includes("/pulls/7/comments")) return output("[]");
        throw new Error(`Unexpected command: ${key}`);
      },
    });

    const pullRequest = await provider.createDraftPullRequest(
      "/repository",
      "threadlight/task",
      "main",
      { title: "Draft task", body: "Body" },
    );

    expect(pullRequest.draft).toBe(true);
    expect(commands[0]).toContain(
      "gh pr create --draft --head threadlight/task --base main",
    );
  });
});

class ScriptedProvider implements CodeHostProvider {
  isPushed = false;
  readonly pushed: Array<{ path: string; branch: string }> = [];
  readonly created: Array<{
    path: string;
    head: string;
    base: string;
    title: string;
    body?: string;
  }> = [];
  pullRequest?: CodeHostPullRequest;

  async status(
    _repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<CodeHostDeliveryStatus> {
    return {
      provider: "github",
      available: true,
      repository: "acme/repository",
      remote: "origin",
      taskBranch: headBranch,
      baseBranch,
      pushed: this.isPushed,
      ahead: this.isPushed ? 0 : 1,
      ...(this.pullRequest ? { pullRequest: this.pullRequest } : {}),
    };
  }

  async push(repositoryRoot: string, branch: string): Promise<void> {
    this.pushed.push({ path: repositoryRoot, branch });
    this.isPushed = true;
  }

  async createDraftPullRequest(
    repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
    input: { title: string; body?: string },
  ): Promise<CodeHostPullRequest> {
    this.created.push({
      path: repositoryRoot,
      head: headBranch,
      base: baseBranch,
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
    });
    this.pullRequest = {
      number: 1,
      url: "https://github.test/acme/repository/pull/1",
      title: input.title,
      state: "open",
      draft: true,
      headBranch,
      baseBranch,
      ciStatus: "none",
      checks: [],
      comments: [],
    };
    return this.pullRequest;
  }
}

async function createFixture(
  stageUnrelatedBeforeSnapshot = false,
  withLocalData = false,
) {
  const root = mkdtempSync(join(tmpdir(), "threadlight-code-host-"));
  directories.push(root);
  const repository = join(root, "repository");
  git(root, "init", "-b", "main", repository);
  git(repository, "config", "user.email", "threadlight@example.test");
  git(repository, "config", "user.name", "Threadlight Test");
  writeFileSync(join(repository, "notes.txt"), "base\n");
  writeFileSync(join(repository, "unrelated.txt"), "base unrelated\n");
  if (withLocalData) {
    writeFileSync(join(repository, ".gitignore"), "data/library.db\n");
    mkdirSync(join(repository, "data"), { recursive: true });
    writeFileSync(join(repository, "data", "library.db"), "original data\n");
  }
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Initial");
  const workspaceManager = new TaskWorkspaceManager(join(root, "worktrees"), {
    createId: () => "task",
  });
  const workspace = await workspaceManager.prepare("project-1", repository);
  if (workspace.mode !== "worktree") throw new Error("Expected worktree");
  if (stageUnrelatedBeforeSnapshot) {
    writeFileSync(join(workspace.path, "unrelated.txt"), "unrelated\n");
    git(workspace.path, "add", "unrelated.txt");
  }
  const tracker = new ConversationChangeTracker(join(root, "snapshots"));
  await tracker.ensureSnapshot("project-1", "thread-1", workspace.path);
  const provider = new ScriptedProvider();
  return {
    repository,
    workspace,
    tracker,
    provider,
    manager: new CodeHostDeliveryManager(tracker, provider),
  };
}

function requestFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  revision: string,
) {
  return {
    projectId: "project-1",
    threadId: "thread-1",
    revision,
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

function output(stdout: string) {
  return { stdout, stderr: "" };
}
