import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  NotebookText,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Server,
  ShieldCheck,
  SquarePen,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { useI18n, type Translate } from "../i18n.js";
import {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "../popover.js";
import type {
  ConversationSummary,
  HostSummary,
  ProjectSummary,
} from "../projects.js";
import type { ComputerShareSnapshot } from "../app.js";
import { errorMessage } from "./conversation-content.js";

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
        ) {
          return false;
        }
        if (
          filter === "completed" &&
          (running.has(conversation.id) ||
            (conversation.status ?? "completed") !== "completed")
        ) {
          return false;
        }
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
    ) {
      return [];
    }
    return [{ ...project, conversations }];
  });
}

export function TaskSearchDialog({
  projects,
  query,
  filter,
  runningThreadIds,
  activeThreadId,
  onQueryChange,
  onFilterChange,
  onSelect,
  onClose,
}: {
  projects: readonly ProjectSummary[];
  query: string;
  filter: TaskListFilter;
  runningThreadIds: readonly string[];
  activeThreadId?: string;
  onQueryChange(query: string): void;
  onFilterChange(filter: TaskListFilter): void;
  onSelect(projectId: string, threadId: string): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const filteredProjects = filterProjectsForTaskList(
    projects,
    query,
    filter,
    runningThreadIds,
  );
  const resultCount = filteredProjects.reduce(
    (count, project) => count + project.conversations.length,
    0,
  );
  const running = new Set(runningThreadIds);
  const filters: readonly TaskListFilter[] = [
    "all",
    "running",
    "pending",
    "completed",
    "archived",
  ];

  useEffect(() => {
    input.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className="task-search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="task-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-search-title"
      >
        <h2 id="task-search-title" className="sr-only">
          {t("searchTasks")}
        </h2>
        <div className="task-search-dialog-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={t("searchTasks")}
            aria-label={t("searchTasks")}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="task-search-dialog-clear pressable"
              aria-label={t("clearSearch")}
              title={t("clearSearch")}
              onClick={() => {
                onQueryChange("");
                input.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            className="task-search-dialog-close pressable"
            aria-label={t("closeTaskSearch")}
            title={t("closeTaskSearch")}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div
          className="task-search-filters"
          role="tablist"
          aria-label={t("filterTasks")}
        >
          {filters.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === filter}
              className={`task-search-filter pressable ${candidate === filter ? "active" : ""}`}
              onClick={() => onFilterChange(candidate)}
            >
              {taskFilterLabel(candidate, t)}
            </button>
          ))}
        </div>
        <div
          className="task-search-results"
          aria-label={t("taskSearchResults", { count: resultCount })}
        >
          {resultCount === 0 ? (
            <div className="task-search-empty">
              <Search size={20} aria-hidden="true" />
              <span>{t("noMatchingTasks")}</span>
            </div>
          ) : (
            filteredProjects.map((project) => (
              <section className="task-search-project" key={project.id}>
                <h3>
                  {project.scope === "standalone" ? (
                    <X size={14} aria-hidden="true" />
                  ) : (
                    <Folder size={14} aria-hidden="true" />
                  )}
                  <span>
                    {project.scope === "standalone"
                      ? t("notInProject")
                      : project.name}
                  </span>
                  <small>{project.conversations.length}</small>
                </h3>
                {project.conversations.map((conversation) => {
                  const isRunning = running.has(conversation.id);
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`task-search-result pressable ${conversation.id === activeThreadId ? "active" : ""}`}
                      aria-current={
                        conversation.id === activeThreadId ? "page" : undefined
                      }
                      onClick={() => onSelect(project.id, conversation.id)}
                    >
                      <span className="task-search-result-icon">
                        {isRunning ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : conversation.archivedAt ? (
                          <Archive size={14} />
                        ) : conversation.status === "attention" ? (
                          <TriangleAlert size={14} />
                        ) : conversation.pinnedAt ? (
                          <Pin size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                      </span>
                      <span className="task-search-result-copy">
                        <strong>{conversation.title}</strong>
                        <small>
                          {isRunning
                            ? t("runningTasks")
                            : conversation.archivedAt
                              ? t("archivedTasks")
                              : conversation.status === "pending"
                                ? t("pendingTasks")
                                : conversation.status === "attention"
                                  ? t("needsAttention")
                                  : t("completedTasks")}
                        </small>
                      </span>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function taskFilterLabel(filter: TaskListFilter, t: Translate): string {
  if (filter === "running") return t("runningTasks");
  if (filter === "pending") return t("pendingTasks");
  if (filter === "completed") return t("completedTasks");
  if (filter === "archived") return t("archivedTasks");
  return t("allTasks");
}

export function ProjectListHeading({
  searchTriggerRef,
  searchDisabled,
  addDisabled,
  onSearch,
  onAdd,
}: {
  searchTriggerRef?: RefObject<HTMLButtonElement | null>;
  searchDisabled: boolean;
  addDisabled: boolean;
  onSearch(): void;
  onAdd(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="project-list-heading">
      <p className="section-label">{t("projects")}</p>
      <div className="project-heading-actions">
        <button
          ref={searchTriggerRef}
          type="button"
          className="icon-button pressable"
          aria-label={t("commandPalette")}
          title={`${t("commandPalette")}（⌘K）`}
          disabled={searchDisabled}
          onClick={onSearch}
        >
          <Search size={15} />
        </button>
        <button
          className="icon-button pressable"
          type="button"
          title={t("addProject")}
          aria-label={t("addProject")}
          disabled={addDisabled}
          onClick={onAdd}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

export function RuntimeStatusControl({
  status,
  label,
  mode,
  disabled,
  title,
  onOpen,
}: {
  status: "idle" | "connecting" | "ready" | "error";
  label: string;
  mode: string;
  disabled?: boolean;
  title?: string;
  onOpen?(): void;
}) {
  const content = (
    <>
      <span className={`status-dot ${status}`} aria-hidden="true" />
      <span className="runtime-status-label" title={label}>
        {label}
      </span>
      <span className="status-mode" title={mode}>
        {mode}
      </span>
      {onOpen ? (
        <ChevronRight
          className="runtime-status-chevron"
          size={13}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return onOpen ? (
    <button
      type="button"
      className="runtime-status-control pressable"
      disabled={disabled}
      aria-label={`${label} · ${mode}`}
      title={title}
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <div
      className="runtime-status-control static"
      role="status"
      aria-label={`${label} · ${mode}`}
    >
      {content}
    </div>
  );
}

export function RecentTasksGroup({
  project,
  active,
  activeThreadId,
  runningThreadIds = [],
  computerThreadId,
  disabled,
  onSelect,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  runningThreadIds?: readonly string[];
  computerThreadId?: string;
  disabled: boolean;
  onSelect(threadId: string): void;
  onRename?(conversation: ConversationSummary, title: string): Promise<void>;
  onTogglePinned?(conversation: ConversationSummary): Promise<void>;
  onArchive?(
    conversation: ConversationSummary,
    archived: boolean,
  ): Promise<void>;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const conversations = project.conversations.filter(
    (conversation) => !conversation.archivedAt,
  );

  return (
    <section className="recent-tasks-group" aria-label={t("recent")}>
      <button
        type="button"
        className="recent-tasks-heading pressable"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{t("recent")}</span>
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="recent-task-list">
          {conversations.map((conversation) => (
            <ProjectConversationItem
              key={conversation.id}
              conversation={conversation}
              active={active && conversation.id === activeThreadId}
              running={runningThreadIds.includes(conversation.id)}
              computerActive={conversation.id === computerThreadId}
              disabled={disabled}
              onSelect={() => onSelect(conversation.id)}
              onRename={
                onRename ? (title) => onRename(conversation, title) : undefined
              }
              onTogglePinned={
                onTogglePinned ? () => onTogglePinned(conversation) : undefined
              }
              onArchive={
                onArchive
                  ? (archived) => onArchive(conversation, archived)
                  : undefined
              }
              onDelete={onDelete ? () => onDelete(conversation) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ProjectGroup({
  project,
  active,
  activeThreadId,
  runningThreadIds = [],
  computerThreadId,
  disabled,
  forceExpanded = false,
  onNewTask,
  onOpenMemory,
  onOpenSecurity,
  onRevealInFinder,
  onToggleProjectPinned,
  onOpenDiagnostics,
  onDeleteProject,
  onSelect,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  runningThreadIds?: readonly string[];
  computerThreadId?: string;
  disabled: boolean;
  forceExpanded?: boolean;
  onNewTask?(): void | Promise<void>;
  onOpenMemory?(): void | Promise<void>;
  onOpenSecurity?(): void | Promise<void>;
  onRevealInFinder?(): void | Promise<void>;
  onToggleProjectPinned?(): Promise<void>;
  onOpenDiagnostics?(): void | Promise<void>;
  onDeleteProject?(): void | Promise<void>;
  onSelect(threadId?: string): void;
  onRename?(conversation: ConversationSummary, title: string): Promise<void>;
  onTogglePinned?(conversation: ConversationSummary): Promise<void>;
  onArchive?(
    conversation: ConversationSummary,
    archived: boolean,
  ): Promise<void>;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    transformOrigin: "top right",
  });
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState<string>();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const visibleExpanded = expanded || forceExpanded;
  const projectRunning = project.conversations.some((conversation) =>
    runningThreadIds.includes(conversation.id),
  );
  const projectUsingComputer = project.conversations.some(
    (conversation) => conversation.id === computerThreadId,
  );
  const projectAttention = project.conversations.some(
    (conversation) => conversation.status === "attention",
  );
  const projectUnread = project.conversations.some(
    (conversation) =>
      conversation.unread && conversation.status !== "attention",
  );
  const projectActionCount = [
    onNewTask,
    onOpenMemory,
    onOpenSecurity,
    onRevealInFinder,
    onToggleProjectPinned,
    onOpenDiagnostics,
    onDeleteProject,
  ].filter(Boolean).length;

  function toggleExpanded() {
    const nextExpanded = !visibleExpanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !active) onSelect(project.conversations[0]?.id);
  }

  const closeProjectMenu = useCallback(() => setMenuOpen(false), []);

  async function runProjectAction(action: () => void | Promise<void>) {
    if (menuBusy) return;
    setMenuBusy(true);
    setMenuError(undefined);
    try {
      await action();
      setMenuOpen(false);
    } catch (error) {
      setMenuError(errorMessage(error));
    } finally {
      setMenuBusy(false);
    }
  }

  return (
    <section
      className="project-group"
      aria-label={project.name}
      title={menuError}
    >
      {menuError && (
        <span className="sr-only" role="alert">
          {menuError}
        </span>
      )}
      <div className="project-row">
        <button
          type="button"
          className="project-row-select pressable"
          aria-current={active ? "location" : undefined}
          aria-expanded={visibleExpanded}
          disabled={disabled}
          title={
            project.runtime?.kind === "remote"
              ? `${project.runtime.endpoint} · ${project.runtime.workspacePath}`
              : project.basePath
          }
          onClick={toggleExpanded}
        >
          {project.runtime?.kind === "remote" ? (
            <Server size={16} />
          ) : visibleExpanded ? (
            <FolderOpen size={16} />
          ) : (
            <Folder size={16} />
          )}
          <span className="project-name">{project.name}</span>
          {(showsProjectLevelActivity(visibleExpanded, projectRunning) ||
            showsProjectLevelActivity(visibleExpanded, projectUsingComputer) ||
            showsProjectLevelActivity(visibleExpanded, projectAttention) ||
            showsProjectLevelActivity(visibleExpanded, projectUnread)) && (
            <span className="project-live-indicators">
              {showsProjectLevelActivity(visibleExpanded, projectRunning) && (
                <LoaderCircle
                  className="project-runtime-indicator spin"
                  size={13}
                  aria-label={t("projectTaskRunning", {
                    project: project.name,
                  })}
                />
              )}
              {showsProjectLevelActivity(
                visibleExpanded,
                projectUsingComputer,
              ) && (
                <ComputerUseIndicator
                  label={t("projectTaskUsingComputer", {
                    project: project.name,
                  })}
                />
              )}
              {showsProjectLevelActivity(visibleExpanded, projectAttention) && (
                <TriangleAlert
                  className="project-attention-indicator"
                  size={13}
                  aria-label={t("projectNeedsAttention", {
                    project: project.name,
                  })}
                />
              )}
              {showsProjectLevelActivity(visibleExpanded, projectUnread) && (
                <span
                  className="project-unread-indicator"
                  aria-label={t("projectTaskUnread", {
                    project: project.name,
                  })}
                />
              )}
            </span>
          )}
        </button>
        {projectActionCount > 0 && (
          <div className={`project-row-actions ${menuOpen ? "open" : ""}`}>
            <button
              ref={menuTrigger}
              type="button"
              className="project-row-action pressable"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("projectActions", { project: project.name })}
              title={t("projectActions", { project: project.name })}
              disabled={disabled || menuBusy}
              onClick={(event) => {
                const open = !menuOpen;
                if (open) {
                  setMenuError(undefined);
                  setMenuPosition(
                    anchoredPopoverPosition(
                      event.currentTarget.getBoundingClientRect(),
                      {
                        width: 218,
                        height: 10 + projectActionCount * 36,
                      },
                    ),
                  );
                }
                setMenuOpen(open);
              }}
            >
              {menuBusy ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <MoreHorizontal size={15} />
              )}
            </button>
            <button
              type="button"
              className="project-row-action pressable"
              aria-label={t("newTask")}
              title={t("newTask")}
              disabled={disabled || !onNewTask}
              onClick={onNewTask}
            >
              <SquarePen size={14} />
            </button>
          </div>
        )}
      </div>
      {menuOpen && (
        <ProjectActionPopover
          project={project}
          busy={menuBusy}
          position={menuPosition}
          returnFocusRef={menuTrigger}
          onClose={closeProjectMenu}
          onNewTask={
            onNewTask ? () => void runProjectAction(onNewTask) : undefined
          }
          onOpenMemory={
            onOpenMemory ? () => void runProjectAction(onOpenMemory) : undefined
          }
          onOpenSecurity={
            onOpenSecurity
              ? () => void runProjectAction(onOpenSecurity)
              : undefined
          }
          onRevealInFinder={
            onRevealInFinder
              ? () => void runProjectAction(onRevealInFinder)
              : undefined
          }
          onToggleProjectPinned={
            onToggleProjectPinned
              ? () => void runProjectAction(onToggleProjectPinned)
              : undefined
          }
          onOpenDiagnostics={
            onOpenDiagnostics
              ? () => void runProjectAction(onOpenDiagnostics)
              : undefined
          }
          onDeleteProject={
            onDeleteProject
              ? () => void runProjectAction(onDeleteProject)
              : undefined
          }
        />
      )}
      {visibleExpanded && (
        <div className="project-conversations">
          {project.conversations.map((conversation) => (
            <ProjectConversationItem
              key={conversation.id}
              conversation={conversation}
              active={active && conversation.id === activeThreadId}
              running={runningThreadIds.includes(conversation.id)}
              computerActive={conversation.id === computerThreadId}
              disabled={disabled}
              onSelect={() => onSelect(conversation.id)}
              onRename={
                onRename ? (title) => onRename(conversation, title) : undefined
              }
              onTogglePinned={
                onTogglePinned ? () => onTogglePinned(conversation) : undefined
              }
              onArchive={
                onArchive
                  ? (archived) => onArchive(conversation, archived)
                  : undefined
              }
              onDelete={onDelete ? () => onDelete(conversation) : undefined}
            />
          ))}
          {project.conversations.length === 0 && (
            <span className="project-empty-label">{t("noTasks")}</span>
          )}
        </div>
      )}
    </section>
  );
}

export function ProjectActionPopover({
  project,
  busy,
  position,
  returnFocusRef,
  onClose,
  onNewTask,
  onOpenMemory,
  onOpenSecurity,
  onRevealInFinder,
  onToggleProjectPinned,
  onOpenDiagnostics,
  onDeleteProject,
}: {
  project: ProjectSummary;
  busy: boolean;
  position: PopoverPosition;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onNewTask?(): void;
  onOpenMemory?(): void;
  onOpenSecurity?(): void;
  onRevealInFinder?(): void;
  onToggleProjectPinned?(): void;
  onOpenDiagnostics?(): void;
  onDeleteProject?(): void;
}) {
  const { t } = useI18n();
  return (
    <ActionPopover
      label={t("projectActions", { project: project.name })}
      position={position}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      {onNewTask && (
        <ActionPopoverItem
          icon={<SquarePen size={15} />}
          disabled={busy}
          onSelect={onNewTask}
        >
          {t("newTask")}
        </ActionPopoverItem>
      )}
      {onOpenMemory && (
        <ActionPopoverItem
          icon={<NotebookText size={15} />}
          disabled={busy}
          onSelect={onOpenMemory}
        >
          {t("manageProjectMemory")}
        </ActionPopoverItem>
      )}
      {onOpenSecurity && (
        <ActionPopoverItem
          icon={<ShieldCheck size={15} />}
          disabled={busy}
          onSelect={onOpenSecurity}
        >
          {t("safeExecution")}
        </ActionPopoverItem>
      )}
      {onRevealInFinder && (
        <ActionPopoverItem
          icon={<FolderOpen size={15} />}
          disabled={busy}
          onSelect={onRevealInFinder}
        >
          {t("revealInFinder")}
        </ActionPopoverItem>
      )}
      {onToggleProjectPinned && (
        <ActionPopoverItem
          icon={project.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
          disabled={busy}
          onSelect={onToggleProjectPinned}
        >
          {project.pinnedAt ? t("unpinProject") : t("pinProject")}
        </ActionPopoverItem>
      )}
      {onOpenDiagnostics && (
        <ActionPopoverItem
          icon={<Activity size={15} />}
          disabled={busy}
          onSelect={onOpenDiagnostics}
        >
          {t("usageDiagnostics")}
        </ActionPopoverItem>
      )}
      {onDeleteProject && (
        <ActionPopoverItem
          icon={<Trash2 size={15} />}
          disabled={busy}
          onSelect={onDeleteProject}
        >
          {t("deleteProject")}
        </ActionPopoverItem>
      )}
    </ActionPopover>
  );
}

export function ProjectConversationItem({
  conversation,
  active,
  running = false,
  computerActive = false,
  disabled,
  onSelect,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  running?: boolean;
  computerActive?: boolean;
  disabled: boolean;
  onSelect(): void;
  onRename?(title: string): Promise<void>;
  onTogglePinned?(): Promise<void>;
  onArchive?(archived: boolean): Promise<void>;
  onDelete?(): void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const menuRoot = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const manageable = Boolean(
    onRename || onTogglePinned || onArchive || onDelete,
  );

  useEffect(() => {
    if (!editing) setDraftTitle(conversation.title);
  }, [conversation.title, editing]);

  useEffect(() => {
    if (!editing) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event: globalThis.PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuRoot.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function runAction(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setMenuOpen(false);
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmRename() {
    const title = draftTitle.trim();
    if (!onRename || !title || busy) return;
    if (title === conversation.title) {
      setEditing(false);
      return;
    }
    if (await runAction(() => onRename(title))) setEditing(false);
  }

  return (
    <div
      className={`thread-item ${active ? "active" : ""} ${conversation.archivedAt ? "archived" : ""}`}
      title={actionError}
    >
      {actionError && (
        <span className="sr-only" role="alert">
          {actionError}
        </span>
      )}
      {editing ? (
        <form
          className="thread-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmRename();
          }}
        >
          <input
            ref={titleInput}
            value={draftTitle}
            maxLength={160}
            aria-label={t("renameTask")}
            disabled={busy}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraftTitle(conversation.title);
                setEditing(false);
              }
            }}
          />
          <button
            type="submit"
            className="thread-inline-action pressable"
            aria-label={t("saveRename")}
            title={t("saveRename")}
            disabled={busy || !draftTitle.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={12} />
            ) : (
              <Check size={12} />
            )}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="thread-item-select pressable"
          aria-current={active ? "page" : undefined}
          disabled={disabled}
          title={conversation.title}
          onClick={onSelect}
        >
          {conversation.pinnedAt && (
            <Pin
              className="thread-pinned-indicator"
              size={11}
              aria-label={t("pinnedTask")}
            />
          )}
          {conversation.archivedAt && (
            <Archive
              className="thread-archived-indicator"
              size={11}
              aria-label={t("archivedTask")}
            />
          )}
          <span className="thread-title">{conversation.title}</span>
          {conversation.status === "attention" && (
            <span
              className="thread-attention-badge"
              aria-label={t("taskNeedsAttention", {
                title: conversation.title,
              })}
            >
              <TriangleAlert size={10} aria-hidden="true" />
              {t("needsAttention")}
            </span>
          )}
          {(running ||
            computerActive ||
            (conversation.unread && conversation.status !== "attention")) && (
            <span className="thread-live-indicators">
              {running && (
                <LoaderCircle
                  className="thread-runtime-indicator spin"
                  size={13}
                  aria-label={t("taskRunning", { title: conversation.title })}
                />
              )}
              {computerActive && (
                <ComputerUseIndicator
                  label={t("taskUsingComputer", { title: conversation.title })}
                />
              )}
              {conversation.unread && conversation.status !== "attention" && (
                <span
                  className="thread-unread-indicator"
                  aria-label={t("taskUnread", { title: conversation.title })}
                />
              )}
            </span>
          )}
        </button>
      )}
      {manageable && !editing && !running && !computerActive && (
        <div ref={menuRoot} className="thread-actions">
          <button
            type="button"
            className="thread-action-button pressable"
            disabled={disabled || busy}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("taskActions", { title: conversation.title })}
            title={t("taskActions", { title: conversation.title })}
            onClick={(event) => {
              setActionError(undefined);
              const open = !menuOpen;
              if (open) {
                const bounds = event.currentTarget.getBoundingClientRect();
                const menuHeight = conversation.archivedAt ? 132 : 103;
                const top =
                  window.innerHeight - bounds.bottom >= menuHeight + 8
                    ? bounds.bottom + 4
                    : Math.max(8, bounds.top - menuHeight - 4);
                setMenuPosition({
                  top,
                  left: Math.max(8, bounds.right - 154),
                });
              }
              setMenuOpen(open);
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <MoreHorizontal size={14} />
            )}
          </button>
          {menuOpen && (
            <div
              className="thread-action-menu"
              role="menu"
              style={menuPosition}
            >
              {onRename && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                >
                  <PencilLine size={13} />
                  {t("renameTask")}
                </button>
              )}
              {onTogglePinned && !conversation.archivedAt && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runAction(onTogglePinned)}
                >
                  {conversation.pinnedAt ? (
                    <PinOff size={13} />
                  ) : (
                    <Pin size={13} />
                  )}
                  {conversation.pinnedAt ? t("unpinTask") : t("pinTask")}
                </button>
              )}
              {onArchive && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void runAction(() => onArchive(!conversation.archivedAt))
                  }
                >
                  {conversation.archivedAt ? (
                    <ArchiveRestore size={13} />
                  ) : (
                    <Archive size={13} />
                  )}
                  {conversation.archivedAt
                    ? t("restoreArchivedTask")
                    : t("archiveTask")}
                </button>
              )}
              {onDelete && conversation.archivedAt && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={13} />
                  {t("deletePermanently")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
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

function ComputerUseIndicator({ label }: { label: string }) {
  return (
    <span
      className="computer-use-indicator"
      role="img"
      aria-label={label}
      title={label}
    >
      <Monitor size={13} aria-hidden="true" />
      <span aria-hidden="true" />
    </span>
  );
}
