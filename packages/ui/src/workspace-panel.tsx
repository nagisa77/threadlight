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
import type { AgentTreeData } from "@threadlight/protocol";

import { PanelAddMenu, type PanelViewKind } from "./panel-add-menu.js";
import { Dialog } from "./dialog.js";
import { MarkdownContent } from "./markdown.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme } from "./theme.js";
import { languageForPath } from "./source-language.js";
import type { HighlightSegment } from "./syntax-highlighter.js";
import { TerminalView, type TerminalAdapter } from "./terminal.js";
import {
  AgentPanel,
  type AgentPanelControls,
} from "./features/task-session/agent-panel.js";
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

export interface WorkspaceTab {
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
  agentRequest?: number;
  fileOpenRequest?: number;
}

export function workspacePanelRequestSteps(
  previous: WorkspacePanelRequestSnapshot | undefined,
  next: WorkspacePanelRequestSnapshot,
): readonly ("reset" | "review" | "delivery" | "agents" | "file")[] {
  const steps: ("reset" | "review" | "delivery" | "agents" | "file")[] = [];
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
    (next.agentRequest ?? 0) !== 0 &&
    previous?.agentRequest !== next.agentRequest
  ) {
    steps.push("agents");
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
  agentPanel,
  agentControls,
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
  agentPanel?: {
    tree?: AgentTreeData;
    live: boolean;
    request: number;
  };
  agentControls?: AgentPanelControls;
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
    agentRequest: agentPanel?.request ?? 0,
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
      if (step === "agents") {
        openAgentPanel();
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
    agentPanel?.request,
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
            : tab.kind === "agents"
              ? t("agents")
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
          : kind === "agents"
            ? createAgentTab(t)
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

  function openAgentPanel() {
    setTabs((current) => {
      const existing = current.find((tab) => tab.kind === "agents");
      if (existing) {
        setActiveTabId(existing.id);
        return current;
      }
      const next = createAgentTab(t);
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
                  ) : tab.kind === "agents" ? (
                    <GitBranch size={14} />
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
                      ...(agentPanel?.tree ? (["agents"] as const) : []),
                      "file",
                    ]
                  : deliveryEnabled
                    ? [
                        "delivery",
                        ...(agentPanel?.tree ? (["agents"] as const) : []),
                        "file",
                      ]
                    : agentPanel?.tree
                      ? ["agents", "file"]
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
          ) : activeTab?.kind === "agents" ? (
            <AgentPanel
              tree={agentPanel?.tree}
              live={agentPanel?.live}
              controls={agentControls}
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

export {
  FileSource,
  FileView,
  PlanDocument,
  WorkspaceTree,
  fileName,
  formatFileSize,
  isPlanDocumentPath,
} from "./workspace-file-view.js";
import {
  FileView,
  WorkspacePanelEmpty,
  WorkspaceTree,
  createAgentTab,
  createDeliveryTab,
  createFileTab,
  createReviewTab,
  createTerminalTab,
  errorMessage,
  fileName,
  isPlanDocumentPath,
} from "./workspace-file-view.js";
