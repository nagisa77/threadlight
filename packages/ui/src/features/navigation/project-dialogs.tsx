import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type {
  HostDirectoryEntry,
  HostDirectoryListing,
} from "@threadlight/protocol";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Monitor,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n.js";
import { Dialog } from "../../dialog.js";
import {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "../../popover.js";
import type {
  ConversationSummary,
  HostSummary,
  HostsSnapshot,
  ProjectSummary,
} from "../../projects.js";
import { errorMessage } from "../task-session/conversation-content.js";

export function DeleteConversationDialog({
  conversation,
  discard = false,
  metadataOnly = false,
  localDataFiles = 0,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  conversation: ConversationSummary;
  discard?: boolean;
  metadataOnly?: boolean;
  localDataFiles?: number;
  deleting: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      className="delete-dialog"
      role="alertdialog"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
      initialFocusRef={cancelButton}
      dismissDisabled={deleting}
      onClose={onCancel}
    >
      <span className="delete-dialog-icon" aria-hidden="true">
        <Trash2 size={18} />
      </span>
      <div className="delete-dialog-copy">
        <h2 id="delete-dialog-title">
          {metadataOnly
            ? t("deleteTaskMetadataQuestion")
            : discard
              ? t("discardTaskQuestion")
              : t("deleteTaskQuestion")}
        </h2>
        <p id="delete-dialog-description">
          {metadataOnly
            ? t("deleteTaskMetadataDescription", {
                title: conversation.title,
              })
            : discard
              ? t("discardTaskConfirmDescription", {
                  title: conversation.title,
                })
              : t("deleteTaskDescription", { title: conversation.title })}
        </p>
        {discard && localDataFiles > 0 && (
          <p className="delete-dialog-warning">
            {t("discardLocalDataWarning", { count: localDataFiles })}
          </p>
        )}
        {error && <p className="delete-dialog-error">{error}</p>}
      </div>
      <div className="delete-dialog-actions">
        <button
          ref={cancelButton}
          type="button"
          className="dialog-button secondary pressable"
          disabled={deleting}
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          className="dialog-button danger pressable"
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting && <LoaderCircle className="spin" size={14} />}
          {deleting
            ? metadataOnly
              ? t("deletingTaskMetadata")
              : discard
                ? t("discardingTask")
                : t("deleting")
            : metadataOnly
              ? t("deleteTaskMetadata")
              : discard
                ? t("discardTask")
                : t("deleteTask")}
        </button>
      </div>
    </Dialog>
  );
}

export function DeleteProjectDialog({
  project,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  project: ProjectSummary;
  deleting: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      className="delete-dialog"
      role="alertdialog"
      aria-labelledby="delete-project-dialog-title"
      aria-describedby="delete-project-dialog-description"
      initialFocusRef={cancelButton}
      dismissDisabled={deleting}
      onClose={onCancel}
    >
      <span className="delete-dialog-icon" aria-hidden="true">
        <Trash2 size={18} />
      </span>
      <div className="delete-dialog-copy">
        <h2 id="delete-project-dialog-title">{t("deleteProjectQuestion")}</h2>
        <p id="delete-project-dialog-description">
          {t("deleteProjectDescription", { project: project.name })}
        </p>
        <p className="delete-dialog-hint">{t("deleteProjectKeepsData")}</p>
        {error && <p className="delete-dialog-error">{error}</p>}
      </div>
      <div className="delete-dialog-actions">
        <button
          ref={cancelButton}
          type="button"
          className="dialog-button secondary pressable"
          disabled={deleting}
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          className="dialog-button danger pressable"
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting && <LoaderCircle className="spin" size={14} />}
          {deleting ? t("deletingProject") : t("deleteProject")}
        </button>
      </div>
    </Dialog>
  );
}

