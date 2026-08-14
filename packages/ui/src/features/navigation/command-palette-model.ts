import type { CommandPaletteEntry } from "../../command-palette.js";
import type { Translate } from "../../i18n.js";
import type { ProjectsSnapshot } from "../../projects.js";

export function commandPaletteActions({
  projectStandalone,
  memoryAvailable,
  workspaceAvailable,
  workspaceOpen,
  terminalAvailable,
  terminalOpen,
  diagnosticsAvailable,
  automationsAvailable,
  settingsAvailable,
  t,
}: {
  projectStandalone: boolean;
  memoryAvailable: boolean;
  workspaceAvailable: boolean;
  workspaceOpen: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  diagnosticsAvailable: boolean;
  automationsAvailable: boolean;
  settingsAvailable: boolean;
  t: Translate;
}): CommandPaletteEntry[] {
  return [
    {
      id: "action:new-task",
      kind: "action",
      actionId: "new-task",
      title: t("newTask"),
      subtitle: t("commandNewTaskDescription"),
      keywords: "new create task thread",
    },
    ...(memoryAvailable && !projectStandalone
      ? [
          {
            id: "action:memory",
            kind: "action" as const,
            actionId: "memory",
            title: t("projectMemory"),
            subtitle: t("commandMemoryDescription"),
            keywords: "memory context",
          },
        ]
      : []),
    ...(workspaceAvailable
      ? [
          {
            id: "action:review",
            kind: "action" as const,
            actionId: "review",
            title: t("reviewTaskChanges"),
            subtitle: t("commandReviewDescription"),
            keywords: "diff changes review",
          },
          {
            id: "action:workspace",
            kind: "action" as const,
            actionId: "workspace",
            title: workspaceOpen ? t("closeRightPanel") : t("openRightPanel"),
            subtitle: t("commandWorkspaceDescription"),
            keywords: "files panel workspace",
          },
        ]
      : []),
    ...(terminalAvailable
      ? [
          {
            id: "action:terminal",
            kind: "action" as const,
            actionId: "terminal",
            title: terminalOpen ? t("closeTerminal") : t("openTerminal"),
            subtitle: t("commandTerminalDescription"),
            keywords: "shell command terminal",
          },
        ]
      : []),
    ...(diagnosticsAvailable
      ? [
          {
            id: "action:diagnostics",
            kind: "action" as const,
            actionId: "diagnostics",
            title: t("usageDiagnostics"),
            subtitle: t("commandDiagnosticsDescription"),
            keywords: "usage diagnostics tokens",
          },
        ]
      : []),
    ...(automationsAvailable && !projectStandalone
      ? [
          {
            id: "action:automations",
            kind: "action" as const,
            actionId: "automations",
            title: t("automations"),
            subtitle: t("commandAutomationsDescription"),
            keywords:
              "automation schedule recurring cron tests dependencies issues",
          },
        ]
      : []),
    ...(settingsAvailable
      ? [
          {
            id: "action:settings",
            kind: "action" as const,
            actionId: "settings",
            title: t("settings"),
            subtitle: t("commandSettingsDescription"),
            keywords: "preferences provider model theme language",
          },
        ]
      : []),
  ];
}

export function commandPaletteTasks(
  snapshot: ProjectsSnapshot | undefined,
  runningThreadIds: readonly string[],
  t: Translate,
): CommandPaletteEntry[] {
  return (
    snapshot?.projects.flatMap((project) =>
      project.conversations.map((item) => ({
        id: `task:${project.id}:${item.id}`,
        kind: "task" as const,
        projectId: project.id,
        threadId: item.id,
        title: item.title,
        subtitle: `${project.scope === "standalone" ? t("notInProject") : project.name} · ${taskStatus(item, runningThreadIds, t)}`,
        keywords: `${project.name} ${
          project.scope === "standalone"
            ? "standalone not in project 不在项目中 不在專案中 プロジェクト外 프로젝트"
            : ""
        } ${item.archivedAt ? "archived" : item.status}`,
      })),
    ) ?? []
  );
}

function taskStatus(
  item: ProjectsSnapshot["projects"][number]["conversations"][number],
  runningThreadIds: readonly string[],
  t: Translate,
): string {
  if (item.archivedAt) return t("archivedTasks");
  if (runningThreadIds.includes(item.id)) return t("runningTasks");
  if (item.status === "pending") return t("pendingTasks");
  if (item.status === "attention") return t("needsAttention");
  return t("completedTasks");
}
