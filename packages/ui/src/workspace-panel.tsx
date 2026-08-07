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
  Download,
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
import { Dialog } from "./dialog.js";
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
} from "./features/delivery/workspace-types.js";
import {
  DeliveryCenterView,
  GitHubDeliveryCard,
  WorktreeDeliveryDialog,
} from "./features/delivery/delivery-center.js";
import {
  ChangeCounts,
  PanelState,
} from "./features/delivery/workspace-primitives.js";
import { ReviewView } from "./features/delivery/review-view.js";
export {
  ReviewChangesTree,
  ReviewView,
  buildChangeTree,
  reviewDiffStylesForLayout,
} from "./features/delivery/review-view.js";
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
} from "./features/delivery/workspace-types.js";
export {
  DeliveryCenterView,
  GitHubDeliveryCard,
  GitHubDeliveryDialog,
} from "./features/delivery/delivery-center.js";
export type { PendingGitHubAction } from "./features/delivery/delivery-center.js";

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

export interface WorkspacePanelRequestSnapshot {
  scope: string;
  reviewRequest: number;
  deliveryRequest: number;
  fileOpenRequest?: number;
}

export function workspacePanelRequestSteps(
  previous: WorkspacePanelRequestSnapshot | undefined,
  next: WorkspacePanelRequestSnapshot,
): readonly ("reset" | "review" | "delivery" | "file")[] {
  const steps: ("reset" | "review" | "delivery" | "file")[] = [];
  if (!previous || previous.scope !== next.scope) steps.push("reset");
  if (
    next.reviewRequest !== 0 &&
    previous?.reviewRequest !== next.reviewRequest
  ) {
    steps.push("review");
  }
  if (
    next.deliveryRequest !== 0 &&
    previous?.deliveryRequest !== next.deliveryRequest
  ) {
    steps.push("delivery");
  }
  if (
    next.fileOpenRequest !== undefined &&
    previous?.fileOpenRequest !== next.fileOpenRequest
  ) {
    steps.push("file");
  }
  return steps;
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
  const requestSnapshot = {
    scope: `${projectId}\u0000${remoteFileRoot ?? ""}\u0000${threadId ?? ""}`,
    reviewRequest,
    deliveryRequest,
    fileOpenRequest: fileOpenRequest?.id,
  };
  const previousRequestSnapshot = useRef<
    WorkspacePanelRequestSnapshot | undefined
  >(undefined);

  useEffect(() => {
    const steps = workspacePanelRequestSteps(
      previousRequestSnapshot.current,
      requestSnapshot,
    );
    previousRequestSnapshot.current = requestSnapshot;

    for (const step of steps) {
      if (step === "reset") {
        setTabs([createFileTab(t)]);
        setActiveTabId("");
        setDiffLayout("unified");
        setRemoteFilePickerOpen(false);
        continue;
      }
      if (step === "review") {
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
        continue;
      }
      if (step === "delivery") {
        openDeliveryCenter();
        continue;
      }
      if (!fileOpenRequest) continue;
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
    }
  }, [
    deliveryRequest,
    fileOpenRequest?.id,
    projectId,
    remoteFileRoot,
    reviewRequest,
    threadId,
  ]);

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
              generatePullRequestDescription={generatePullRequestDescription}
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
  const pathInput = useRef<HTMLInputElement>(null);

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

  const entries = listing?.entries ?? [];
  return (
    <Dialog
      backdropClassName="dialog-backdrop remote-system-file-backdrop"
      className="connector-dialog remote-system-file-dialog"
      aria-labelledby="remote-system-file-title"
      initialFocusRef={pathInput}
      onClose={onCancel}
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
          ref={pathInput}
          value={path}
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
    </Dialog>
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();

  useEffect(() => {
    if (!path) {
      setFile(undefined);
      setLoading(false);
      setError(undefined);
      setRevealError(undefined);
      setDownloadError(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    setRevealError(undefined);
    setDownloadError(undefined);
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
    !remoteSystemFiles &&
    (source === "system" ? adapter.revealSystemFile : adapter.reveal),
  );
  const canDownload = Boolean(
    path &&
    remoteSystemFiles &&
    (source === "system" ? adapter.downloadSystemFile : adapter.download),
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

  async function downloadFile() {
    if (!path || !canDownload || downloading) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const content =
        source === "system"
          ? await adapter.downloadSystemFile?.(path)
          : await adapter.download?.(projectId, path, threadId);
      if (!content) throw new Error(t("fileDownloadUnavailable"));
      saveDownloadedFile(file?.name ?? fileName(path), content);
    } catch (reason) {
      setDownloadError(
        t("downloadFileFailed", { message: errorMessage(reason) }),
      );
    } finally {
      setDownloading(false);
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
              {canDownload ? (
                <button
                  type="button"
                  className="panel-empty-action pressable"
                  aria-label={t("downloadFile")}
                  disabled={downloading}
                  onClick={() => void downloadFile()}
                >
                  {downloading ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {t("downloadFile")}
                </button>
              ) : canReveal ? (
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
              ) : null}
              {(downloadError || revealError) && (
                <span className="workspace-panel-inline-error" role="status">
                  {downloadError ?? revealError}
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

function saveDownloadedFile(name: string, content: ArrayBuffer): void {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(content)], { type: "application/octet-stream" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