export function ProjectEmptyState({
  error,
  opening,
  onOpen,
  onCreateStandalone,
  onConnectRemote,
}: {
  error?: string;
  opening: boolean;
  onOpen(): void;
  onCreateStandalone?(): void;
  onConnectRemote?(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="project-empty-state">
      <span className="project-empty-icon" aria-hidden="true">
        <FolderOpen size={23} />
      </span>
      <h1>{t("openProject")}</h1>
      <p>{t("openProjectDescription")}</p>
      {error && <p className="project-open-error">{error}</p>}
      <button
        type="button"
        className="project-open-button pressable"
        disabled={opening}
        onClick={onOpen}
      >
        {opening ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <FolderPlus size={15} />
        )}
        {opening ? t("opening") : t("openViaFolder")}
      </button>
      {onCreateStandalone && (
        <button
          type="button"
          className="project-remote-button pressable"
          disabled={opening}
          onClick={onCreateStandalone}
        >
          <X size={15} />
          {t("notInProject")}
        </button>
      )}
      {onConnectRemote && (
        <button
          type="button"
          className="project-remote-button pressable"
          disabled={opening}
          onClick={onConnectRemote}
        >
          <Server size={15} />
          {t("connectRemoteRuntime")}
        </button>
      )}
    </div>
  );
}

