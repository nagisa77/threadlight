import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  File,
  FileCode2,
  FileDiff,
  Folder,
  FolderOpen,
  FolderTree,
  GitCommitHorizontal,
  GitBranch,
  GitMerge,
  GitPullRequestDraft,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows3,
  Terminal,
  Trash2,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import DiffViewer from "react-diff-viewer-continued";
import { refractor } from "refractor";
import tsx from "refractor/tsx";
import { createBrowserUuid } from "@threadlight/client";

import { PanelAddMenu, type PanelViewKind } from "./panel-add-menu.js";
import { MarkdownContent } from "./markdown.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme } from "./theme.js";
import {
  TerminalView,
  type TerminalAdapter,
} from "./terminal.js";

refractor.register(tsx);

const MAX_SIMULTANEOUS_REVIEW_FILES = 50;

export interface ConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  localOnly?: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface ConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly ConversationFileChange[];
}

export interface WorktreeDeliveryConflict {
  path: string;
  reason:
    | "both_added"
    | "target_deleted"
    | "target_modified"
    | "merge_conflict"
    | "unsafe_target";
}

export interface WorktreeDeliveryPreflight {
  taskBranch: string;
  targetBranch: string;
  sourceBranch?: string;
  branchChanged: boolean;
  files: number;
  pendingFiles: number;
  alreadyAppliedFiles: number;
  localOnlyFiles?: number;
  conflicts: readonly WorktreeDeliveryConflict[];
}

export interface WorktreeDeliveryResult extends WorktreeDeliveryPreflight {
  appliedFiles: number;
  commit?: string;
}

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

export interface CodeHostCommitPushResult {
  commit: string;
  status: CodeHostDeliveryStatus;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface WorkspaceFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export interface SystemFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface SystemFileListing {
  path: string;
  parentPath?: string;
  entries: readonly SystemFileEntry[];
}

export interface WorkspaceAdapter {
  getChanges(
    projectId: string,
    threadId: string,
  ): Promise<ConversationChangesSnapshot>;
  restoreChanges?(
    projectId: string,
    threadId: string,
    revision: string,
    paths?: readonly string[],
  ): Promise<ConversationChangesSnapshot>;
  preflightDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<WorktreeDeliveryPreflight>;
  applyDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<WorktreeDeliveryResult>;
  commitDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
    message: string,
  ): Promise<WorktreeDeliveryResult>;
  getCodeHostStatus?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<CodeHostDeliveryStatus>;
  commitAndPush?(
    projectId: string,
    threadId: string,
    revision: string,
    message: string,
  ): Promise<CodeHostCommitPushResult>;
  createDraftPullRequest?(
    projectId: string,
    threadId: string,
    revision: string,
    title: string,
    body?: string,
  ): Promise<CodeHostDeliveryStatus>;
  list(
    projectId: string,
    path?: string,
    threadId?: string,
  ): Promise<readonly WorkspaceEntry[]>;
  read(
    projectId: string,
    path: string,
    threadId?: string,
  ): Promise<WorkspaceFile>;
  reveal?(projectId: string, path: string, threadId?: string): Promise<void>;
  chooseSystemFile?(): Promise<string | undefined>;
  listSystemFiles?(path: string): Promise<SystemFileListing>;
  readSystemFile?(path: string): Promise<WorkspaceFile>;
  revealSystemFile?(path: string): Promise<void>;
}

export interface WorkspaceFileOpenRequest {
  id: number;
  path: string;
  source?: "workspace" | "system";
  activate?: boolean;
  line?: number;
  column?: number;
}

interface WorkspaceTab {
  id: string;
  kind: "review" | PanelViewKind;
  path?: string;
  source?: "workspace" | "system";
  title: string;
  line?: number;
  column?: number;
  revealRequest?: number;
}

