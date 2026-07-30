import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  CodeHostCheck,
  CodeHostDeliveryStatus,
  CodeHostProvider,
  CodeHostPullRequest,
  CodeHostPullRequestInput,
  CodeHostReviewComment,
  CommandRunner,
} from "./code-host-delivery.js";

const execFileAsync = promisify(execFile);
const MAX_GITHUB_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface GitHubCliProviderOptions {
  run?: CommandRunner;
}

export class GitHubCliProvider implements CodeHostProvider {
  private readonly run: CommandRunner;

  constructor(options: GitHubCliProviderOptions = {}) {
    this.run = options.run ?? runCommand;
  }

  async status(
    repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<CodeHostDeliveryStatus> {
    try {
      await this.run("gh", ["auth", "status"], repositoryRoot);
      const repository = parseJson<{
        nameWithOwner: string;
      }>(
        (
          await this.run(
            "gh",
            ["repo", "view", "--json", "nameWithOwner"],
            repositoryRoot,
          )
        ).stdout,
      );
      const remote = await this.remote(repositoryRoot, headBranch);
      const pushed = await this.isPushed(repositoryRoot, headBranch, remote);
      const ahead = pushed
        ? await this.aheadCount(repositoryRoot)
        : await this.aheadOfBase(repositoryRoot, baseBranch);
      const pullRequest = pushed
        ? await this.pullRequest(
            repositoryRoot,
            repository.nameWithOwner,
            headBranch,
          )
        : undefined;
      return {
        provider: "github",
        available: true,
        repository: repository.nameWithOwner,
        remote,
        taskBranch: headBranch,
        baseBranch,
        pushed,
        ahead,
        ...(pullRequest ? { pullRequest } : {}),
      };
    } catch (error) {
      return {
        provider: "github",
        available: false,
        reason: commandError(error),
        taskBranch: headBranch,
        baseBranch,
        pushed: false,
        ahead: 0,
      };
    }
  }

  async push(
    repositoryRoot: string,
    branch: string,
  ): Promise<void> {
    const remote = await this.remote(repositoryRoot, branch);
    await this.run(
      "git",
      ["push", "--set-upstream", remote, branch],
      repositoryRoot,
    );
  }

  async createDraftPullRequest(
    repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
    input: CodeHostPullRequestInput,
  ): Promise<CodeHostPullRequest> {
    const args = [
      "pr",
      "create",
      "--draft",
      "--head",
      headBranch,
      "--base",
      baseBranch,
      "--title",
      input.title,
      "--body",
      input.body ?? "",
    ];
    await this.run("gh", args, repositoryRoot);
    const repository = parseJson<{ nameWithOwner: string }>(
      (
        await this.run(
          "gh",
          ["repo", "view", "--json", "nameWithOwner"],
          repositoryRoot,
        )
      ).stdout,
    );
    const pullRequest = await this.pullRequest(
      repositoryRoot,
      repository.nameWithOwner,
      headBranch,
    );
    if (!pullRequest) {
      throw new Error("GitHub created the PR but it could not be loaded");
    }
    return pullRequest;
  }

  private async remote(
    repositoryRoot: string,
    branch: string,
  ): Promise<string> {
    try {
      const { stdout } = await this.run(
        "git",
        ["config", `branch.${branch}.remote`],
        repositoryRoot,
      );
      if (stdout.trim()) return stdout.trim();
    } catch {
      // A new task branch normally has no upstream yet.
    }
    const { stdout } = await this.run(
      "git",
      ["remote"],
      repositoryRoot,
    );
    const remotes = stdout.split(/\s+/).filter(Boolean);
    if (remotes.includes("origin")) return "origin";
    if (remotes.length === 1) return remotes[0]!;
    throw new Error("Choose a Git remote by configuring the task branch upstream");
  }

  private async isPushed(
    repositoryRoot: string,
    branch: string,
    remote: string,
  ): Promise<boolean> {
    try {
      await this.run(
        "git",
        ["show-ref", "--verify", `refs/remotes/${remote}/${branch}`],
        repositoryRoot,
      );
      return true;
    } catch {
      return false;
    }
  }

  private async aheadCount(repositoryRoot: string): Promise<number> {
    try {
      const { stdout } = await this.run(
        "git",
        ["rev-list", "--count", "@{upstream}..HEAD"],
        repositoryRoot,
      );
      return Number.parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private async aheadOfBase(
    repositoryRoot: string,
    baseBranch: string,
  ): Promise<number> {
    const { stdout } = await this.run(
      "git",
      ["rev-list", "--count", `${baseBranch}..HEAD`],
      repositoryRoot,
    );
    return Number.parseInt(stdout.trim(), 10) || 0;
  }

  private async pullRequest(
    repositoryRoot: string,
    repository: string,
    headBranch: string,
  ): Promise<CodeHostPullRequest | undefined> {
    let detail: GitHubPullRequest;
    try {
      detail = parseJson<GitHubPullRequest>(
        (
          await this.run(
            "gh",
            [
              "pr",
              "view",
              headBranch,
              "--json",
              "number,url,title,isDraft,state,headRefName,baseRefName,reviewDecision,statusCheckRollup,reviews,comments",
            ],
            repositoryRoot,
          )
        ).stdout,
      );
    } catch (error) {
      if (/no pull requests found|could not resolve/i.test(commandError(error))) {
        return undefined;
      }
      throw error;
    }
    let inline: readonly GitHubInlineComment[] = [];
    try {
      const response = parseJson<
        readonly GitHubInlineComment[] | readonly GitHubInlineComment[][]
      >(
        (
          await this.run(
            "gh",
            [
              "api",
              `repos/${repository}/pulls/${detail.number}/comments`,
              "--paginate",
              "--slurp",
            ],
            repositoryRoot,
          )
        ).stdout || "[]",
      );
      inline =
        Array.isArray(response[0]) && response.every(Array.isArray)
          ? (response as readonly GitHubInlineComment[][]).flat()
          : (response as readonly GitHubInlineComment[]);
    } catch {
      // CI and review summaries remain useful if inline comments are not
      // available to the current GitHub token.
    }
    const checks = detail.statusCheckRollup.map(normalizeCheck);
    return {
      number: detail.number,
      url: detail.url,
      title: detail.title,
      state: normalizePrState(detail.state),
      draft: detail.isDraft,
      headBranch: detail.headRefName,
      baseBranch: detail.baseRefName,
      ciStatus: overallCiStatus(checks),
      ...(detail.reviewDecision
        ? { reviewDecision: detail.reviewDecision }
        : {}),
      checks,
      comments: [
        ...detail.reviews.map(normalizeReview),
        ...detail.comments.map(normalizeComment),
        ...inline.map(normalizeInlineComment),
      ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    };
  }
}

interface GitHubPullRequest {
  number: number;
  url: string;
  title: string;
  isDraft: boolean;
  state: string;
  headRefName: string;
  baseRefName: string;
  reviewDecision?: string;
  statusCheckRollup: readonly Record<string, unknown>[];
  reviews: readonly {
    id?: string;
    author?: { login?: string };
    body?: string;
    state?: string;
    submittedAt?: string;
    url?: string;
  }[];
  comments: readonly {
    id?: string;
    author?: { login?: string };
    body?: string;
    createdAt?: string;
    url?: string;
  }[];
}

interface GitHubInlineComment {
  id: number;
  user?: { login?: string };
  body?: string;
  created_at?: string;
  html_url?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
}

function normalizeCheck(check: Record<string, unknown>): CodeHostCheck {
  const conclusion = stringValue(check.conclusion ?? check.state).toLowerCase();
  const status = stringValue(check.status).toLowerCase();
  return {
    name:
      stringValue(check.name ?? check.context ?? check.workflowName) ||
      "GitHub check",
    status:
      conclusion === "success"
        ? "success"
        : conclusion === "skipped" || conclusion === "neutral"
          ? "skipped"
          : [
                "failure",
                "cancelled",
                "timed_out",
                "action_required",
                "error",
              ].includes(conclusion)
            ? "failure"
            : status === "in_progress" || status === "pending"
              ? "running"
              : "queued",
    ...(stringValue(check.detailsUrl ?? check.targetUrl)
      ? { url: stringValue(check.detailsUrl ?? check.targetUrl) }
      : {}),
  };
}

function overallCiStatus(
  checks: readonly CodeHostCheck[],
): CodeHostPullRequest["ciStatus"] {
  if (checks.length === 0) return "none";
  if (checks.some((check) => check.status === "failure")) return "failure";
  if (checks.some((check) => check.status === "queued" || check.status === "running")) {
    return "pending";
  }
  return "success";
}

function normalizeReview(
  review: GitHubPullRequest["reviews"][number],
): CodeHostReviewComment {
  return {
    id: review.id ?? `review:${review.submittedAt ?? "unknown"}`,
    author: review.author?.login ?? "unknown",
    body: review.body ?? "",
    createdAt: review.submittedAt ?? "",
    kind: "review",
    ...(review.url ? { url: review.url } : {}),
    ...(review.state ? { state: review.state } : {}),
  };
}

function normalizeComment(
  comment: GitHubPullRequest["comments"][number],
): CodeHostReviewComment {
  return {
    id: comment.id ?? `comment:${comment.createdAt ?? "unknown"}`,
    author: comment.author?.login ?? "unknown",
    body: comment.body ?? "",
    createdAt: comment.createdAt ?? "",
    kind: "comment",
    ...(comment.url ? { url: comment.url } : {}),
  };
}

function normalizeInlineComment(
  comment: GitHubInlineComment,
): CodeHostReviewComment {
  const line = comment.line ?? comment.original_line ?? undefined;
  return {
    id: String(comment.id),
    author: comment.user?.login ?? "unknown",
    body: comment.body ?? "",
    createdAt: comment.created_at ?? "",
    kind: "inline",
    ...(comment.html_url ? { url: comment.html_url } : {}),
    ...(comment.path ? { path: comment.path } : {}),
    ...(line !== undefined ? { line } : {}),
  };
}

function normalizePrState(value: string): CodeHostPullRequest["state"] {
  const normalized = value.toLowerCase();
  if (normalized === "merged") return "merged";
  if (normalized === "closed") return "closed";
  return "open";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJson<Result>(value: string): Result {
  return JSON.parse(value) as Result;
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      LC_ALL: "C",
    },
    maxBuffer: MAX_GITHUB_OUTPUT_BYTES,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function commandError(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = "stderr" in error ? String(error.stderr).trim() : "";
    if (stderr) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}
