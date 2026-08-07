import type { TerminalWorkspaceScope } from "@threadlight/protocol";

import type { Translate } from "./i18n.js";

export function scopeFor({
  projectScope,
  threadId,
  workspaceMode,
}: {
  projectScope?: "project" | "standalone";
  threadId?: string;
  workspaceMode?: "folder" | "standalone" | "worktree";
}): TerminalWorkspaceScope {
  if (projectScope === "standalone" && threadId) return "task";
  return workspaceMode === "worktree" ? "task" : "original";
}

export function terminalWorkspaceContextLabel(
  workspace: TerminalWorkspaceScope,
  branch: string | undefined,
  t: Translate,
): string {
  return t("terminalWorkspaceContext", {
    workspace: t(workspace === "task" ? "taskWorktree" : "originalWorkspace"),
    branch: branch?.trim() || t("unknownBranch"),
  });
}

export function terminalTabLabel(
  workspace: TerminalWorkspaceScope,
  branch: string | undefined,
  number: number | undefined,
  t: Translate,
): string {
  const context = terminalWorkspaceContextLabel(workspace, branch, t);
  return number === undefined ? context : `${context} · ${number}`;
}