export function WorkspacePanel({
  adapter,
  terminal,
  projectId,
  threadId,
  projectName,
  remoteFileRoot,
  changes,
  changesLoading,
  changesError,
  reviewRequest,
  fileOpenRequest,
  hidden,
  onResizeStart,
  onResizeBy,
  onResetSize,
  onRefreshChanges,
  onRestoreChanges,
  restoreDisabled = false,
  deliveryEnabled = false,
  deliveryDisabled = false,
  taskTitle,
  onDiscardTask,
  toolbarActions,
}: {
  adapter: WorkspaceAdapter;
  terminal?: TerminalAdapter;
  projectId: string;
  threadId?: string;
  projectName: string;
  remoteFileRoot?: string;
  changes?: ConversationChangesSnapshot;
  changesLoading: boolean;
  changesError?: string;
  reviewRequest: number;
  fileOpenRequest?: WorkspaceFileOpenRequest;
  hidden: boolean;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeBy(delta: number): void;
  onResetSize(): void;
  onRefreshChanges(): void;
  onRestoreChanges?(
    paths: readonly string[] | undefined,
    revision: string,
  ): Promise<void>;
  restoreDisabled?: boolean;
  deliveryEnabled?: boolean;
  deliveryDisabled?: boolean;
  taskTitle?: string;
  onDiscardTask?(): void;
  toolbarActions?: ReactNode;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createFileTab(t),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [diffLayout, setDiffLayout] = useState<"unified" | "split">("unified");
  const [remoteFilePickerOpen, setRemoteFilePickerOpen] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  useEffect(() => {
    if (reviewRequest === 0) return;
    setTabs((current) => {
      const review = current.find((tab) => tab.kind === "review");
      if (review) {
        setActiveTabId(review.id);
        return current;
      }
      const next = createReviewTab(t);
      setActiveTabId(next.id);
      return [...current, next];
    });
  }, [reviewRequest]);

  useEffect(() => {
    if (!fileOpenRequest) return;
    setTabs((current) => {
      const existing = current.find(
        (tab) =>
          tab.kind === "file" &&
          tab.path === fileOpenRequest.path &&
          (tab.source ?? "workspace") ===
            (fileOpenRequest.source ?? "workspace"),
      );
      if (existing) {
        if (fileOpenRequest.activate !== false) {
          setActiveTabId(existing.id);
        }
        return current.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                source: fileOpenRequest.source,
                line: fileOpenRequest.line,
                column: fileOpenRequest.column,
                revealRequest: fileOpenRequest.id,
              }
            : tab,
        );
      }

      const empty =
        current.find(
          (tab) =>
            tab.kind === "file" &&
            !tab.path &&
            tab.id === activeTabId,
        ) ??
        current.find((tab) => tab.kind === "file" && !tab.path);
      if (empty) {
        if (fileOpenRequest.activate !== false) {
          setActiveTabId(empty.id);
        }
        return current.map((tab) =>
          tab.id === empty.id
            ? {
                ...tab,
                path: fileOpenRequest.path,
                source: fileOpenRequest.source,
                title: fileName(fileOpenRequest.path),
                line: fileOpenRequest.line,
                column: fileOpenRequest.column,
                revealRequest: fileOpenRequest.id,
              }
            : tab,
        );
      }

      const next: WorkspaceTab = {
        ...createFileTab(t),
        path: fileOpenRequest.path,
        source: fileOpenRequest.source,
        title: fileName(fileOpenRequest.path),
        line: fileOpenRequest.line,
        column: fileOpenRequest.column,
        revealRequest: fileOpenRequest.id,
      };
      if (fileOpenRequest.activate !== false) {
        setActiveTabId(next.id);
      }
      return [...current, next];
    });
  }, [fileOpenRequest?.id]);

  useEffect(() => {
    setTabs([createFileTab(t)]);
    setActiveTabId("");
    setDiffLayout("unified");
    setRemoteFilePickerOpen(false);
  }, [projectId, remoteFileRoot]);

  useEffect(() => {
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        title:
          tab.kind === "review"
            ? t("review")
            : tab.kind === "terminal"
              ? t("terminal")
              : tab.path
                ? tab.title
                : t("openFile"),
      })),
    );
  }, [t]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [activeTabId, tabs]);

  function addTab(kind: PanelViewKind) {
    const tab =
      kind === "terminal" ? createTerminalTab(t) : createFileTab(t);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function addFileTab() {
    addTab("file");
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId) {
        const replacement = next[Math.min(index, next.length - 1)];
        setActiveTabId(replacement?.id ?? "");
      }
      return next;
    });
  }

  function selectFile(path: string) {
    if (!activeTab || activeTab.kind !== "file") return;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              path,
              source: "workspace",
              title: fileName(path),
              line: undefined,
              column: undefined,
              revealRequest: undefined,
            }
          : tab,
      ),
    );
  }

  function selectSystemFile(path: string) {
    setTabs((current) => {
      const selected = current.find(
        (tab) => tab.id === activeTabId && tab.kind === "file",
      );
      if (selected) {
        return current.map((tab) =>
          tab.id === selected.id
            ? {
                ...tab,
                path,
                source: "system",
                title: fileName(path),
                line: undefined,
                column: undefined,
                revealRequest: undefined,
              }
            : tab,
        );
      }
      const next: WorkspaceTab = {
        ...createFileTab(t),
        path,
        source: "system",
        title: fileName(path),
      };
      setActiveTabId(next.id);
      return [...current, next];
    });
  }

  async function openSystemFile() {
    if (remoteFileRoot && adapter.listSystemFiles) {
      setRemoteFilePickerOpen(true);
      return;
    }
    if (!adapter.chooseSystemFile) return;
    const path = await adapter.chooseSystemFile();
    if (path) selectSystemFile(path);
  }

  const canOpenSystemFile = remoteFileRoot
    ? Boolean(adapter.listSystemFiles)
    : Boolean(adapter.chooseSystemFile);

  return (
    <>
      <aside
        className="workspace-panel"
        aria-label={t("rightPanel")}
        aria-hidden={hidden}
        hidden={hidden}
      >
      <div
        className="workspace-split-handle"
        role="separator"
        aria-label={t("resizeRightPanel")}
        aria-orientation="vertical"
        tabIndex={0}
        title={t("resizeRightPanelHint")}
        onPointerDown={onResizeStart}
        onDoubleClick={onResetSize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResizeBy(24);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onResizeBy(-24);
          } else if (event.key === "Home") {
            event.preventDefault();
            onResetSize();
          }
        }}
      />
      <div className="workspace-panel-tabs">
        <div className="workspace-panel-tab-flow">
          <div
            className="workspace-tab-strip"
            role="tablist"
            aria-label={t("panelTabs")}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                className={`workspace-tab pressable ${tab.id === activeTab?.id ? "active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.kind === "review" ? (
                  <FileDiff size={14} />
                ) : tab.kind === "terminal" ? (
                  <Terminal size={14} />
                ) : (
                  <File size={14} />
                )}
                <span>{tab.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="workspace-tab-close pressable"
                  aria-label={t("closeTab", { title: tab.title })}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={13} />
                </span>
              </button>
            ))}
          </div>
          <PanelAddMenu
            available={terminal ? ["terminal", "file"] : ["file"]}
            onSelect={addTab}
          />
        </div>
        {toolbarActions && (
          <div className="workspace-panel-actions">{toolbarActions}</div>
        )}
      </div>

      <div className="workspace-panel-stage">
        {terminal &&
          tabs
            .filter((tab) => tab.kind === "terminal")
            .map((tab) => (
              <TerminalView
                key={tab.id}
                adapter={terminal}
                projectId={projectId}
                hidden={tab.id !== activeTab?.id}
                label={tab.title}
              />
            ))}
        {activeTab?.kind === "review" ? (
            <ReviewView
              changes={changes}
              loading={changesLoading}
              error={changesError}
              layout={diffLayout}
              projectId={projectId}
              threadId={threadId}
              deliveryEnabled={deliveryEnabled}
              deliveryDisabled={deliveryDisabled}
              defaultCommitMessage={taskTitle}
              onPreflightDelivery={adapter.preflightDelivery}
              onApplyDelivery={adapter.applyDelivery}
              onCommitDelivery={adapter.commitDelivery}
              onGetCodeHostStatus={adapter.getCodeHostStatus}
              onCommitAndPush={adapter.commitAndPush}
              onCreateDraftPullRequest={adapter.createDraftPullRequest}
              onDiscardTask={onDiscardTask}
              onLayoutChange={setDiffLayout}
              onRefresh={onRefreshChanges}
            onRestore={onRestoreChanges}
            restoreDisabled={restoreDisabled}
          />
        ) : activeTab?.kind === "file" ? (
          <FileView
            key={activeTab.id}
            adapter={adapter}
            projectId={projectId}
            threadId={threadId}
            projectName={projectName}
            path={activeTab.path}
            source={activeTab.source}
            line={activeTab.line}
            revealRequest={activeTab.revealRequest}
            onSelectFile={selectFile}
            onOpenSystemFile={
              canOpenSystemFile ? openSystemFile : undefined
            }
            remoteSystemFiles={Boolean(remoteFileRoot)}
          />
        ) : activeTab?.kind === "terminal" ? null : (
          <WorkspacePanelEmpty onAdd={addFileTab} />
        )}
      </div>
      </aside>
      {remoteFilePickerOpen &&
        remoteFileRoot &&
        adapter.listSystemFiles && (
          <RemoteSystemFileDialog
            initialPath={remoteFileRoot}
            list={adapter.listSystemFiles}
            onCancel={() => setRemoteFilePickerOpen(false)}
            onOpen={(path) => {
              selectSystemFile(path);
              setRemoteFilePickerOpen(false);
            }}
          />
        )}
    </>
  );
}

function RemoteSystemFileDialog({
  initialPath,
  list,
  onCancel,
  onOpen,
}: {
  initialPath: string;
  list(path: string): Promise<SystemFileListing>;
  onCancel(): void;
  onOpen(path: string): void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState(initialPath);
  const [listing, setListing] = useState<SystemFileListing>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);

  const load = useCallback(
    async (nextPath: string) => {
      const requestId = ++request.current;
      setLoading(true);
      setError(undefined);
      setSelectedPath(undefined);
      try {
        const next = await list(nextPath);
        if (request.current !== requestId) return;
        setListing(next);
        setPath(next.path);
      } catch (reason) {
        if (request.current !== requestId) return;
        setListing(undefined);
        setError(errorMessage(reason));
      } finally {
        if (request.current === requestId) setLoading(false);
      }
    },
    [list],
  );

  useEffect(() => {
    void load(initialPath);
    return () => {
      request.current += 1;
    };
  }, [initialPath, load]);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  const entries = listing?.entries ?? [];
  return (
    <div
      className="dialog-backdrop remote-system-file-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="connector-dialog remote-system-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-system-file-title"
      >
        <div className="connector-dialog-heading">
          <span className="connector-dialog-icon" aria-hidden="true">
            <FileCode2 size={18} />
          </span>
          <div>
            <h2 id="remote-system-file-title">{t("openRemoteFile")}</h2>
            <p>{t("remoteFilePickerDescription")}</p>
          </div>
        </div>
        <label className="remote-system-file-path">
          <span>{t("filePath")}</span>
          <input
            value={path}
            autoFocus
            spellCheck={false}
            disabled={loading}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void load(path);
            }}
          />
        </label>
        <div
          className="remote-system-file-list"
          role="listbox"
          aria-label={t("remoteFiles")}
        >
          {loading ? (
            <div className="remote-system-file-state" role="status">
              <LoaderCircle className="spin" size={16} />
              {t("loadingFolders")}
            </div>
          ) : error ? (
            <div
              className="remote-system-file-state error"
              role="alert"
            >
              <TriangleAlert size={16} />
              {error}
            </div>
          ) : (
            <>
              {listing?.parentPath && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="remote-system-file-row pressable"
                  onClick={() => void load(listing.parentPath!)}
                >
                  <Folder size={16} />
                  <span>
                    <strong>..</strong>
                    <small>{listing.parentPath}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              )}
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  role="option"
                  aria-selected={
                    entry.kind === "file" &&
                    entry.path === selectedPath
                  }
                  className={`remote-system-file-row pressable ${
                    entry.kind === "file" &&
                    entry.path === selectedPath
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => {
                    if (entry.kind === "directory") {
                      void load(entry.path);
                    } else {
                      setSelectedPath(entry.path);
                    }
                  }}
                  onDoubleClick={() => {
                    if (entry.kind === "file") onOpen(entry.path);
                  }}
                >
                  {entry.kind === "directory" ? (
                    <Folder size={16} />
                  ) : (
                    <FileCode2 size={16} />
                  )}
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{entry.path}</small>
                  </span>
                  {entry.kind === "directory" && (
                    <ChevronRight size={15} />
                  )}
                </button>
              ))}
              {entries.length === 0 && (
                <div className="remote-system-file-state">
                  {t("emptyRemoteFolder")}
                </div>
              )}
            </>
          )}
        </div>
        <div className="connector-dialog-actions">
          <button
            type="button"
            className="dialog-button secondary pressable"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="dialog-button primary pressable"
            disabled={!selectedPath || loading}
            onClick={() => {
              if (selectedPath) onOpen(selectedPath);
            }}
          >
            {t("openFile")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReviewView({
  changes,
  loading,
  error,
  layout,
  projectId,
  threadId,
  deliveryEnabled = false,
  deliveryDisabled = false,
  defaultCommitMessage,
  onPreflightDelivery,
  onApplyDelivery,
  onCommitDelivery,
  onGetCodeHostStatus,
  onCommitAndPush,
  onCreateDraftPullRequest,
  onDiscardTask,
  onLayoutChange,
  onRefresh,
  onRestore,
  restoreDisabled = false,
}: {
  changes?: ConversationChangesSnapshot;
  loading: boolean;
  error?: string;
  layout: "unified" | "split";
  projectId?: string;
  threadId?: string;
  deliveryEnabled?: boolean;
  deliveryDisabled?: boolean;
  defaultCommitMessage?: string;
  onPreflightDelivery?: WorkspaceAdapter["preflightDelivery"];
  onApplyDelivery?: WorkspaceAdapter["applyDelivery"];
  onCommitDelivery?: WorkspaceAdapter["commitDelivery"];
  onGetCodeHostStatus?: WorkspaceAdapter["getCodeHostStatus"];
  onCommitAndPush?: WorkspaceAdapter["commitAndPush"];
  onCreateDraftPullRequest?: WorkspaceAdapter["createDraftPullRequest"];
  onDiscardTask?(): void;
  onLayoutChange(layout: "unified" | "split"): void;
  onRefresh(): void;
  onRestore?(
    paths: readonly string[] | undefined,
    revision: string,
  ): Promise<void>;
  restoreDisabled?: boolean;
}) {
  const { t } = useI18n();
  const largeChangeSet =
    (changes?.files.length ?? 0) > MAX_SIMULTANEOUS_REVIEW_FILES;
  const [treeVisible, setTreeVisible] = useState(largeChangeSet);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    changes?.files[0]?.path,
  );
  const [pendingRestore, setPendingRestore] = useState<{
    paths?: readonly string[];
    label: string;
  }>();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string>();
  const [deliveryResult, setDeliveryResult] =
    useState<WorktreeDeliveryResult>();
  const [pendingDelivery, setPendingDelivery] = useState<{
    action: "apply" | "commit";
    preflight: WorktreeDeliveryPreflight;
    message: string;
  }>();
  const [codeHostStatus, setCodeHostStatus] =
    useState<CodeHostDeliveryStatus>();
  const [codeHostLoading, setCodeHostLoading] = useState(false);
  const [codeHostError, setCodeHostError] = useState<string>();
  const [pendingCodeHostAction, setPendingCodeHostAction] = useState<
    | { action: "push"; message: string }
    | { action: "pr"; title: string; body: string }
  >();

  useEffect(() => {
    if (!changes?.files.length) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath || !changes.files.some((file) => file.path === selectedPath)) {
      setSelectedPath(changes.files[0].path);
    }
  }, [changes, selectedPath]);

  useEffect(() => {
    if (largeChangeSet) setTreeVisible(true);
  }, [largeChangeSet]);

  const refreshCodeHostStatus = useCallback(async () => {
    if (
      !changes ||
      !projectId ||
      !threadId ||
      !deliveryEnabled ||
      !onGetCodeHostStatus
    ) {
      setCodeHostStatus(undefined);
      return;
    }
    setCodeHostLoading(true);
    setCodeHostError(undefined);
    try {
      setCodeHostStatus(
        await onGetCodeHostStatus(
          projectId,
          threadId,
          changes.revision,
        ),
      );
    } catch (reason) {
      setCodeHostError(errorMessage(reason));
    } finally {
      setCodeHostLoading(false);
    }
  }, [
    changes,
    deliveryEnabled,
    onGetCodeHostStatus,
    projectId,
    threadId,
  ]);

  useEffect(() => {
    void refreshCodeHostStatus();
  }, [refreshCodeHostStatus]);

  useEffect(() => {
    if (codeHostStatus?.pullRequest?.state !== "open") return;
    const timer = window.setInterval(() => {
      void refreshCodeHostStatus();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [codeHostStatus?.pullRequest?.state, refreshCodeHostStatus]);

  function selectChangedFile(path: string) {
    setSelectedPath(path);
    if (!largeChangeSet) {
      document.getElementById(reviewFileId(path))?.scrollIntoView({
        block: "start",
      });
    }
  }

  const reviewFiles =
    largeChangeSet && selectedPath
      ? changes?.files.filter((file) => file.path === selectedPath)
      : changes?.files;

  async function confirmRestore() {
    if (!pendingRestore || !changes || !onRestore || restoring) return;
    setRestoring(true);
    setRestoreError(undefined);
    try {
      await onRestore(pendingRestore.paths, changes.revision);
      setPendingRestore(undefined);
    } catch (reason) {
      setRestoreError(errorMessage(reason));
    } finally {
      setRestoring(false);
    }
  }

  async function beginDelivery(action: "apply" | "commit") {
    if (
      !changes ||
      !projectId ||
      !threadId ||
      !onPreflightDelivery ||
      deliveryBusy
    ) {
      return;
    }
    setDeliveryBusy(true);
    setDeliveryError(undefined);
    try {
      const preflight = await onPreflightDelivery(
        projectId,
        threadId,
        changes.revision,
      );
      setPendingDelivery({
        action,
        preflight,
        message: defaultCommitMessage?.trim() || t("defaultCommitMessage"),
      });
    } catch (reason) {
      setDeliveryError(errorMessage(reason));
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function confirmDelivery() {
    if (
      !pendingDelivery ||
      !changes ||
      !projectId ||
      !threadId ||
      deliveryBusy
    ) {
      return;
    }
    setDeliveryBusy(true);
    setDeliveryError(undefined);
    try {
      const result =
        pendingDelivery.action === "apply"
          ? await onApplyDelivery?.(
              projectId,
              threadId,
              changes.revision,
            )
          : await onCommitDelivery?.(
              projectId,
              threadId,
              changes.revision,
              pendingDelivery.message,
            );
      if (!result) throw new Error(t("deliveryUnavailable"));
      setDeliveryResult(result);
      setPendingDelivery(undefined);
    } catch (reason) {
      setDeliveryError(errorMessage(reason));
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function confirmCodeHostAction() {
    if (
      !pendingCodeHostAction ||
      !changes ||
      !projectId ||
      !threadId ||
      codeHostLoading
    ) {
      return;
    }
    setCodeHostLoading(true);
    setCodeHostError(undefined);
    try {
      if (pendingCodeHostAction.action === "push") {
        if (!onCommitAndPush) throw new Error(t("githubDeliveryUnavailable"));
        const result = await onCommitAndPush(
          projectId,
          threadId,
          changes.revision,
          pendingCodeHostAction.message,
        );
        setCodeHostStatus(result.status);
      } else {
        if (!onCreateDraftPullRequest) {
          throw new Error(t("githubDeliveryUnavailable"));
        }
        setCodeHostStatus(
          await onCreateDraftPullRequest(
            projectId,
            threadId,
            changes.revision,
            pendingCodeHostAction.title,
            pendingCodeHostAction.body,
          ),
        );
      }
      setPendingCodeHostAction(undefined);
    } catch (reason) {
      setCodeHostError(errorMessage(reason));
    } finally {
      setCodeHostLoading(false);
    }
  }

  const showDeliveryCenter = Boolean(
    deliveryEnabled && projectId && threadId,
  );
  const canDeliverChanges = Boolean(
    changes?.files.length && onPreflightDelivery,
  );
  const localDataFiles =
    changes?.files.filter((file) => file.localOnly).length ?? 0;
  const gitFiles = (changes?.files.length ?? 0) - localDataFiles;

  return (
    <div className="review-view">
      <div className="review-toolbar">
        <div className="review-summary">
          <strong>{t("thisConversation")}</strong>
          {changes && (
            <>
              <ChangeCounts
                additions={changes.additions}
                deletions={changes.deletions}
              />
              {localDataFiles > 0 && (
                <span
                  className="review-local-data-summary"
                  title={t("localDataDescription")}
                >
                  {t("localDataCount", { count: localDataFiles })}
                </span>
              )}
            </>
          )}
        </div>
        <div className="review-actions">
          {showDeliveryCenter && (
            <>
              <button
                type="button"
                className="review-delivery-button primary pressable"
                disabled={
                  loading ||
                  deliveryBusy ||
                  deliveryDisabled ||
                  !canDeliverChanges ||
                  !onApplyDelivery
                }
                title={
                  deliveryDisabled
                    ? t("deliveryUnavailableWhileRunning")
                    : t("applyToOriginalBranch")
                }
                onClick={() => void beginDelivery("apply")}
              >
                {deliveryBusy ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <GitMerge size={14} />
                )}
                {t("applyToOriginal")}
              </button>
              <button
                type="button"
                className="review-delivery-button pressable"
                disabled={
                  loading ||
                  deliveryBusy ||
                  deliveryDisabled ||
                  !canDeliverChanges ||
                  gitFiles === 0 ||
                  !onCommitDelivery
                }
                title={
                  gitFiles === 0
                    ? t("commitRequiresGitChanges")
                    : t("stageAndCommitDescription")
                }
                onClick={() => void beginDelivery("commit")}
              >
                <GitCommitHorizontal size={14} />
                {t("stageAndCommit")}
              </button>
              {onDiscardTask && (
                <button
                  type="button"
                  className="review-discard-button pressable"
                  disabled={deliveryBusy || deliveryDisabled}
                  title={t("discardTaskDescription")}
                  onClick={onDiscardTask}
                >
                  <Trash2 size={14} />
                  {t("discardTask")}
                </button>
              )}
              <span className="review-action-divider" aria-hidden="true" />
            </>
          )}
          {changes && changes.files.length > 0 && onRestore && (
            <button
              type="button"
              className="review-restore-all pressable"
              disabled={loading || restoring || restoreDisabled}
              title={
                restoreDisabled
                  ? t("restoreUnavailableWhileRunning")
                  : t("restoreAllChanges")
              }
              onClick={() => {
                setRestoreError(undefined);
                setPendingRestore({
                  label: t("allChangedFiles", {
                    count: changes.files.length,
                  }),
                });
              }}
            >
              <RotateCcw size={14} />
              {t("restoreAll")}
            </button>
          )}
          <button
            type="button"
            className="panel-icon-button pressable"
            aria-label={t("refreshChanges")}
            title={t("refresh")}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : undefined} size={15} />
          </button>
          <div className="diff-layout-toggle" aria-label={t("diffLayout")}>
            <button
              type="button"
              className={`pressable ${layout === "unified" ? "active" : ""}`}
              aria-label={t("unifiedDiff")}
              aria-pressed={layout === "unified"}
              title={t("unifiedDiff")}
              onClick={() => onLayoutChange("unified")}
            >
              <Rows3 size={15} />
            </button>
            <button
              type="button"
              className={`pressable ${layout === "split" ? "active" : ""}`}
              aria-label={t("splitDiff")}
              aria-pressed={layout === "split"}
              title={t("splitDiff")}
              onClick={() => onLayoutChange("split")}
            >
              <Columns2 size={15} />
            </button>
          </div>
          <button
            type="button"
            className={`panel-icon-button pressable ${treeVisible ? "active" : ""}`}
            aria-label={treeVisible ? t("hideChangesTree") : t("showChangesTree")}
            aria-pressed={treeVisible}
            title={treeVisible ? t("hideChangesTree") : t("showChangesTree")}
            onClick={() => setTreeVisible((visible) => !visible)}
          >
            <FolderTree size={16} />
          </button>
        </div>
      </div>

      {(deliveryError || deliveryResult) && !pendingDelivery && (
        <div
          className={`delivery-feedback ${deliveryError ? "error" : "success"}`}
          role="status"
        >
          {deliveryError ? (
            <TriangleAlert size={14} aria-hidden="true" />
          ) : (
            <GitMerge size={14} aria-hidden="true" />
          )}
          <span>
            {deliveryError ??
              (deliveryResult?.commit
                ? t("deliveryCommitted", {
                    branch: deliveryResult.targetBranch,
                    commit: deliveryResult.commit.slice(0, 8),
                  })
                : t("deliveryApplied", {
                    branch: deliveryResult?.targetBranch ?? "",
                    count: deliveryResult?.appliedFiles ?? 0,
                  }))}
          </span>
          <button
            type="button"
            className="delivery-feedback-dismiss pressable"
            aria-label={t("dismiss")}
            onClick={() => {
              setDeliveryError(undefined);
              setDeliveryResult(undefined);
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {showDeliveryCenter && onGetCodeHostStatus && (
        <GitHubDeliveryCard
          status={codeHostStatus}
          loading={codeHostLoading}
          error={codeHostError}
          disabled={deliveryDisabled}
          onRefresh={() => void refreshCodeHostStatus()}
          onCommitPush={
            onCommitAndPush && gitFiles > 0
              ? () =>
                  setPendingCodeHostAction({
                    action: "push",
                    message:
                      defaultCommitMessage?.trim() ||
                      t("defaultCommitMessage"),
                  })
              : undefined
          }
          onCreateDraftPr={
            onCreateDraftPullRequest
              ? () =>
                  setPendingCodeHostAction({
                    action: "pr",
                    title:
                      defaultCommitMessage?.trim() ||
                      t("defaultPullRequestTitle"),
                    body: t("defaultPullRequestBody"),
                  })
              : undefined
          }
        />
      )}

      <div className={`review-view-body ${treeVisible ? "has-tree" : ""}`}>
        <div className="review-scroll">
          {loading && !changes ? (
            <PanelState icon={<LoaderCircle className="spin" size={20} />}>
              {t("loadingChanges")}
            </PanelState>
          ) : error ? (
            <PanelState icon={<FileDiff size={20} />} error>
              {error}
            </PanelState>
          ) : !changes || changes.files.length === 0 ? (
            <PanelState icon={<FileDiff size={20} />}>
              {t("noChanges")}
            </PanelState>
          ) : (
            <>
              {largeChangeSet && (
                <p className="review-large-change-notice">
                  {t("largeChangeSet", { count: changes.files.length })}
                </p>
              )}
              {reviewFiles?.map((file) => (
                <ReviewFile
                  key={file.path}
                  file={file}
                  layout={layout}
                  restoreDisabled={
                    !onRestore || restoreDisabled || restoring
                  }
                  onRestore={() => {
                    setRestoreError(undefined);
                    setPendingRestore({
                      paths: [file.path],
                      label: file.path,
                    });
                  }}
                />
              ))}
            </>
          )}
        </div>
        {treeVisible && changes && changes.files.length > 0 && (
          <ReviewChangesTree
            files={changes.files}
            selectedPath={selectedPath}
            onSelectFile={selectChangedFile}
          />
        )}
      </div>
      {pendingRestore && (
        <RestoreChangesDialog
          label={pendingRestore.label}
          all={pendingRestore.paths === undefined}
          restoring={restoring}
          error={restoreError}
          onCancel={() => {
            if (restoring) return;
            setPendingRestore(undefined);
            setRestoreError(undefined);
          }}
          onConfirm={() => void confirmRestore()}
          onRefresh={() => {
            setPendingRestore(undefined);
            setRestoreError(undefined);
            onRefresh();
          }}
        />
      )}
      {pendingDelivery && (
        <WorktreeDeliveryDialog
          action={pendingDelivery.action}
          preflight={pendingDelivery.preflight}
          message={pendingDelivery.message}
          busy={deliveryBusy}
          error={deliveryError}
          onMessageChange={(message) =>
            setPendingDelivery((current) =>
              current ? { ...current, message } : current,
            )
          }
          onCancel={() => {
            if (deliveryBusy) return;
            setPendingDelivery(undefined);
            setDeliveryError(undefined);
          }}
          onConfirm={() => void confirmDelivery()}
        />
      )}
      {pendingCodeHostAction && (
        <GitHubDeliveryDialog
          action={pendingCodeHostAction.action}
          value={pendingCodeHostAction}
          busy={codeHostLoading}
          error={codeHostError}
          onChange={setPendingCodeHostAction}
          onCancel={() => {
            if (codeHostLoading) return;
            setPendingCodeHostAction(undefined);
            setCodeHostError(undefined);
          }}
          onConfirm={() => void confirmCodeHostAction()}
        />
      )}
    </div>
  );
}

function ReviewFile({
  file,
  layout,
  restoreDisabled,
  onRestore,
}: {
  file: ConversationFileChange;
  layout: "unified" | "split";
  restoreDisabled: boolean;
  onRestore(): void;
}) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  return (
    <section className="review-file" id={reviewFileId(file.path)}>
      <header className="review-file-header">
        <FileCode2 size={14} />
        <span title={file.path}>{file.path}</span>
        <ChangeCounts additions={file.additions} deletions={file.deletions} />
        {file.localOnly && (
          <span
            className="review-file-local-data"
            title={t("localDataDescription")}
          >
            {t("localData")}
          </span>
        )}
        <button
          type="button"
          className="review-file-restore pressable"
          disabled={restoreDisabled}
          aria-label={t("restoreFile", { path: file.path })}
          title={t("restoreFile", { path: file.path })}
          onClick={onRestore}
        >
          <RotateCcw size={13} />
        </button>
      </header>
      {file.binary || file.oldContent === undefined && file.newContent === undefined ? (
        <div className="review-binary">{t("binaryDiff")}</div>
      ) : (
        <div className="review-diff">
          <DiffViewer
            oldValue={file.oldContent ?? ""}
            newValue={file.newContent ?? ""}
            splitView={layout === "split"}
            useDarkTheme={resolvedTheme === "dark"}
            showDiffOnly
            extraLinesSurroundingDiff={3}
            hideSummary
            disableWorker
            highlightLanguage={languageForPath(file.path)}
            styles={reviewDiffStylesForLayout(layout)}
          />
        </div>
      )}
    </section>
  );
}

function RestoreChangesDialog({
  label,
  all,
  restoring,
  error,
  onCancel,
  onConfirm,
  onRefresh,
}: {
  label: string;
  all: boolean;
  restoring: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
  onRefresh(): void;
}) {
  const { t } = useI18n();
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !restoring) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onCancel, restoring]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !restoring) onCancel();
      }}
    >
      <section
        className="delete-dialog restore-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="restore-dialog-title"
        aria-describedby="restore-dialog-description"
      >
        <span className="delete-dialog-icon restore-dialog-icon" aria-hidden="true">
          <RotateCcw size={18} />
        </span>
        <div className="delete-dialog-copy">
          <h2 id="restore-dialog-title">
            {all ? t("restoreAllQuestion") : t("restoreFileQuestion")}
          </h2>
          <p id="restore-dialog-description">
            {t("restoreChangesDescription", { target: label })}
          </p>
          {error && (
            <div className="restore-dialog-error">
              <p>{error}</p>
              <button
                type="button"
                className="dialog-button secondary pressable"
                disabled={restoring}
                onClick={onRefresh}
              >
                <RefreshCw size={13} />
                {t("refreshChanges")}
              </button>
            </div>
          )}
        </div>
        <div className="delete-dialog-actions">
          <button
            ref={cancelButton}
            type="button"
            className="dialog-button secondary pressable"
            disabled={restoring}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="dialog-button danger pressable"
            disabled={restoring || Boolean(error)}
            onClick={onConfirm}
          >
            {restoring && <LoaderCircle className="spin" size={14} />}
            {restoring ? t("restoring") : t("restore")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function GitHubDeliveryCard({
  status,
  loading,
  error,
  disabled,
  onRefresh,
  onCommitPush,
  onCreateDraftPr,
}: {
  status?: CodeHostDeliveryStatus;
  loading: boolean;
  error?: string;
  disabled: boolean;
  onRefresh(): void;
  onCommitPush?(): void;
  onCreateDraftPr?(): void;
}) {
  const { t } = useI18n();
  const pullRequest = status?.pullRequest;
  const comments = pullRequest?.comments.slice(0, 8) ?? [];
  return (
    <section className="github-delivery-card" aria-label={t("githubDelivery")}>
      <div className="github-delivery-heading">
        <span className="github-delivery-icon" aria-hidden="true">
          <GitBranch size={16} />
        </span>
        <div>
          <strong>{t("githubDelivery")}</strong>
          <span>
            {status?.repository ??
              (loading ? t("loadingGitHubStatus") : t("githubCliRequired"))}
          </span>
        </div>
        <button
          type="button"
          className="panel-icon-button pressable"
          aria-label={t("refreshGitHubStatus")}
          title={t("refreshGitHubStatus")}
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw className={loading ? "spin" : undefined} size={14} />
        </button>
      </div>

      {status && (
        <div className="github-branch-route">
          <code>{status.taskBranch}</code>
          <span aria-hidden="true">→</span>
          <code>{status.baseBranch}</code>
          <span
            className={`github-push-state ${status.pushed ? "ready" : ""}`}
          >
            {status.pushed ? t("branchPushed") : t("branchLocalOnly")}
          </span>
        </div>
      )}

      {(error || (status && !status.available)) && (
        <p className="github-delivery-error" role="status">
          <TriangleAlert size={13} />
          {error ?? status?.reason ?? t("githubDeliveryUnavailable")}
        </p>
      )}

      {status?.available && !pullRequest && (
        <div className="github-delivery-actions">
          {onCommitPush && (
            <button
              type="button"
              className="github-delivery-button pressable"
              disabled={disabled || loading}
              onClick={onCommitPush}
            >
              <UploadCloud size={14} />
              {status.pushed ? t("commitAndPushUpdates") : t("commitAndPush")}
            </button>
          )}
          {onCreateDraftPr && (
            <button
              type="button"
              className="github-delivery-button primary pressable"
              disabled={disabled || loading || !status.pushed}
              title={!status.pushed ? t("pushBeforeDraftPr") : undefined}
              onClick={onCreateDraftPr}
            >
              <GitPullRequestDraft size={14} />
              {t("createDraftPr")}
            </button>
          )}
        </div>
      )}

      {pullRequest && (
        <div className="github-pr">
          <div className="github-pr-summary">
            <GitPullRequestDraft size={15} aria-hidden="true" />
            <a href={pullRequest.url} target="_blank" rel="noreferrer">
              #{pullRequest.number} {pullRequest.title}
            </a>
            <span className="github-pr-draft">
              {pullRequest.draft ? t("draft") : pullRequest.state}
            </span>
          </div>
          <div className="github-pr-signals">
            <span className={`github-ci-state ${pullRequest.ciStatus}`}>
              {t(codeHostCiKey(pullRequest.ciStatus))}
            </span>
            {pullRequest.reviewDecision && (
              <span className="github-review-decision">
                {humanizeGitHubState(pullRequest.reviewDecision)}
              </span>
            )}
            {pullRequest.comments.length > 0 && (
              <span>
                <MessageSquareText size={12} />
                {t("reviewCommentCount", {
                  count: pullRequest.comments.length,
                })}
              </span>
            )}
          </div>
          {pullRequest.checks.length > 0 && (
            <div className="github-checks">
              {pullRequest.checks.map((check, index) =>
                check.url ? (
                  <a
                    key={`${check.name}:${index}`}
                    className={`github-check ${check.status}`}
                    href={check.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span aria-hidden="true" />
                    {check.name}
                  </a>
                ) : (
                  <span
                    key={`${check.name}:${index}`}
                    className={`github-check ${check.status}`}
                  >
                    <span aria-hidden="true" />
                    {check.name}
                  </span>
                ),
              )}
            </div>
          )}
          {comments.length > 0 && (
            <div className="github-review-comments">
              <strong>{t("reviewComments")}</strong>
              {comments.map((comment) => {
                const content = (
                  <>
                    <span>
                      <b>@{comment.author}</b>
                      {comment.path && (
                        <code>
                          {comment.path}
                          {comment.line ? `:${comment.line}` : ""}
                        </code>
                      )}
                      {comment.state && (
                        <em>{humanizeGitHubState(comment.state)}</em>
                      )}
                    </span>
                    {comment.body && <p>{comment.body}</p>}
                  </>
                );
                return comment.url ? (
                  <a
                    key={comment.id}
                    className="github-review-comment"
                    href={comment.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {content}
                  </a>
                ) : (
                  <div key={comment.id} className="github-review-comment">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type PendingGitHubAction =
  | { action: "push"; message: string }
  | { action: "pr"; title: string; body: string };

function GitHubDeliveryDialog({
  action,
  value,
  busy,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  action: PendingGitHubAction["action"];
  value: PendingGitHubAction;
  busy: boolean;
  error?: string;
  onChange(value: PendingGitHubAction): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  const firstField = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    firstField.current?.select();
  }, [action]);

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onConfirm();
  }

  const valid =
    value.action === "push"
      ? Boolean(value.message.trim())
      : Boolean(value.title.trim());

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="delivery-dialog github-delivery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-delivery-dialog-title"
      >
        <span className="delivery-dialog-icon" aria-hidden="true">
          {action === "push" ? (
            <UploadCloud size={18} />
          ) : (
            <GitPullRequestDraft size={18} />
          )}
        </span>
        <form onSubmit={submit}>
          <div className="delivery-dialog-copy">
            <h2 id="github-delivery-dialog-title">
              {action === "push" ? t("commitAndPush") : t("createDraftPr")}
            </h2>
            <p>
              {action === "push"
                ? t("commitAndPushDescription")
                : t("createDraftPrDescription")}
            </p>
            {value.action === "push" ? (
              <label className="delivery-commit-field">
                <span>{t("commitMessage")}</span>
                <input
                  ref={firstField}
                  value={value.message}
                  maxLength={1_000}
                  disabled={busy}
                  onChange={(event) =>
                    onChange({ ...value, message: event.target.value })
                  }
                />
              </label>
            ) : (
              <div className="github-pr-fields">
                <label className="delivery-commit-field">
                  <span>{t("pullRequestTitle")}</span>
                  <input
                    ref={firstField}
                    value={value.title}
                    maxLength={256}
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ ...value, title: event.target.value })
                    }
                  />
                </label>
                <label className="delivery-commit-field">
                  <span>{t("pullRequestDescription")}</span>
                  <textarea
                    value={value.body}
                    maxLength={20_000}
                    rows={5}
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ ...value, body: event.target.value })
                    }
                  />
                </label>
              </div>
            )}
            {error && <p className="delivery-dialog-error">{error}</p>}
          </div>
          <div className="delivery-dialog-actions">
            <button
              ref={cancelButton}
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
              disabled={busy || !valid}
            >
              {busy && <LoaderCircle className="spin" size={14} />}
              {busy
                ? t("publishingToGitHub")
                : action === "push"
                  ? t("commitAndPush")
                  : t("createDraftPr")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function codeHostCiKey(
  status: CodeHostPullRequest["ciStatus"],
): "ciNone" | "ciPending" | "ciSuccess" | "ciFailure" {
  if (status === "pending") return "ciPending";
  if (status === "success") return "ciSuccess";
  if (status === "failure") return "ciFailure";
  return "ciNone";
}

function humanizeGitHubState(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function WorktreeDeliveryDialog({
  action,
  preflight,
  message,
  busy,
  error,
  onMessageChange,
  onCancel,
  onConfirm,
}: {
  action: "apply" | "commit";
  preflight: WorktreeDeliveryPreflight;
  message: string;
  busy: boolean;
  error?: string;
  onMessageChange(message: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  const messageInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const blocked =
    preflight.branchChanged || preflight.conflicts.length > 0;
  const alreadyApplied =
    action === "apply" && preflight.pendingFiles === 0;

  useEffect(() => {
    if (action === "commit" && !blocked) {
      messageInput.current?.focus();
      messageInput.current?.select();
    } else {
      cancelButton.current?.focus();
    }
  }, [action, blocked]);

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="delivery-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delivery-dialog-title"
        aria-describedby="delivery-dialog-description"
      >
        <span
          className={`delivery-dialog-icon ${blocked ? "blocked" : ""}`}
          aria-hidden="true"
        >
          {blocked ? (
            <TriangleAlert size={18} />
          ) : action === "commit" ? (
            <GitCommitHorizontal size={18} />
          ) : (
            <GitMerge size={18} />
          )}
        </span>
        <div className="delivery-dialog-copy">
          <h2 id="delivery-dialog-title">
            {blocked
              ? t("deliveryBlocked")
              : action === "commit"
                ? t("commitDeliveryQuestion")
                : t("applyDeliveryQuestion")}
          </h2>
          <p id="delivery-dialog-description">
            {t("deliveryPreflightSummary", {
              count: preflight.files,
              branch: preflight.targetBranch,
            })}
          </p>
          {(preflight.localOnlyFiles ?? 0) > 0 && (
            <p className="delivery-dialog-notice">
              {t("deliveryLocalDataSummary", {
                count: preflight.localOnlyFiles ?? 0,
              })}
            </p>
          )}
          <div className="delivery-branch-route">
            <code>{preflight.taskBranch}</code>
            <GitMerge size={14} aria-hidden="true" />
            <code>{preflight.targetBranch}</code>
          </div>
          {preflight.branchChanged && (
            <p className="delivery-dialog-warning">
              {t("deliveryBranchChanged", {
                source: preflight.sourceBranch ?? "",
                target: preflight.targetBranch,
              })}
            </p>
          )}
          {preflight.conflicts.length > 0 && (
            <div className="delivery-conflicts">
              <strong>
                {t("deliveryConflicts", {
                  count: preflight.conflicts.length,
                })}
              </strong>
              <ul>
                {preflight.conflicts.slice(0, 8).map((conflict) => (
                  <li key={conflict.path}>
                    <code>{conflict.path}</code>
                    <span>{t(deliveryConflictKey(conflict.reason))}</span>
                  </li>
                ))}
              </ul>
              {preflight.conflicts.length > 8 && (
                <small>
                  {t("moreDeliveryConflicts", {
                    count: preflight.conflicts.length - 8,
                  })}
                </small>
              )}
            </div>
          )}
          {alreadyApplied && (
            <p className="delivery-dialog-notice">
              {t("deliveryAlreadyApplied")}
            </p>
          )}
          {action === "commit" && !blocked && (
            <label className="delivery-commit-field">
              <span>{t("commitMessage")}</span>
              <input
                ref={messageInput}
                value={message}
                maxLength={1_000}
                disabled={busy}
                onChange={(event) => onMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    message.trim() &&
                    !busy
                  ) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </label>
          )}
          {error && <p className="delivery-dialog-error">{error}</p>}
        </div>
        <div className="delivery-dialog-actions">
          <button
            ref={cancelButton}
            type="button"
            className="dialog-button secondary pressable"
            disabled={busy}
            onClick={onCancel}
          >
            {blocked || alreadyApplied ? t("close") : t("cancel")}
          </button>
          {!blocked && !alreadyApplied && (
            <button
              type="button"
              className="dialog-button primary pressable"
              disabled={
                busy || (action === "commit" && !message.trim())
              }
              onClick={onConfirm}
            >
              {busy && <LoaderCircle className="spin" size={14} />}
              {busy
                ? t("delivering")
                : action === "commit"
                  ? t("stageAndCommit")
                  : t("applyToOriginal")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function deliveryConflictKey(
  reason: WorktreeDeliveryConflict["reason"],
):
  | "deliveryConflictBothAdded"
  | "deliveryConflictTargetDeleted"
  | "deliveryConflictTargetModified"
  | "deliveryConflictMerge"
  | "deliveryConflictUnsafe" {
  if (reason === "both_added") return "deliveryConflictBothAdded";
  if (reason === "target_deleted") return "deliveryConflictTargetDeleted";
  if (reason === "target_modified") return "deliveryConflictTargetModified";
  if (reason === "unsafe_target") return "deliveryConflictUnsafe";
  return "deliveryConflictMerge";
}

export function FileView({
  adapter,
  projectId,
  threadId,
  projectName,
  path,
  source = "workspace",
  line,
  revealRequest,
  hidden = false,
  onSelectFile,
  onOpenSystemFile,
  remoteSystemFiles = false,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  threadId?: string;
  projectName: string;
  path?: string;
  source?: "workspace" | "system";
  line?: number;
  revealRequest?: number;
  hidden?: boolean;
  onSelectFile(path: string): void;
  onOpenSystemFile?(): Promise<void>;
  remoteSystemFiles?: boolean;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<WorkspaceFile>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [treeVisible, setTreeVisible] = useState(true);
  const [choosingSystemFile, setChoosingSystemFile] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string>();

  useEffect(() => {
    if (!path) {
      setFile(undefined);
      setLoading(false);
      setError(undefined);
      setRevealError(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    setRevealError(undefined);
    const read =
      source === "system"
        ? adapter.readSystemFile
          ? adapter.readSystemFile(path)
          : Promise.reject(new Error(t("systemFileAccessUnavailable")))
        : adapter.read(projectId, path, threadId);
    void read
      .then((next) => {
        if (active) setFile(next);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, path, projectId, revealRequest, source, t, threadId]);

  useEffect(() => {
    if (source === "system" || isPlanDocumentPath(path)) {
      setTreeVisible(false);
    }
  }, [path, source]);

  async function chooseSystemFile() {
    if (!onOpenSystemFile || choosingSystemFile) return;
    setChoosingSystemFile(true);
    setError(undefined);
    try {
      await onOpenSystemFile();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setChoosingSystemFile(false);
    }
  }

  const canReveal = Boolean(
    path &&
      (source === "system"
        ? !remoteSystemFiles && adapter.revealSystemFile
        : adapter.reveal),
  );

  async function revealFile() {
    if (!path || !canReveal || revealing) return;
    setRevealing(true);
    setRevealError(undefined);
    try {
      if (source === "system") {
        await adapter.revealSystemFile?.(path);
      } else {
        await adapter.reveal?.(projectId, path, threadId);
      }
    } catch (reason) {
      setRevealError(
        t("revealFileFailed", { message: errorMessage(reason) }),
      );
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="file-view" role="tabpanel" hidden={hidden}>
      <div className="file-view-toolbar">
        <Breadcrumb
          projectName={projectName}
          path={path}
          source={source}
          remoteSystemFiles={remoteSystemFiles}
        />
        <div className="file-view-actions">
          {source === "system" &&
            path &&
            !remoteSystemFiles &&
            adapter.revealSystemFile && (
            <button
              type="button"
              className="panel-icon-button pressable"
              aria-label={t("revealInFinder")}
              title={t("revealInFinder")}
              disabled={revealing}
              onClick={() => void revealFile()}
            >
              {revealing ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FolderOpen size={16} />
              )}
            </button>
          )}
          {onOpenSystemFile && (
            <button
              type="button"
              className="panel-icon-button pressable"
              aria-label={
                remoteSystemFiles
                  ? t("openRemoteFile")
                  : t("openSystemFile")
              }
              title={
                remoteSystemFiles
                  ? t("openRemoteFile")
                  : t("openSystemFile")
              }
              disabled={choosingSystemFile}
              onClick={() => void chooseSystemFile()}
            >
              {choosingSystemFile ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileCode2 size={16} />
              )}
            </button>
          )}
          <button
            type="button"
            className={`panel-icon-button pressable ${treeVisible ? "active" : ""}`}
            aria-label={treeVisible ? t("hideFileTree") : t("showFileTree")}
            aria-pressed={treeVisible}
            title={treeVisible ? t("hideFileTree") : t("showFileTree")}
            onClick={() => setTreeVisible((visible) => !visible)}
          >
            <FolderTree size={16} />
          </button>
        </div>
      </div>
      <div className={`file-view-body ${treeVisible ? "has-tree" : ""}`}>
        <div className="file-preview">
          {loading ? (
            <PanelState icon={<LoaderCircle className="spin" size={20} />}>
              {t("openingFile")}
            </PanelState>
          ) : error ? (
            <PanelState icon={<FileCode2 size={20} />} error>
              {error}
            </PanelState>
          ) : !path ? (
            <PanelState icon={<FolderOpen size={22} />}>
              <strong>{t("openFile")}</strong>
              <span>{t("selectFile")}</span>
              {onOpenSystemFile && (
                <button
                  type="button"
                  className="panel-empty-action pressable"
                  disabled={choosingSystemFile}
                  onClick={() => void chooseSystemFile()}
                >
                  {choosingSystemFile ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <FileCode2 size={14} />
                  )}
                  {remoteSystemFiles
                    ? t("openRemoteFile")
                    : t("openSystemFile")}
                </button>
              )}
            </PanelState>
          ) : file?.binary || file?.content === undefined ? (
            <PanelState icon={<FileCode2 size={20} />}>
              <strong>{t("binaryPreview")}</strong>
              {file && (
                <span>{t("fileSize", { size: formatFileSize(file.size) })}</span>
              )}
              {canReveal && (
                <button
                  type="button"
                  className="panel-empty-action pressable"
                  disabled={revealing}
                  onClick={() => void revealFile()}
                >
                  {revealing ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <FolderOpen size={14} />
                  )}
                  {t("revealInFinder")}
                </button>
              )}
              {revealError && (
                <span className="workspace-panel-inline-error" role="status">
                  {revealError}
                </span>
              )}
            </PanelState>
          ) : isPlanDocumentPath(file.path) ? (
            <PlanDocument content={file.content} />
          ) : (
            <FileSource
              name={file.name}
              content={file.content}
              line={line}
              revealRequest={revealRequest}
            />
          )}
          {revealError && file?.content !== undefined && (
            <p className="workspace-panel-inline-error" role="status">
              {revealError}
            </p>
          )}
        </div>
        {treeVisible && (
          <WorkspaceTree
            adapter={adapter}
            projectId={projectId}
            threadId={threadId}
            selectedPath={path}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </div>
  );
}

export function PlanDocument({ content }: { content: string }) {
  return (
    <article className="plan-document">
      <MarkdownContent>{content}</MarkdownContent>
    </article>
  );
}

export function isPlanDocumentPath(
  path: string | undefined,
): path is string {
  return !!path && /^\.threadlight\/plans\/[A-Za-z0-9_-]+\.md$/.test(path);
}

export function FileSource({
  name,
  content,
  line,
  revealRequest,
}: {
  name: string;
  content: string;
  line?: number;
  revealRequest?: number;
}) {
  const { t } = useI18n();
  const source = useRef<HTMLDivElement>(null);
  const lines = useMemo(
    () => highlightedFileLines(name, content),
    [content, name],
  );
  const targetLine = line && line <= lines.length ? line : undefined;

  useEffect(() => {
    if (!targetLine || !revealRequest) return;
    source.current
      ?.querySelector<HTMLElement>(`[data-line="${targetLine}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [revealRequest, targetLine]);

  return (
    <div
      ref={source}
      className="file-source"
      role="region"
      aria-label={t("sourceCode", { name })}
    >
      {lines.map((segments, index) => (
        <div
          className={`file-source-line ${index + 1 === targetLine ? "target" : ""}`}
          data-line={index + 1}
          key={index}
        >
          <span className="file-source-line-number" aria-hidden="true">
            {index + 1}
          </span>
          <code>
            {segments.length > 0
              ? segments.map((segment, segmentIndex) => (
                  <span
                    className={segment.className}
                    key={`${segmentIndex}-${segment.text.length}`}
                  >
                    {segment.text}
                  </span>
                ))
              : "\u200b"}
          </code>
        </div>
      ))}
    </div>
  );
}

interface HighlightSegment {
  text: string;
  className?: string;
}

interface HighlightNode {
  type: string;
  value?: string;
  properties?: {
    className?: string | readonly string[];
  };
  children?: readonly HighlightNode[];
}

export function highlightedFileLines(
  name: string,
  content: string,
): HighlightSegment[][] {
  const language = languageForPath(name);
  if (!language || !refractor.registered(language)) {
    return content.split("\n").map((text) => text ? [{ text }] : []);
  }

  try {
    const root = refractor.highlight(content, language) as HighlightNode;
    const lines: HighlightSegment[][] = [[]];

    const appendText = (text: string, classNames: readonly string[]) => {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (part) {
          lines[lines.length - 1].push({
            text: part,
            ...(classNames.length > 0
              ? { className: [...new Set(classNames)].join(" ") }
              : {}),
          });
        }
        if (index < parts.length - 1) lines.push([]);
      });
    };

    const visit = (
      node: HighlightNode,
      inheritedClassNames: readonly string[],
    ) => {
      if (node.type === "text") {
        appendText(node.value ?? "", inheritedClassNames);
        return;
      }
      const ownClassName = node.properties?.className;
      const ownClassNames = Array.isArray(ownClassName)
        ? ownClassName.filter(
            (className): className is string => typeof className === "string",
          )
        : typeof ownClassName === "string"
          ? ownClassName.split(/\s+/).filter(Boolean)
          : [];
      const classNames = [...inheritedClassNames, ...ownClassNames];
      for (const child of node.children ?? []) visit(child, classNames);
    };

    visit(root, []);
    return lines;
  } catch {
    return content.split("\n").map((text) => text ? [{ text }] : []);
  }
}

interface ChangeTreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  children: ChangeTreeNode[];
  change?: ConversationFileChange;
}

export function ReviewChangesTree({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: readonly ConversationFileChange[];
  selectedPath?: string;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildChangeTree(files), [files]);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  function toggleDirectory(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <aside
      className="workspace-tree review-changes-tree"
      aria-label={t("changesTree")}
    >
      <label className="workspace-tree-search">
        <span className="visually-hidden">{t("filterChangedFiles")}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("filterFiles")}
        />
      </label>
      <div className="workspace-tree-scroll">
        <ChangeTreeLevel
          nodes={tree}
          depth={0}
          collapsed={collapsed}
          query={normalizedQuery}
          selectedPath={selectedPath}
          onToggle={toggleDirectory}
          onSelectFile={onSelectFile}
        />
      </div>
    </aside>
  );
}

function ChangeTreeLevel({
  nodes,
  depth,
  collapsed,
  query,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  nodes: readonly ChangeTreeNode[];
  depth: number;
  collapsed: Set<string>;
  query: string;
  selectedPath?: string;
  onToggle(path: string): void;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.type === "directory";
        const isCollapsed = collapsed.has(node.path);
        const matches =
          !query ||
          node.path.toLocaleLowerCase().includes(query) ||
          node.children.some((child) =>
            changeTreeContainsQuery(child, query),
          );
        if (!matches) return null;
        return (
          <div key={node.path}>
            <button
              type="button"
              className={`workspace-tree-row pressable ${node.path === selectedPath ? "selected" : ""}`}
              style={{ paddingInlineStart: `${10 + depth * 15}px` }}
              onClick={() =>
                isDirectory ? onToggle(node.path) : onSelectFile(node.path)
              }
              title={node.path}
            >
              {isDirectory ? (
                <>
                  {isCollapsed ? (
                    <ChevronRight className="tree-chevron" size={14} />
                  ) : (
                    <ChevronDown className="tree-chevron" size={14} />
                  )}
                  {isCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}
                </>
              ) : (
                <>
                  <span className="tree-chevron-spacer" />
                  <FileCode2 size={14} />
                </>
              )}
              <span className="workspace-tree-name">{node.name}</span>
              {isDirectory ? (
                <span
                  className="review-change-directory-indicator"
                  aria-label={t("containsChanges")}
                />
              ) : node.change ? (
                <ChangeStatus status={node.change.status} />
              ) : null}
            </button>
            {isDirectory && !isCollapsed && (
              <ChangeTreeLevel
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                query={query}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function ChangeStatus({
  status,
}: {
  status: ConversationFileChange["status"];
}) {
  const { t } = useI18n();
  const label =
    status === "added"
      ? t("added")
      : status === "deleted"
        ? t("deleted")
        : t("modified");
  return (
    <span className={`review-change-status ${status}`} aria-label={label}>
      {status === "added" ? "+" : status === "deleted" ? "−" : "•"}
    </span>
  );
}

export function WorkspaceTree({
  adapter,
  projectId,
  threadId,
  selectedPath,
  onSelectFile,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  threadId?: string;
  selectedPath?: string;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entries, setEntries] = useState<
    Map<string, readonly WorkspaceEntry[]>
  >(() => new Map());
  const [loading, setLoading] = useState<Set<string>>(() => new Set([""]));
  const [error, setError] = useState<string>();

  const loadDirectory = useCallback(
    async (path = "") => {
      setLoading((current) => new Set(current).add(path));
      setError(undefined);
      try {
        const next = await adapter.list(
          projectId,
          path || undefined,
          threadId,
        );
        setEntries((current) => new Map(current).set(path, next));
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [adapter, projectId, threadId],
  );

  useEffect(() => {
    setEntries(new Map());
    setExpanded(new Set());
    void loadDirectory();
  }, [loadDirectory]);

  async function toggleDirectory(path: string) {
    const isExpanded = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded && !entries.has(path)) await loadDirectory(path);
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();

  return (
    <aside className="workspace-tree" aria-label={t("workspaceTree")}>
      <label className="workspace-tree-search">
        <span className="visually-hidden">{t("filterFiles")}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("filterFiles")}
        />
      </label>
      <div className="workspace-tree-scroll">
        {error && <p className="workspace-tree-error">{error}</p>}
        {loading.has("") && !entries.has("") ? (
          <div className="workspace-tree-loading">
            <LoaderCircle className="spin" size={15} /> {t("loading")}
          </div>
        ) : (
          <TreeLevel
            directory=""
            depth={0}
            entries={entries}
            expanded={expanded}
            loading={loading}
            query={normalizedQuery}
            selectedPath={selectedPath}
            onToggle={(path) => void toggleDirectory(path)}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </aside>
  );
}

function TreeLevel({
  directory,
  depth,
  entries,
  expanded,
  loading,
  query,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  directory: string;
  depth: number;
  entries: Map<string, readonly WorkspaceEntry[]>;
  expanded: Set<string>;
  loading: Set<string>;
  query: string;
  selectedPath?: string;
  onToggle(path: string): void;
  onSelectFile(path: string): void;
}) {
  const children = entries.get(directory) ?? [];
  return (
    <>
      {children.map((entry) => {
        const matches =
          !query || entry.name.toLocaleLowerCase().includes(query);
        const isDirectory = entry.type === "directory";
        const isExpanded = expanded.has(entry.path);
        return (
          <div key={entry.path} hidden={!matches && !isDirectory}>
            <button
              type="button"
              className={`workspace-tree-row pressable ${entry.path === selectedPath ? "selected" : ""}`}
              style={{ paddingInlineStart: `${10 + depth * 15}px` }}
              onClick={() =>
                isDirectory ? onToggle(entry.path) : onSelectFile(entry.path)
              }
              title={entry.path}
            >
              {isDirectory ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="tree-chevron" size={14} />
                  ) : (
                    <ChevronRight className="tree-chevron" size={14} />
                  )}
                  {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                </>
              ) : (
                <>
                  <span className="tree-chevron-spacer" />
                  <FileCode2 size={14} />
                </>
              )}
              <span className="workspace-tree-name">{entry.name}</span>
              {isDirectory && loading.has(entry.path) && (
                <LoaderCircle className="spin tree-loading" size={12} />
              )}
            </button>
            {isDirectory && isExpanded && (
              <TreeLevel
                directory={entry.path}
                depth={depth + 1}
                entries={entries}
                expanded={expanded}
                loading={loading}
                query={query}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function Breadcrumb({
  projectName,
  path,
  source = "workspace",
  remoteSystemFiles = false,
}: {
  projectName: string;
  path?: string;
  source?: "workspace" | "system";
  remoteSystemFiles?: boolean;
}) {
  const { t } = useI18n();
  const parts = path?.replaceAll("\\", "/").split("/").filter(Boolean) ?? [];
  return (
    <nav
      className="file-breadcrumb"
      aria-label={t("filePath")}
      title={source === "system" ? path : undefined}
    >
      <span>
        {source === "system"
          ? remoteSystemFiles
            ? t("remoteFiles")
            : t("systemFiles")
          : projectName}
      </span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          <ChevronRight size={14} />
          <strong aria-current={index === parts.length - 1 ? "page" : undefined}>
            {part}
          </strong>
        </span>
      ))}
    </nav>
  );
}

function ChangeCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="change-counts">
      <span className="change-additions">+{additions}</span>
      <span className="change-deletions">-{deletions}</span>
    </span>
  );
}

function PanelState({
  icon,
  error,
  children,
}: {
  icon: ReactNode;
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`workspace-panel-state ${error ? "error" : ""}`}>
      <span>{icon}</span>
      {typeof children === "string" ? <p>{children}</p> : children}
    </div>
  );
}

function WorkspacePanelEmpty({ onAdd }: { onAdd(): void }) {
  const { t } = useI18n();
  return (
    <PanelState icon={<FolderTree size={22} />}>
      <strong>{t("noOpenTabs")}</strong>
      <button type="button" className="panel-empty-action pressable" onClick={onAdd}>
        <Plus size={14} /> {t("newFileTab")}
      </button>
    </PanelState>
  );
}

function createReviewTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "review",
    title: t("review"),
  };
}

function createFileTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "file",
    title: t("openFile"),
  };
}

function createTerminalTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "terminal",
    title: t("terminal"),
  };
}

function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

export function formatFileSize(size: number): string {
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  if (size < 1_000_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  return `${(size / 1_000_000_000).toFixed(1)} GB`;
}

export function buildChangeTree(
  files: readonly ConversationFileChange[],
): ChangeTreeNode[] {
  const root: ChangeTreeNode[] = [];

  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    const parts = file.path.split("/").filter(Boolean);
    let children = root;
    let currentPath = "";
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = children.find(
        (candidate) =>
          candidate.path === currentPath &&
          candidate.type === (isFile ? "file" : "directory"),
      );
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "directory",
          children: [],
          ...(isFile ? { change: file } : {}),
        };
        children.push(node);
      }
      children = node.children;
    });
  }

  sortChangeTree(root);
  return root;
}

function sortChangeTree(nodes: ChangeTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortChangeTree(node.children);
}

function changeTreeContainsQuery(node: ChangeTreeNode, query: string): boolean {
  return (
    node.path.toLocaleLowerCase().includes(query) ||
    node.children.some((child) => changeTreeContainsQuery(child, query))
  );
}

function reviewFileId(path: string): string {
  return `review-file-${encodeURIComponent(path)}`;
}

function languageForPath(path: string): string | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return {
    bash: "bash",
    c: "c",
    cjs: "javascript",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    kt: "kotlin",
    less: "less",
    lua: "lua",
    md: "markdown",
    mjs: "javascript",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sass: "sass",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    ts: "typescript",
    tsx: "tsx",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  }[extension ?? ""];
}

const diffStyles = {
  variables: {
    light: {
      diffViewerBackground: "#ffffff",
      diffViewerColor: "#33332f",
      addedBackground: "#edf7ee",
      addedColor: "#286a3d",
      removedBackground: "#fff0ef",
      removedColor: "#9f3934",
      wordAddedBackground: "#ccebd2",
      wordRemovedBackground: "#f4cfcc",
      addedGutterBackground: "#def0e1",
      removedGutterBackground: "#f7dfdd",
      gutterBackground: "#f7f7f4",
      gutterBackgroundDark: "#efefeb",
      highlightBackground: "#fffbdd",
      highlightGutterBackground: "#fff5b1",
      codeFoldGutterBackground: "#f2f2ee",
      codeFoldBackground: "#f7f7f4",
      emptyLineBackground: "#fafaf8",
      gutterColor: "#8b8a83",
      addedGutterColor: "#2f8149",
      removedGutterColor: "#b14942",
      codeFoldContentColor: "#77766f",
    },
    dark: {
      diffViewerBackground: "#202124",
      diffViewerColor: "#dededa",
      addedBackground: "#183426",
      addedColor: "#83c596",
      removedBackground: "#3b2224",
      removedColor: "#ef938c",
      wordAddedBackground: "#285239",
      wordRemovedBackground: "#613237",
      addedGutterBackground: "#203e2d",
      removedGutterBackground: "#48282b",
      gutterBackground: "#25262a",
      gutterBackgroundDark: "#2d2e32",
      highlightBackground: "#423b24",
      highlightGutterBackground: "#554b29",
      codeFoldGutterBackground: "#292a2e",
      codeFoldBackground: "#25262a",
      emptyLineBackground: "#222326",
      gutterColor: "#858581",
      addedGutterColor: "#79bb8b",
      removedGutterColor: "#e1857f",
      codeFoldContentColor: "#a7a7a2",
    },
  },
  diffContainer: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "12px",
    lineHeight: 1.6,
  },
  lineNumber: {
    minWidth: "44px",
  },
  contentText: {
    padding: "0 10px",
  },
} as const;

const unifiedDiffStyles = {
  ...diffStyles,
  lineNumber: {
    ...diffStyles.lineNumber,
    minWidth: "32px",
  },
} as const;

export function reviewDiffStylesForLayout(
  layout: "unified" | "split",
) {
  return layout === "unified" ? unifiedDiffStyles : diffStyles;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
