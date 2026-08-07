import type { RefObject } from "react";
import {
  CalendarClock,
  PanelLeftClose,
  Settings,
  SquarePen,
} from "lucide-react";

import { useI18n } from "../../i18n.js";
import type {
  ConversationSummary,
  HostSummary,
  ProjectSummary,
  ProjectsSnapshot,
} from "../../projects.js";
import type { SessionState } from "../task-session/session.js";
import {
  connectionLabel,
  shortId,
} from "../task-session/conversation-content.js";
import type { AppView } from "./controller.js";
import {
  ProjectGroup,
  ProjectListHeading,
  RecentTasksGroup,
  RuntimeStatusControl,
} from "./project-sidebar.js";

interface ConversationNavigationUpdate {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface NavigationSidebarProps {
  open: boolean;
  mobile: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  currentProject?: ProjectSummary;
  connection: SessionState["connection"];
  threadId?: string;
  fallbackTaskTitle?: string;
  disabled: boolean;
  automationsEnabled: boolean;
  view: AppView;
  projectsAvailable: boolean;
  projects?: ProjectsSnapshot;
  sidebarProjects: readonly ProjectSummary[];
  standaloneProject?: ProjectSummary;
  runningThreadIds: readonly string[];
  computerThreadId?: string;
  searchAvailable: boolean;
  memoryEnabled: boolean;
  securityEnabled: boolean;
  diagnosticsEnabled: boolean;
  canRevealProjects: boolean;
  canUpdateProjects: boolean;
  canDeleteProjects: boolean;
  settingsEnabled: boolean;
  currentHost?: HostSummary;
  canConnectRemote: boolean;
  searchTriggerRef: RefObject<HTMLButtonElement | null>;
  onHide(): void;
  onCreateTask(): void;
  onNavigate(view: AppView): void;
  onSearch(): void;
  onOpenProject(): void;
  onCreateProjectTask(projectId: string): void;
  onOpenProjectView(
    projectId: string,
    view: "memory" | "security" | "diagnostics",
  ): void;
  onRevealProject(project: ProjectSummary): void;
  onToggleProjectPinned(project: ProjectSummary): Promise<void>;
  onDeleteProject(project: ProjectSummary): void;
  onSelectConversation(projectId: string, threadId?: string): void;
  onUpdateConversation(
    projectId: string,
    conversation: ConversationSummary,
    update: ConversationNavigationUpdate,
  ): Promise<void>;
  onDeleteConversation(
    projectId: string,
    conversation: ConversationSummary,
  ): void;
  onOpenRemoteRuntime(): void;
}

export function NavigationSidebar({
  open,
  mobile,
  closeButtonRef,
  currentProject,
  connection,
  threadId,
  fallbackTaskTitle,
  disabled,
  automationsEnabled,
  view,
  projectsAvailable,
  projects,
  sidebarProjects,
  standaloneProject,
  runningThreadIds,
  computerThreadId,
  searchAvailable,
  memoryEnabled,
  securityEnabled,
  diagnosticsEnabled,
  canRevealProjects,
  canUpdateProjects,
  canDeleteProjects,
  settingsEnabled,
  currentHost,
  canConnectRemote,
  searchTriggerRef,
  onHide,
  onCreateTask,
  onNavigate,
  onSearch,
  onOpenProject,
  onCreateProjectTask,
  onOpenProjectView,
  onRevealProject,
  onToggleProjectPinned,
  onDeleteProject,
  onSelectConversation,
  onUpdateConversation,
  onDeleteConversation,
  onOpenRemoteRuntime,
}: NavigationSidebarProps) {
  const { t } = useI18n();

  return (
    <>
      {mobile && open && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t("hideSidebar")}
          onClick={onHide}
        />
      )}
      <aside id="app-sidebar" className="sidebar" aria-hidden={!open}>
        <div className="window-drag-region" />
        <button
          ref={closeButtonRef}
          type="button"
          className="sidebar-collapse-button pressable"
          aria-label={t("hideSidebar")}
          title={t("hideSidebar")}
          onClick={onHide}
        >
          <PanelLeftClose size={16} />
        </button>
        <button
          className="new-thread-button project-row pressable"
          onClick={onCreateTask}
          disabled={!currentProject || connection !== "ready" || disabled}
        >
          <SquarePen size={16} />
          <span>{t("newTask")}</span>
        </button>
        {automationsEnabled &&
          currentProject &&
          currentProject.scope !== "standalone" && (
            <div className="sidebar-primary-nav">
              <button
                type="button"
                className={`scheduled-button project-row pressable ${view === "automations" ? "active" : ""}`}
                aria-current={view === "automations" ? "page" : undefined}
                disabled={disabled}
                onClick={() => onNavigate("automations")}
              >
                <CalendarClock size={16} />
                <span>{t("scheduled")}</span>
              </button>
            </div>
          )}

