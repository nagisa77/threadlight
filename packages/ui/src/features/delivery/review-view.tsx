import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  FileCode2,
  FileDiff,
  Folder,
  FolderOpen,
  FolderTree,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Rows3,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Dialog } from "../../dialog.js";
import { useI18n } from "../../i18n.js";
import { languageForPath } from "../../source-language.js";
import { useTheme } from "../../theme.js";
import { WorktreeDeliveryDialog } from "./delivery-center.js";
import { ChangeCounts, PanelState } from "./workspace-primitives.js";
import type {
  AutomaticDeliveryState,
  ConversationChangesSnapshot,
  ConversationFileChange,
  WorkspaceAdapter,
  WorktreeDeliveryPreflight,
  WorktreeDeliveryResult,
} from "./workspace-types.js";

const MAX_SIMULTANEOUS_REVIEW_FILES = 50;
const LazyReviewDiffViewer = lazy(() =>
  import("../../diff-viewer.js").then(({ ReviewDiffViewer }) => ({
    default: ReviewDiffViewer,
  })),
);

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

  return (
    <Dialog
      className="delete-dialog restore-dialog"
      role="alertdialog"
      aria-labelledby="restore-dialog-title"
      aria-describedby="restore-dialog-description"
      initialFocusRef={cancelButton}
      dismissDisabled={restoring}
      onClose={onCancel}
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
    </Dialog>
  );
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
    "@media (max-width: 720px)": {
      fontSize: "11px",
    },
  },
  lineNumber: {
    minWidth: "44px",
  },
  contentText: {
    padding: "0 10px",
    "@media (max-width: 720px)": {
      padding: "0 8px",
    },
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
