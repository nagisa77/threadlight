import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";

import type {
  HostProjectSummary,
  TerminalWorkspaceScope,
} from "@threadlight/protocol";

export interface TerminalWorkspaceContext {
  cwd: string;
  branch?: string;
}

export function resolveTerminalWorkspace(
  project: HostProjectSummary,
  threadId?: string,
  workspace: TerminalWorkspaceScope = "task",
): TerminalWorkspaceContext {
  const conversation =
    workspace === "task" && threadId
      ? project.conversations.find(({ id }) => id === threadId)
      : undefined;
  if (workspace === "task" && threadId && !conversation) {
    throw new Error(`Unknown conversation: ${threadId}`);
  }

  const taskWorkspace = conversation?.workspace;
  const directory = realpathSync(
    workspace === "task" && taskWorkspace
      ? taskWorkspace.path
      : project.scope === "standalone"
        ? homedir()
        : project.basePath,
  );
  if (!statSync(directory).isDirectory()) {
    throw new Error("Terminal workspace is not a directory");
  }

  const branch = currentGitBranch(directory);
  return {
    cwd: directory,
    ...(branch
      ? { branch }
      : taskWorkspace?.mode === "worktree"
        ? { branch: taskWorkspace.branch }
        : {}),
  };
}

function currentGitBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync(
      "git",
      ["-C", cwd, "branch", "--show-current"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      },
    ).trim();
    return branch || "detached HEAD";
  } catch {
    return undefined;
  }
}