        <nav className="thread-list" aria-label={t("projectsAndTasks")}>
          {projectsAvailable ? (
            <>
              <ProjectListHeading
                searchTriggerRef={searchTriggerRef}
                searchDisabled={!searchAvailable || !currentProject || disabled}
                addDisabled={disabled}
                onSearch={onSearch}
                onAdd={onOpenProject}
              />
              <div className="project-list-scroll">
                {sidebarProjects.map((project) => (
                  <ProjectGroup
                    key={project.id}
                    project={project}
                    active={project.id === projects?.activeProjectId}
                    activeThreadId={threadId}
                    runningThreadIds={runningThreadIds}
                    computerThreadId={computerThreadId}
                    disabled={disabled}
                    onNewTask={() => onCreateProjectTask(project.id)}
                    onOpenMemory={
                      memoryEnabled
                        ? () => onOpenProjectView(project.id, "memory")
                        : undefined
                    }
                    onOpenSecurity={
                      securityEnabled
                        ? () => onOpenProjectView(project.id, "security")
                        : undefined
                    }
                    onRevealInFinder={
                      project.runtime?.kind !== "remote" && canRevealProjects
                        ? () => onRevealProject(project)
                        : undefined
                    }
                    onToggleProjectPinned={
                      canUpdateProjects
                        ? () => onToggleProjectPinned(project)
                        : undefined
                    }
                    onOpenDiagnostics={
                      diagnosticsEnabled
                        ? () => onOpenProjectView(project.id, "diagnostics")
                        : undefined
                    }
                    onDeleteProject={
                      canDeleteProjects
                        ? () => onDeleteProject(project)
                        : undefined
                    }
                    onSelect={(selectedThreadId) =>
                      onSelectConversation(project.id, selectedThreadId)
                    }
                    onRename={(conversation, title) =>
                      onUpdateConversation(project.id, conversation, { title })
                    }
                    onTogglePinned={(conversation) =>
                      onUpdateConversation(project.id, conversation, {
                        pinned: !conversation.pinnedAt,
                      })
                    }
                    onArchive={(conversation, archived) =>
                      onUpdateConversation(project.id, conversation, {
                        archived,
                      })
                    }
                    onDelete={(conversation) =>
                      onDeleteConversation(project.id, conversation)
                    }
                  />
                ))}
                {standaloneProject &&
                  standaloneProject.conversations.some(
                    (conversation) => !conversation.archivedAt,
                  ) && (
                    <RecentTasksGroup
                      project={standaloneProject}
                      active={
                        standaloneProject.id === projects?.activeProjectId
                      }
                      activeThreadId={threadId}
                      runningThreadIds={runningThreadIds}
                      computerThreadId={computerThreadId}
                      disabled={disabled}
                      onSelect={(selectedThreadId) =>
                        onSelectConversation(
                          standaloneProject.id,
                          selectedThreadId,
                        )
                      }
                      onRename={(conversation, title) =>
                        onUpdateConversation(
                          standaloneProject.id,
                          conversation,
                          { title },
                        )
                      }
                      onTogglePinned={(conversation) =>
                        onUpdateConversation(
                          standaloneProject.id,
                          conversation,
                          { pinned: !conversation.pinnedAt },
                        )
                      }
                      onArchive={(conversation, archived) =>
                        onUpdateConversation(
                          standaloneProject.id,
                          conversation,
                          { archived },
                        )
                      }
                      onDelete={(conversation) =>
                        onDeleteConversation(standaloneProject.id, conversation)
                      }
                    />
                  )}
                {sidebarProjects.length === 0 &&
                !standaloneProject?.conversations.some(
                  (conversation) => !conversation.archivedAt,
                ) ? (
                  <div className="thread-placeholder">
                    {t("openFolderToStart")}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="section-label">{t("current")}</p>
              {threadId ? (
                <div className="thread-item active" aria-current="page">
                  <span className="thread-title">
                    {fallbackTaskTitle || t("task")}
                  </span>
                  <span className="thread-id">{shortId(threadId)}</span>
                </div>
              ) : (
                <div className="thread-placeholder">{t("preparingTask")}</div>
              )}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          {settingsEnabled && (
            <button
              type="button"
              className={`settings-nav-button pressable ${view === "settings" ? "active" : ""}`}
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => onNavigate("settings")}
            >
              <Settings size={15} />
              {t("settings")}
            </button>
          )}
          <RuntimeStatusControl
            status={currentProject || !projectsAvailable ? connection : "idle"}
            label={
              currentHost?.name ??
              (currentProject || !projectsAvailable
                ? connectionLabel(connection, t)
                : t("noProjectOpen"))
            }
            mode={`${currentHost?.kind === "remote" ? t("remoteHost") : t("local")} · ${
              currentProject || !projectsAvailable
                ? connectionLabel(connection, t)
                : t("noProjectOpen")
            }`}
            disabled={disabled}
            title={t("connectRemoteRuntime")}
            onOpen={canConnectRemote ? onOpenRemoteRuntime : undefined}
          />
        </div>
      </aside>
    </>
  );
}
