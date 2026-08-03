import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ConversationChangeTracker } from "./conversation-changes.js";
import type { GitTaskWorkspace } from "./task-workspace.js";

const execFileAsync = promisify(execFile);
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface CodeHostCheck {
  name: string;
  status: "queued" | "running" | "success" | "failure" | "skipped";
  url?: string;
}

export interface CodeHostReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  path?: string;
  line?: number;
  kind: "comment" | "review" | "inline";
  state?: string;
}

export interface CodeHostPullRequest {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headBranch: string;
  baseBranch: string;
  ciStatus: "none" | "pending" | "success" | "failure";
  reviewDecision?: string;
  checks: readonly CodeHostCheck[];
  comments: readonly CodeHostReviewComment[];
}

export interface CodeHostDeliveryStatus {
  provider: "github";
  available: boolean;
  reason?: string;
  repository?: string;
  remote?: string;
  taskBranch: string;
  baseBranch: string;
  pushed: boolean;
  ahead: number;
  pullRequest?: CodeHostPullRequest;
}

export interface CodeHostDeliveryRequest {
  projectId: string;
  threadId: string;
  revision: string;
  workspace: GitTaskWorkspace;
}

export interface CodeHostCommitPushResult {
  commit: string;
  status: CodeHostDeliveryStatus;
}

export interface CodeHostPullRequestInput {
  title: string;
  body?: string;
}

export interface CodeHostProvider {
  status(
    repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
  ): Promise<CodeHostDeliveryStatus>;
  push(
    repositoryRoot: string,
    branch: string,
  ): Promise<void>;
  createDraftPullRequest(
    repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
    input: CodeHostPullRequestInput,
  ): Promise<CodeHostPullRequest>;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

export interface CodeHostDeliveryManagerOptions {
  run?: CommandRunner;
}

export class CodeHostDeliveryManager {
  private readonly run: CommandRunner;

  constructor(
    private readonly changes: ConversationChangeTracker,
    private readonly provider: CodeHostProvider,
    options: CodeHostDeliveryManagerOptions = {},
  ) {
    this.run = options.run ?? runCommand;
  }

  status(request: CodeHostDeliveryRequest): Promise<CodeHostDeliveryStatus> {
    assertRequest(request);
    return this.provider.status(
      request.workspace.path,
      request.workspace.branch,
      baseBranch(request.workspace),
    );
  }

  async commitAndPush(
    request: CodeHostDeliveryRequest,
    message: string,
  ): Promise<CodeHostCommitPushResult> {
    assertRequest(request);
    const commitMessage = message.trim();
    if (!commitMessage) throw new Error("Commit message cannot be empty");
    const files = await this.changes.deliveryFiles(
      request.projectId,
      request.threadId,
      request.workspace.path,
      request.revision,
    );
    if (files.length === 0) {
      throw new Error("This task has no reviewed changes to publish");
    }
    const paths = files
      .filter((file) => !file.localOnly)
      .map((file) => safeGitPath(file.path));
    if (paths.length === 0) {
      throw new Error(
        "This task only changed local data ignored by Git. Apply it to the original workspace instead of publishing a branch.",
      );
    }
    const status = await this.run(
      "git",
      ["status", "--porcelain", "--", ...paths],
      request.workspace.path,
    );
    if (status.stdout.trim()) {
      await this.run(
        "git",
        ["add", "-A", "--", ...paths],
        request.workspace.path,
      );
      await this.run(
        "git",
        ["commit", "--only", "-m", commitMessage, "--", ...paths],
        request.workspace.path,
      );
    }
    const { stdout } = await this.run(
      "git",
      ["rev-parse", "HEAD"],
      request.workspace.path,
    );
    await this.provider.push(
      request.workspace.path,
      request.workspace.branch,
    );
    return {
      commit: stdout.trim(),
      status: await this.status(request),
    };
  }

  async createDraftPullRequest(
    request: CodeHostDeliveryRequest,
    input: CodeHostPullRequestInput,
  ): Promise<CodeHostDeliveryStatus> {
    assertRequest(request);
    const title = input.title.trim();
    if (!title) throw new Error("Pull request title cannot be empty");
    const current = await this.status(request);
    if (!current.available) {
      throw new Error(current.reason ?? "GitHub delivery is not available");
    }
    if (!current.pushed) {
      throw new Error("Commit and push the task branch before creating a PR");
    }
    if (current.pullRequest) return current;
    await this.provider.createDraftPullRequest(
      request.workspace.path,
      request.workspace.branch,
      baseBranch(request.workspace),
      { title, ...(input.body?.trim() ? { body: input.body.trim() } : {}) },
    );
    return this.status(request);
  }
}

function baseBranch(workspace: GitTaskWorkspace): string {
  const branch = workspace.sourceBranch?.trim();
  if (!branch) {
    throw new Error("The task does not have an original branch for its PR base");
  }
  return branch;
}

function assertRequest(request: CodeHostDeliveryRequest): void {
  if (!request.revision.trim()) throw new Error("A reviewed revision is required");
  if (!request.workspace.branch.startsWith("threadlight/")) {
    throw new Error("Only managed task branches can be published");
  }
}

function safeGitPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("A reviewed path escapes the task workspace");
  }
  return normalized;
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
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}
