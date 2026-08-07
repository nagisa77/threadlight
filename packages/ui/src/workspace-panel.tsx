import {
  lazy,
  Suspense,
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
  ExternalLink,
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
  Info,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
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
import { createBrowserUuid } from "@threadlight/client";

import { PanelAddMenu, type PanelViewKind } from "./panel-add-menu.js";
import { MarkdownContent } from "./markdown.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme } from "./theme.js";
import { languageForPath } from "./source-language.js";
import type { HighlightSegment } from "./syntax-highlighter.js";
import { TerminalView, type TerminalAdapter } from "./terminal.js";
import {
  terminalTabLabel,
  terminalWorkspaceContextLabel,
} from "./terminal-context.js";

import type {
  AutomaticDeliveryState,
  CodeHostCheck,
  CodeHostCommitPushResult,
  CodeHostDeliverySetupIssue,
  CodeHostDeliveryStatus,
  CodeHostPullRequest,
  CodeHostReviewComment,
  ConversationChangesSnapshot,
  ConversationFileChange,
  PullRequestDescription,
  SystemFileEntry,
  SystemFileListing,
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFileOpenRequest,
  WorktreeDeliveryConflict,
  WorktreeDeliveryHistoryEntry,
  WorktreeDeliveryHistorySnapshot,
  WorktreeDeliveryPreflight,
  WorktreeDeliveryResult,
  WorktreeDeliveryUndoResult,
} from "./features/workspace-types.js";
import {
  DeliveryCenterView,
  GitHubDeliveryCard,
  WorktreeDeliveryDialog,
} from "./features/delivery-center.js";
import { ChangeCounts, PanelState } from "./features/workspace-primitives.js";
export type {
  AutomaticDeliveryState,
  CodeHostCheck,
  CodeHostCommitPushResult,
  CodeHostDeliverySetupIssue,
  CodeHostDeliveryStatus,
  CodeHostPullRequest,
  CodeHostReviewComment,
  ConversationChangesSnapshot,
  ConversationFileChange,
  PullRequestDescription,
  SystemFileEntry,
  SystemFileListing,
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFileOpenRequest,
  WorktreeDeliveryConflict,
  WorktreeDeliveryHistoryEntry,
  WorktreeDeliveryHistorySnapshot,
  WorktreeDeliveryPreflight,
  WorktreeDeliveryResult,
  WorktreeDeliveryUndoResult,
} from "./features/workspace-types.js";
export {
  DeliveryCenterView,
  GitHubDeliveryCard,
} from "./features/delivery-center.js";

const MAX_SIMULTANEOUS_REVIEW_FILES = 50;
const LazyReviewDiffViewer = lazy(() =>
  import("./diff-viewer.js").then(({ ReviewDiffViewer }) => ({
    default: ReviewDiffViewer,
  })),
);

interface WorkspaceTab {
  id: string;
  kind: "review" | PanelViewKind;
  path?: string;
  source?: "workspace" | "system";
  title: string;
  line?: number;
  column?: number;
  revealRequest?: number;
  branch?: string;
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
  deliveryRequest = 0,
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
  automaticDelivery,
  onRetryAutomaticDelivery,
  onUndoAutomaticDelivery,
  taskTitle,
  taskBranch,
  originalBranch,
  taskWorkspaceAvailable = true,
  generatePullRequestDescription,
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
  deliveryRequest?: number;
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
  automaticDelivery?: AutomaticDeliveryState;
  onRetryAutomaticDelivery?(): void;
  onUndoAutomaticDelivery?(): void | Promise<void>;
  taskTitle?: string;
  taskBranch?: string;
  originalBranch?: string;
  taskWorkspaceAvailable?: boolean;
  generatePullRequestDescription?(): Promise<PullRequestDescription>;
  onDiscardTask?(): void;
  toolbarActions?: ReactNode;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [createFileTab(t)]);
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
          (tab) => tab.kind === "file" && !tab.path && tab.id === activeTabId,
        ) ?? current.find((tab) => tab.kind === "file" && !tab.path);
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
  }, [projectId, remoteFileRoot, threadId]);

  useEffect(() => {
    if (deliveryRequest === 0) return;
    openDeliveryCenter();
  }, [deliveryRequest]);

  useEffect(() => {
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        title:
          tab.kind === "review"
            ? t("review")
            : tab.kind === "delivery"
              ? t("deliveryCenter")
              : tab.kind === "terminal"
                ? terminalTabLabel(
                    "task",
                    tab.branch ?? taskBranch,
                    undefined,
                    t,
                  )
                : tab.kind === "original-terminal"
                  ? terminalTabLabel(
                      "original",
                      tab.branch ?? originalBranch,
                      undefined,
                      t,
                    )
                  : tab.path
                    ? tab.title
                    : t("openFile"),
      })),
    );
  }, [originalBranch, taskBranch, t]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [activeTabId, tabs]);

  function addTab(kind: PanelViewKind) {
    const tab =
      kind === "terminal" || kind === "original-terminal"
        ? createTerminalTab(
            kind === "original-terminal" ? "original" : "task",
            kind === "original-terminal" ? originalBranch : taskBranch,
            t,
          )
        : kind === "delivery"
          ? createDeliveryTab(t)
          : createFileTab(t);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function addFileTab() {
    addTab("file");
  }

  function openDeliveryCenter() {
    setTabs((current) => {
      const existing = current.find((tab) => tab.kind === "delivery");
      if (existing) {
        setActiveTabId(existing.id);
        return current;
      }
      const next = createDeliveryTab(t);
      setActiveTabId(next.id);
      return [...current, next];
    });
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
                  title={tab.title}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.kind === "review" ? (
                    <FileDiff size={14} />
                  ) : tab.kind === "delivery" ? (
                    <PackageCheck size={14} />
                  ) : tab.kind === "terminal" ||
                    tab.kind === "original-terminal" ? (
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
              available={
                terminal
                  ? [
                      ...(taskWorkspaceAvailable
                        ? (["terminal"] as const)
                        : []),
                      "original-terminal",
                      ...(deliveryEnabled ? (["delivery"] as const) : []),
                      "file",
                    ]
                  : deliveryEnabled
                    ? ["delivery", "file"]
                    : ["file"]
              }
              taskTerminalLabel={terminalWorkspaceContextLabel(
                "task",
                taskBranch,
                t,
              )}
              originalTerminalLabel={terminalWorkspaceContextLabel(
                "original",
                originalBranch,
                t,
              )}
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
              .filter(
                (tab) =>
                  tab.kind === "terminal" || tab.kind === "original-terminal",
              )
              .map((tab) => (
                <TerminalView
                  key={tab.id}
                  adapter={terminal}
                  projectId={projectId}
                  threadId={threadId}
                  workspace={
                    tab.kind === "original-terminal" ? "original" : "task"
                  }
                  hidden={tab.id !== activeTab?.id}
                  label={tab.title}
                  onSessionChange={(session) => {
                    const terminalWorkspace =
                      tab.kind === "original-terminal" ? "original" : "task";
                    const branch =
                      session.branch ??
                      (terminalWorkspace === "original"
                        ? originalBranch
                        : taskBranch);
                    setTabs((current) =>
                      current.map((currentTab) =>
                        currentTab.id === tab.id
                          ? {
                              ...currentTab,
                              branch,
                              title: terminalTabLabel(
                                terminalWorkspace,
                                branch,
                                undefined,
                                t,
                              ),
                            }
                          : currentTab,
                      ),
                    );
                  }}
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
              automaticDelivery={automaticDelivery}
              defaultCommitMessage={taskTitle}
              generatePullRequestDescription={generatePullRequestDescription}
              onPreflightDelivery={adapter.preflightDelivery}
              onApplyDelivery={adapter.applyDelivery}
              onCommitDelivery={adapter.commitDelivery}
              onDiscardTask={onDiscardTask}
              onOpenDeliveryCenter={openDeliveryCenter}
              onLayoutChange={setDiffLayout}
              onRefresh={onRefreshChanges}
              onRestore={onRestoreChanges}
              restoreDisabled={restoreDisabled}
            />
          ) : activeTab?.kind === "delivery" ? (
            <DeliveryCenterView
              adapter={adapter}
              projectId={projectId}
              threadId={threadId}
              revision={changes?.revision}
              automaticDelivery={automaticDelivery}
              disabled={deliveryDisabled}
              defaultCommitMessage={taskTitle}
              onRetryAutomaticDelivery={onRetryAutomaticDelivery}
              onUndoAutomaticDelivery={onUndoAutomaticDelivery}
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
              onOpenSystemFile={canOpenSystemFile ? openSystemFile : undefined}
              remoteSystemFiles={Boolean(remoteFileRoot)}
            />
          ) : activeTab?.kind === "terminal" ? null : (
            <WorkspacePanelEmpty onAdd={addFileTab} />
          )}
        </div>
      </aside>
      {remoteFilePickerOpen && remoteFileRoot && adapter.listSystemFiles && (
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
            <div className="remote-system-file-state error" role="alert">
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
                    entry.kind === "file" && entry.path === selectedPath
                  }
                  className={`remote-system-file-row pressable ${
                    entry.kind === "file" && entry.path === selectedPath
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
                  {entry.kind === "directory" && <ChevronRight size={15} />}
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
  automaticDelivery,
  defaultCommitMessage,
  onPreflightDelivery,
  onApplyDelivery,
  onCommitDelivery,
  onDiscardTask,
  onOpenDeliveryCenter,
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
  automaticDelivery?: AutomaticDeliveryState;
  defaultCommitMessage?: string;
  onPreflightDelivery?: WorkspaceAdapter["preflightDelivery"];
  onApplyDelivery?: WorkspaceAdapter["applyDelivery"];
  onCommitDelivery?: WorkspaceAdapter["commitDelivery"];
  onDiscardTask?(): void;
  onOpenDeliveryCenter?(): void;
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

  useEffect(() => {
    if (!changes?.files.length) {
      setSelectedPath(undefined);
      return;
    }
    if (
      !selectedPath ||
      !changes.files.some((file) => file.path === selectedPath)
    ) {
      setSelectedPath(changes.files[0].path);
    }
  }, [changes, selectedPath]);

  useEffect(() => {
    if (largeChangeSet) setTreeVisible(true);
  }, [largeChangeSet]);

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
          ? await onApplyDelivery?.(projectId, threadId, changes.revision)
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

  const showDeliveryCenter = Boolean(deliveryEnabled && projectId && threadId);
  const canDeliverChanges = Boolean(
    changes?.files.length && onPreflightDelivery,
  );
  const localDataFiles =
    changes?.files.filter((file) => file.localOnly).length ?? 0;
  const deliveryScope =
    projectId && threadId ? `${projectId}\u0000${threadId}` : undefined;
  const deliveryState =
    automaticDelivery?.scope === deliveryScope ? automaticDelivery : undefined;
  const deliveryNeedsAttention =
    deliveryState?.status === "conflict" || deliveryState?.status === "failed";
  const compactDeliveryLabel =
    deliveryState?.status === "syncing"
      ? t("deliveryStatusSyncing")
      : deliveryState?.status === "undoing"
        ? t("deliveryStatusSyncing")
        : deliveryState?.status === "undone"
          ? t("deliveryStatusUndone")
          : deliveryState?.status === "conflict"
            ? t("deliveryStatusConflict")
            : deliveryState?.status === "failed"
              ? t("deliveryStatusFailed")
              : deliveryState?.status === "synced"
                ? deliveryState.result?.files === 0
                  ? t("deliveryStatusNoChanges")
                  : t("deliveryStatusSynced")
                : t("deliveryStatusWaiting");
  const compactDeliveryDetail =
    deliveryState?.status === "syncing"
      ? t("automaticDeliverySyncing")
      : deliveryState?.status === "undoing"
        ? t("automaticDeliveryUndoing")
        : deliveryState?.status === "undone"
          ? t("automaticDeliveryUndone")
          : deliveryNeedsAttention
            ? deliveryState.error
            : deliveryState?.result
              ? deliveryState.result.files === 0
                ? t("automaticDeliveryNoChanges")
                : t("automaticDeliverySynced", {
                    branch: deliveryState.result.targetBranch,
                    count: deliveryState.result.appliedFiles,
                  })
              : t("automaticDeliveryReady");

  return (
    <div className="review-view">
      <div className="review-toolbar">
        <div className="review-toolbar-main">
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
                {showDeliveryCenter && (
                  <button
                    type="button"
                    className={`review-delivery-indicator ${deliveryNeedsAttention ? "error" : (deliveryState?.status ?? "ready")} pressable`}
                    aria-label={`${t("openDeliveryCenter")}: ${compactDeliveryLabel}`}
                    aria-live="polite"
                    title={compactDeliveryDetail}
                    disabled={!onOpenDeliveryCenter}
                    onClick={onOpenDeliveryCenter}
                  >
                    {deliveryState?.status === "syncing" ||
                    deliveryState?.status === "undoing" ? (
                      <LoaderCircle className="spin" size={13} />
                    ) : deliveryNeedsAttention ? (
                      <TriangleAlert size={13} />
                    ) : deliveryState?.status === "undone" ? (
                      <RotateCcw size={13} />
                    ) : (
                      <GitMerge size={13} />
                    )}
                    <span>{compactDeliveryLabel}</span>
                    {onOpenDeliveryCenter && <ChevronRight size={12} />}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="review-view-controls">
            {changes && changes.files.length > 0 && onRestore && (
              <button
                type="button"
                className="review-toolbar-action restore pressable"
                disabled={loading || restoring || restoreDisabled}
                aria-label={t("restoreAllChanges")}
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
                <span>{t("restoreAll")}</span>
              </button>
            )}
            {showDeliveryCenter && onDiscardTask && (
              <button
                type="button"
                className="review-toolbar-action danger pressable"
                disabled={deliveryDisabled}
                aria-label={t("discardTask")}
                title={t("discardTaskDescription")}
                onClick={onDiscardTask}
              >
                <Trash2 size={14} />
                <span>{t("discardTask")}</span>
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
              aria-label={
                treeVisible ? t("hideChangesTree") : t("showChangesTree")
              }
              aria-pressed={treeVisible}
              title={treeVisible ? t("hideChangesTree") : t("showChangesTree")}
              onClick={() => setTreeVisible((visible) => !visible)}
            >
              <FolderTree size={16} />
            </button>
          </div>
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
                  restoreDisabled={!onRestore || restoreDisabled || restoring}
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
      {file.binary ||
      (file.oldContent === undefined && file.newContent === undefined) ? (
        <div className="review-binary">{t("binaryDiff")}</div>
      ) : (
        <div className="review-diff">
          <Suspense
            fallback={
              <div className="review-diff-loading" role="status">
                <LoaderCircle className="spin" size={15} />
                <span>{t("loading")}</span>
              </div>
            }
          >
            <LazyReviewDiffViewer
              oldValue={file.oldContent ?? ""}
              newValue={file.newContent ?? ""}
              layout={layout}
              dark={resolvedTheme === "dark"}
              language={languageForPath(file.path)}
              styles={reviewDiffStylesForLayout(layout)}
            />
          </Suspense>
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
        <span
          className="delete-dialog-icon restore-dialog-icon"
          aria-hidden="true"
        >
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
      setRevealError(t("revealFileFailed", { message: errorMessage(reason) }));
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
                remoteSystemFiles ? t("openRemoteFile") : t("openSystemFile")
              }
              title={
                remoteSystemFiles ? t("openRemoteFile") : t("openSystemFile")
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
                <span>
                  {t("fileSize", { size: formatFileSize(file.size) })}
                </span>
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

export function isPlanDocumentPath(path: string | undefined): path is string {
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
  const plainLines = useMemo(() => plainFileLines(content), [content]);
  const [highlighted, setHighlighted] = useState<{
    name: string;
    content: string;
    lines: HighlightSegment[][];
  }>();
  const lines =
    highlighted?.name === name && highlighted.content === content
      ? highlighted.lines
      : plainLines;
  const targetLine = line && line <= lines.length ? line : undefined;

  useEffect(() => {
    if (!languageForPath(name)) return;
    let current = true;
    void import("./syntax-highlighter.js")
      .then(({ highlightedFileLines }) => {
        if (!current) return;
        setHighlighted({
          name,
          content,
          lines: highlightedFileLines(name, content),
        });
      })
      .catch(() => {
        // Plain text remains readable if syntax highlighting cannot load.
      });
    return () => {
      current = false;
    };
  }, [content, name]);

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

function plainFileLines(content: string): HighlightSegment[][] {
  return content.split("\n").map((text) => (text ? [{ text }] : []));
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
          node.children.some((child) => changeTreeContainsQuery(child, query));
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
                  {isCollapsed ? (
                    <Folder size={15} />
                  ) : (
                    <FolderOpen size={15} />
                  )}
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
        const next = await adapter.list(projectId, path || undefined, threadId);
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
          <strong
            aria-current={index === parts.length - 1 ? "page" : undefined}
          >
            {part}
          </strong>
        </span>
      ))}
    </nav>
  );
}

function WorkspacePanelEmpty({ onAdd }: { onAdd(): void }) {
  const { t } = useI18n();
  return (
    <PanelState icon={<FolderTree size={22} />}>
      <strong>{t("noOpenTabs")}</strong>
      <button
        type="button"
        className="panel-empty-action pressable"
        onClick={onAdd}
      >
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

function createDeliveryTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "delivery",
    title: t("deliveryCenter"),
  };
}

function createFileTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "file",
    title: t("openFile"),
  };
}

function createTerminalTab(
  workspace: "task" | "original",
  branch: string | undefined,
  t: Translate,
): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: workspace === "original" ? "original-terminal" : "terminal",
    title: terminalTabLabel(workspace, branch, undefined, t),
    branch,
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
    left.path.localeCompare(right.path),
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
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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

export function reviewDiffStylesForLayout(layout: "unified" | "split") {
  return layout === "unified" ? unifiedDiffStyles : diffStyles;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
