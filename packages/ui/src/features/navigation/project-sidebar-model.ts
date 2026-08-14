import type { ProjectSummary } from "../../projects.js";
import type { ComputerShareSnapshot } from "../shared/adapters.js";

export type TaskListFilter =
  "all" | "running" | "pending" | "completed" | "archived";

export function filterProjectsForTaskList(
  projects: readonly ProjectSummary[],
  query: string,
  filter: TaskListFilter,
  runningThreadIds: readonly string[],
): ProjectSummary[] {
  const normalizedQuery = query.trim().toLowerCase();
  const running = new Set(runningThreadIds);
  return projects.flatMap((project) => {
    const projectMatches = [
      project.name,
      ...(project.scope === "standalone"
        ? [
            "standalone",
            "not in project",
            "不在项目中",
            "不在專案中",
            "プロジェクト外",
            "프로젝트에 속하지 않음",
          ]
        : []),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
    const conversations = project.conversations.filter((conversation) => {
      const archived = Boolean(conversation.archivedAt);
      if (filter === "archived") {
        if (!archived) return false;
      } else {
        if (archived) return false;
        if (filter === "running" && !running.has(conversation.id)) return false;
        if (
          filter === "pending" &&
          (running.has(conversation.id) || conversation.status !== "pending")
        )
          return false;
        if (
          filter === "completed" &&
          (running.has(conversation.id) ||
            (conversation.status ?? "completed") !== "completed")
        )
          return false;
      }
      return (
        !normalizedQuery ||
        projectMatches ||
        conversation.title.toLowerCase().includes(normalizedQuery)
      );
    });
    const filterActive = filter !== "all";
    if (
      conversations.length === 0 &&
      (filterActive || (normalizedQuery && !projectMatches))
    )
      return [];
    return [{ ...project, conversations }];
  });
}

export function showsProjectLevelActivity(
  expanded: boolean,
  active: boolean,
): boolean {
  return active && !expanded;
}

export function conversationContextChanged(
  currentProjectId: string | undefined,
  currentThreadId: string | undefined,
  nextProjectId: string | undefined,
  nextThreadId: string | undefined,
): boolean {
  return currentProjectId !== nextProjectId || currentThreadId !== nextThreadId;
}

export function ownsActiveComputerShare(
  snapshot: ComputerShareSnapshot | undefined,
  threadId: string | undefined,
): snapshot is ComputerShareSnapshot {
  return !!snapshot?.active && snapshot.ownerThreadId === threadId;
}