export function RemoteRuntimeDialog({
  hosts,
  activeHostId,
  busy,
  error,
  onCancel,
  onActivate,
  onUpdate,
  onDelete,
  onConnect,
  onResetError,
}: {
  hosts?: HostsSnapshot;
  activeHostId?: string;
  busy: boolean;
  error?: string;
  onCancel(): void;
  onActivate(hostId: string): void;
  onUpdate?(input: {
    hostId: string;
    endpoint: string;
    token?: string;
    name?: string;
  }): void;
  onDelete?(hostId: string): void;
  onConnect(input: { endpoint: string; token: string; name?: string }): void;
  onResetError?(): void;
}) {
  const { t } = useI18n();
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:7432");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [editingHostId, setEditingHostId] = useState<string>();
  const firstField = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (editingHostId && onUpdate) {
      onUpdate({
        hostId: editingHostId,
        endpoint: endpoint.trim(),
        ...(token.trim() ? { token } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      return;
    }
    onConnect({
      endpoint: endpoint.trim(),
      token,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
  }

  function editHost(host: HostSummary) {
    if (host.kind !== "remote" || !host.endpoint) return;
    setEditingHostId(host.id);
    setEndpoint(host.endpoint);
    setToken("");
    setName(host.name);
    onResetError?.();
    requestAnimationFrame(() => firstField.current?.focus());
  }

  function cancelEditing() {
    setEditingHostId(undefined);
    setEndpoint("http://127.0.0.1:7432");
    setToken("");
    setName("");
    onResetError?.();
    requestAnimationFrame(() => firstField.current?.focus());
  }

  return (
    <Dialog
      className="connector-dialog remote-runtime-dialog"
      aria-labelledby="remote-runtime-title"
      aria-describedby="remote-runtime-description"
      initialFocusRef={firstField}
      dismissDisabled={busy}
      onClose={onCancel}
    >
      <div className="connector-dialog-heading">
        <span className="connector-dialog-icon" aria-hidden="true">
          <Server size={18} />
        </span>
        <div>
          <h2 id="remote-runtime-title">{t("connectRemoteRuntime")}</h2>
          <p id="remote-runtime-description">{t("remoteRuntimeDescription")}</p>
        </div>
      </div>
      {hosts && hosts.hosts.length > 0 && (
        <div className="host-connection-list" aria-label={t("savedHosts")}>
          <p className="connector-section-label">{t("savedHosts")}</p>
          {hosts.hosts.map((host) => {
            const active = host.id === activeHostId;
            return (
              <div
                key={host.id}
                className={`host-connection-row ${active ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="host-connection-select pressable"
                  disabled={busy || active}
                  onClick={() => onActivate(host.id)}
                >
                  <span className="host-connection-icon" aria-hidden="true">
                    {host.kind === "local" ? (
                      <Monitor size={15} />
                    ) : (
                      <Server size={15} />
                    )}
                  </span>
                  <span className="host-connection-copy">
                    <strong>{host.name}</strong>
                    <small>
                      {host.kind === "local" ? t("localHost") : host.endpoint}
                    </small>
                  </span>
                  {active && <Check size={14} aria-label={t("current")} />}
                </button>
                {host.kind === "remote" && (onUpdate || onDelete) && (
                  <span className="host-connection-actions">
                    {onUpdate && (
                      <button
                        type="button"
                        className="host-connection-edit pressable"
                        aria-label={t("editHost", { name: host.name })}
                        title={t("editHost", { name: host.name })}
                        disabled={busy}
                        onClick={() => editHost(host)}
                      >
                        <PencilLine size={14} />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="host-connection-remove pressable"
                        aria-label={t("removeHost", { name: host.name })}
                        title={t("removeHost", { name: host.name })}
                        disabled={busy}
                        onClick={() => {
                          if (editingHostId === host.id) cancelEditing();
                          onDelete(host.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <form onSubmit={submit}>
        <p className="connector-section-label">
          {editingHostId ? t("editSavedHost") : t("connectNewHost")}
        </p>
        <div className="connector-fields">
          <label>
            <span>{t("remoteRuntimeEndpoint")}</span>
            <input
              ref={firstField}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              required
              disabled={busy}
            />
          </label>
          <label>
            <span>{t("remoteRuntimeToken")}</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              required={!editingHostId}
              disabled={busy}
              placeholder={
                editingHostId ? t("remoteRuntimeTokenKeep") : undefined
              }
            />
          </label>
          <label>
            <span>{t("remoteRuntimeName")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              disabled={busy}
              placeholder={t("remoteRuntimeNameOptional")}
            />
          </label>
        </div>
        <p className="remote-runtime-security">
          <ShieldAlert size={14} />
          {t("remoteRuntimeSecurity")}
        </p>
        {error && <p className="connector-dialog-error">{error}</p>}
        <div className="connector-dialog-actions">
          <button
            type="button"
            className="dialog-button secondary pressable"
            disabled={busy}
            onClick={editingHostId ? cancelEditing : onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="dialog-button primary pressable"
            disabled={
              busy || !endpoint.trim() || (!editingHostId && !token.trim())
            }
          >
            {busy && <LoaderCircle className="spin" size={14} />}
            {busy
              ? editingHostId
                ? t("saving")
                : t("connectingRuntime")
              : editingHostId
                ? t("saveChanges")
                : t("connect")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function RemoteProjectPathDialog({
  busy,
  error,
  hostName,
  onBrowse,
  onCancel,
  onOpen,
}: {
  busy: boolean;
  error?: string;
  hostName: string;
  onBrowse?(path: string): Promise<HostDirectoryListing>;
  onCancel(): void;
  onOpen(path: string): void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [directories, setDirectories] = useState<readonly HostDirectoryEntry[]>(
    [],
  );
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string>();
  const [directoryPosition, setDirectoryPosition] = useState<PopoverPosition>();
  const [directoryDismissed, setDirectoryDismissed] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const firstDirectory = useRef<HTMLButtonElement>(null);
  const browseRequest = useRef(0);

  useEffect(() => {
    if (
      !onBrowse ||
      directoryDismissed ||
      (!path.startsWith("/") && path !== "~" && !path.startsWith("~/"))
    ) {
      setDirectoryPosition(undefined);
      setDirectories([]);
      setDirectoryError(undefined);
      setDirectoryLoading(false);
      return;
    }

    const request = ++browseRequest.current;
    const timeout = window.setTimeout(() => {
      const bounds = firstField.current?.getBoundingClientRect();
      if (!bounds) return;
      setDirectoryPosition(
        anchoredPopoverPosition(bounds, {
          width: Math.min(440, Math.max(320, bounds.width)),
          height: 260,
          align: "start",
          gap: 5,
        }),
      );
      setDirectoryLoading(true);
      setDirectoryError(undefined);
      void Promise.resolve()
        .then(() => onBrowse(path))
        .then((listing) => {
          if (browseRequest.current !== request) return;
          setDirectories(listing.directories);
        })
        .catch((browseError) => {
          if (browseRequest.current !== request) return;
          setDirectories([]);
          setDirectoryError(errorMessage(browseError));
        })
        .finally(() => {
          if (browseRequest.current === request) {
            setDirectoryLoading(false);
          }
        });
    }, 120);
    return () => {
      window.clearTimeout(timeout);
      if (browseRequest.current === request) browseRequest.current += 1;
    };
  }, [directoryDismissed, onBrowse, path]);

  function selectDirectory(directory: HostDirectoryEntry) {
    setPath(
      directory.path.endsWith("/") ? directory.path : `${directory.path}/`,
    );
    setDirectoryDismissed(false);
    requestAnimationFrame(() => firstField.current?.focus());
  }

  return (
    <Dialog
      className="connector-dialog remote-project-dialog"
      aria-labelledby="remote-project-title"
      initialFocusRef={firstField}
      dismissDisabled={busy}
      onClose={onCancel}
    >
      <div className="connector-dialog-heading">
        <span className="connector-dialog-icon" aria-hidden="true">
          <FolderPlus size={18} />
        </span>
        <div>
          <h2 id="remote-project-title">{t("addRemoteProject")}</h2>
          <p>{t("addRemoteProjectDescription", { host: hostName })}</p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && path.trim()) onOpen(path.trim());
        }}
      >
        <div className="connector-fields">
          <label>
            <span>{t("remoteProjectPath")}</span>
            <input
              ref={firstField}
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
                setDirectoryDismissed(false);
              }}
              onFocus={() => setDirectoryDismissed(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && directoryPosition) {
                  event.preventDefault();
                  firstDirectory.current?.focus();
                } else if (event.key === "Escape" && directoryPosition) {
                  event.preventDefault();
                  event.stopPropagation();
                  setDirectoryDismissed(true);
                }
              }}
              placeholder="/home/user/projects/example"
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
            />
          </label>
        </div>
        {directoryPosition && (
          <ActionPopover
            label={t("remoteFolders")}
            className="remote-directory-popover"
            role="dialog"
            position={directoryPosition}
            initialFocusRef={firstField}
            returnFocusRef={firstField}
            onClose={() => setDirectoryDismissed(true)}
          >
            <div
              className="remote-directory-list"
              role="listbox"
              aria-label={t("remoteFolders")}
            >
              {directoryLoading ? (
                <p className="remote-directory-status" role="status">
                  <LoaderCircle className="spin" size={14} />
                  {t("loadingFolders")}
                </p>
              ) : directoryError ? (
                <p className="remote-directory-status error" role="status">
                  <TriangleAlert size={14} />
                  {directoryError}
                </p>
              ) : directories.length === 0 ? (
                <p className="remote-directory-status" role="status">
                  {t("noMatchingFolders")}
                </p>
              ) : (
                directories.map((directory, index) => (
                  <button
                    key={directory.path}
                    ref={index === 0 ? firstDirectory : undefined}
                    type="button"
                    role="option"
                    data-popover-item
                    aria-selected={false}
                    onClick={() => selectDirectory(directory)}
                  >
                    <span
                      className="remote-directory-option-icon"
                      aria-hidden="true"
                    >
                      <Folder size={15} />
                    </span>
                    <span className="remote-directory-option-copy">
                      <strong>{directory.name}</strong>
                      <small>{directory.path}</small>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          </ActionPopover>
        )}
        {error && <p className="connector-dialog-error">{error}</p>}
        <div className="connector-dialog-actions">
          <button
            type="button"
            className="dialog-button secondary pressable"
            disabled={busy}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="dialog-button primary pressable"
            disabled={busy || !path.trim()}
          >
            {busy && <LoaderCircle className="spin" size={14} />}
            {busy ? t("opening") : t("openProject")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function EmptyState({
  connecting,
  project,
  projects = [],
  suggestions,
  suggestionsLoading,
  suggestionsFailed,
  onRetrySuggestions,
  onSelectProject,
  onOpenProject,
  onCreateStandalone,
  onSelect,
}: {
  connecting: boolean;
  project?: ProjectSummary;
  projects?: readonly ProjectSummary[];
  suggestions: readonly string[];
  suggestionsLoading: boolean;
  suggestionsFailed: boolean;
  onRetrySuggestions(): void;
  onSelectProject?(projectId: string): void | Promise<void>;
  onOpenProject?(): void;
  onCreateStandalone?(): void;
  onSelect(value: string): void;
}) {
  const { t } = useI18n();
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      {connecting ? (
        <h2>{t("connectingRuntime")}</h2>
      ) : project && onSelectProject ? (
        <NewTaskProjectPrompt
          project={project}
          projects={projects}
          onSelectProject={onSelectProject}
          onOpenProject={onOpenProject}
          onCreateStandalone={onCreateStandalone}
        />
      ) : (
        <h2>{t("whatToDo")}</h2>
      )}
      {!connecting && (
        <div
          className="suggestions"
          aria-busy={suggestionsLoading || undefined}
        >
          {suggestionsLoading ? (
            <>
              <span className="visually-hidden" role="status">
                {t("generatingSuggestions")}
              </span>
              {[0, 1, 2].map((placeholder) => (
                <div
                  key={placeholder}
                  className="suggestion suggestion-placeholder"
                  aria-hidden="true"
                >
                  <span />
                </div>
              ))}
            </>
          ) : suggestionsFailed ? (
            <button
              type="button"
              className="suggestion suggestion-retry pressable"
              onClick={onRetrySuggestions}
            >
              <span>
                <strong>{t("suggestionsUnavailable")}</strong>
                {t("retrySuggestions")}
              </span>
              <RotateCcw size={14} />
            </button>
          ) : (
            suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion pressable"
                onClick={() => onSelect(suggestion)}
              >
                {suggestion}
                <ArrowUp size={14} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function filterProjectsForPicker(
  projects: readonly ProjectSummary[],
  query: string,
): readonly ProjectSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  const projectScoped = projects.filter(
    (project) => project.scope !== "standalone",
  );
  if (!normalized) return projectScoped;
  return projectScoped.filter((project) =>
    [project.name, project.basePath, project.runtime?.workspacePath]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function NewTaskProjectPrompt({
  project,
  projects,
  onSelectProject,
  onOpenProject,
  onCreateStandalone,
}: {
  project: ProjectSummary;
  projects: readonly ProjectSummary[];
  onSelectProject(projectId: string): void | Promise<void>;
  onOpenProject?(): void;
  onCreateStandalone?(): void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [pickerPosition, setPickerPosition] = useState<PopoverPosition>();
  const [query, setQuery] = useState("");
  const [selectingProjectId, setSelectingProjectId] = useState<string>();

  function openPicker() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    setQuery("");
    setPickerPosition(
      anchoredPopoverPosition(bounds, {
        width: 320,
        height: Math.min(
          470,
          72 +
            projects.length * 40 +
            (onOpenProject || onCreateStandalone ? 84 : 0),
        ),
        align: "start",
      }),
    );
  }

  function closePicker() {
    setPickerPosition(undefined);
    setQuery("");
  }

  async function selectProject(projectId: string) {
    closePicker();
    setSelectingProjectId(projectId);
    try {
      await onSelectProject(projectId);
    } finally {
      setSelectingProjectId(undefined);
    }
  }

  return (
    <>
      <h2 className="new-task-project-prompt">
        <span>{t("newTaskPromptBeforeProject")}</span>
        <button
          ref={trigger}
          type="button"
          className="new-task-project-trigger pressable"
          aria-haspopup="dialog"
          aria-expanded={Boolean(pickerPosition)}
          disabled={Boolean(selectingProjectId)}
          onClick={() => (pickerPosition ? closePicker() : openPicker())}
        >
          <span>
            {project.scope === "standalone" ? t("noProject") : project.name}
          </span>
          {selectingProjectId ? (
            <LoaderCircle className="spin" size={16} />
          ) : null}
        </button>
        <span>{t("newTaskPromptAfterProject")}</span>
      </h2>
      {pickerPosition && (
        <ProjectPickerPopover
          projects={projects}
          currentProjectId={project.id}
          query={query}
          position={pickerPosition}
          triggerRef={trigger}
          searchInputRef={searchInput}
          selectingProjectId={selectingProjectId}
          onQueryChange={setQuery}
          onClose={closePicker}
          onSelect={(projectId) => void selectProject(projectId)}
          onOpenProject={onOpenProject}
          onCreateStandalone={onCreateStandalone}
        />
      )}
    </>
  );
}

export function ProjectPickerPopover({
  projects,
  currentProjectId,
  query,
  position,
  triggerRef,
  searchInputRef,
  selectingProjectId,
  onQueryChange,
  onClose,
  onSelect,
  onOpenProject,
  onCreateStandalone,
}: {
  projects: readonly ProjectSummary[];
  currentProjectId: string;
  query: string;
  position: PopoverPosition;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  selectingProjectId?: string;
  onQueryChange(value: string): void;
  onClose(): void;
  onSelect(projectId: string): void;
  onOpenProject?(): void;
  onCreateStandalone?(): void;
}) {
  const { t } = useI18n();
  const visibleProjects = filterProjectsForPicker(projects, query);

  return (
    <ActionPopover
      label={t("selectProject")}
      className="project-picker-popover"
      role="dialog"
      position={position}
      initialFocusRef={searchInputRef}
      returnFocusRef={triggerRef}
      onClose={onClose}
    >
      <label className="project-picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          aria-label={t("searchProjects")}
          placeholder={t("searchProjects")}
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visibleProjects[0]) {
              event.preventDefault();
              onSelect(visibleProjects[0].id);
            }
          }}
        />
      </label>
      <div
        className="project-picker-list"
        role="listbox"
        aria-label={t("selectProject")}
      >
        {visibleProjects.length === 0 ? (
          <p className="project-picker-empty" role="status">
            {t("noMatchingProjects")}
          </p>
        ) : (
          visibleProjects.map((candidate) => {
            const current = candidate.id === currentProjectId;
            const selecting = candidate.id === selectingProjectId;
            return (
              <button
                key={candidate.id}
                type="button"
                className={`project-picker-option${current ? " current" : ""}`}
                role="option"
                aria-selected={current}
                data-popover-item
                disabled={Boolean(selectingProjectId)}
                onClick={() => onSelect(candidate.id)}
              >
                <span className="project-picker-option-icon" aria-hidden="true">
                  {candidate.runtime?.kind === "remote" ? (
                    <Server size={17} />
                  ) : (
                    <Folder size={17} />
                  )}
                </span>
                <span className="project-picker-option-name">
                  {candidate.name}
                </span>
                {selecting ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : current ? (
                  <Check size={17} aria-hidden="true" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
      {(onOpenProject || onCreateStandalone) && (
        <div className="project-picker-actions">
          {onOpenProject && (
            <ActionPopoverItem
              icon={<Plus size={16} />}
              onSelect={() => {
                onClose();
                onOpenProject();
              }}
            >
              {t("newProject")}
            </ActionPopoverItem>
          )}
          {onCreateStandalone && (
            <ActionPopoverItem
              icon={<X size={16} />}
              onSelect={() => {
                onClose();
                onCreateStandalone();
              }}
            >
              {t("notInProject")}
            </ActionPopoverItem>
          )}
        </div>
      )}
    </ActionPopover>
  );
}
