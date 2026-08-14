import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronDown,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Info,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";

import { useI18n, type Translate } from "../../i18n.js";
import { Dialog } from "../../dialog.js";
import { ChangeCounts, PanelState } from "./workspace-primitives.js";
import type {
  AutomaticDeliveryState,
  CodeHostDeliverySetupIssue,
  CodeHostDeliveryStatus,
  CodeHostPullRequest,
  ConversationFileChange,
  WorkspaceAdapter,
  WorktreeDeliveryConflict,
  WorktreeDeliveryHistoryEntry,
  WorktreeDeliveryHistorySnapshot,
  WorktreeDeliveryPreflight,
} from "./workspace-types.js";

export function DeliveryCenterView({
  adapter,
  projectId,
  threadId,
  revision,
  automaticDelivery,
  disabled,
  defaultCommitMessage,
  generatePullRequestDescription,
  onRetryAutomaticDelivery,
  onUndoAutomaticDelivery,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  threadId?: string;
  revision?: string;
  automaticDelivery?: AutomaticDeliveryState;
  disabled: boolean;
  defaultCommitMessage?: string;
  generatePullRequestDescription?(): Promise<{
    title: string;
    body: string;
  }>;
  onRetryAutomaticDelivery?(): void | Promise<void>;
  onUndoAutomaticDelivery?(): void | Promise<void>;
}) {
  const { t } = useI18n();
  const [history, setHistory] = useState<WorktreeDeliveryHistorySnapshot>();
  const [codeHostStatus, setCodeHostStatus] =
    useState<CodeHostDeliveryStatus>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [busyAction, setBusyAction] = useState<"sync" | "retry" | "undo">();
  const [pendingManualSync, setPendingManualSync] =
    useState<WorktreeDeliveryPreflight>();
  const [pendingCodeHostAction, setPendingCodeHostAction] =
    useState<PendingGitHubAction>();
  const pullRequestDescriptionRequest = useRef(0);
  const scope = threadId ? `${projectId}\u0000${threadId}` : undefined;
  const liveState =
    automaticDelivery?.scope === scope ? automaticDelivery : undefined;

  const refresh = useCallback(async () => {
    if (!threadId || !adapter.getDeliveryHistory) {
      setHistory(undefined);
      setCodeHostStatus(undefined);
      setError(t("deliveryHistoryUnavailable"));
      return;
    }
    setLoading(true);
    setError(undefined);
    const failures: string[] = [];
    try {
      setHistory(await adapter.getDeliveryHistory(projectId, threadId));
    } catch (reason) {
      failures.push(errorMessage(reason));
    }
    if (revision && adapter.getCodeHostStatus) {
      try {
        setCodeHostStatus(
          await adapter.getCodeHostStatus(projectId, threadId, revision),
        );
      } catch (reason) {
        setCodeHostStatus(undefined);
        failures.push(errorMessage(reason));
      }
    } else {
      setCodeHostStatus(undefined);
    }
    setError(failures[0]);
    setLoading(false);
  }, [adapter, projectId, revision, t, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh, liveState?.status, liveState?.revision]);

  useEffect(() => {
    if (codeHostStatus?.pullRequest?.state !== "open") return;
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [codeHostStatus?.pullRequest?.state, refresh]);

  const entries = [...(history?.entries ?? [])].reverse();
  const latest = entries[0];
  const activeConflict =
    liveState?.status === "conflict"
      ? liveState.preflight?.conflicts
      : latest?.status === "conflict"
        ? latest.conflicts
        : undefined;
  const targetBranch =
    liveState?.result?.targetBranch ??
    liveState?.preflight?.targetBranch ??
    history?.targetBranch ??
    codeHostStatus?.baseBranch;
  const taskBranch =
    codeHostStatus?.taskBranch ??
    liveState?.result?.taskBranch ??
    liveState?.preflight?.taskBranch ??
    entries.find((entry) => entry.taskBranch)?.taskBranch;
  const latestHasNoChanges = deliveryHistoryEntryHasNoChanges(latest);
  const canRetry =
    Boolean(revision && (adapter.applyDelivery || onRetryAutomaticDelivery)) &&
    (liveState?.status === "failed" ||
      liveState?.status === "conflict" ||
      (latest?.status === "failed" && !latestHasNoChanges) ||
      latest?.status === "conflict");
  const visibleSyncStatus = liveState?.status ?? latest?.status;
  const deliveryHasNoChanges =
    (liveState?.status === "synced" && liveState.result?.files === 0) ||
    (!liveState && latestHasNoChanges);
  const currentRevisionIsSynced = Boolean(
    revision &&
    (history?.currentRevision === revision ||
      (liveState?.revision === revision && liveState.status === "synced")),
  );
  const canStartManualSync = Boolean(
    revision &&
    adapter.preflightDelivery &&
    adapter.applyDelivery &&
    !currentRevisionIsSynced &&
    !canRetry &&
    liveState?.status !== "syncing" &&
    liveState?.status !== "undoing",
  );
  const syncTone = deliveryHasNoChanges
    ? ("success" as const)
    : visibleSyncStatus === "conflict" || visibleSyncStatus === "failed"
      ? ("danger" as const)
      : visibleSyncStatus === "synced"
        ? ("success" as const)
        : undefined;

  async function retryDelivery() {
    if (
      !threadId ||
      !revision ||
      (!adapter.applyDelivery && !onRetryAutomaticDelivery) ||
      busyAction
    )
      return;
    setBusyAction("retry");
    setError(undefined);
    try {
      if (
        (liveState?.status === "failed" || liveState?.status === "conflict") &&
        onRetryAutomaticDelivery
      ) {
        await onRetryAutomaticDelivery();
      } else {
        await adapter.applyDelivery?.(projectId, threadId, revision);
      }
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
      await refresh();
    } finally {
      setBusyAction(undefined);
    }
  }

  async function beginManualSync() {
    if (!threadId || !revision || !adapter.preflightDelivery || busyAction) {
      return;
    }
    setBusyAction("sync");
    setError(undefined);
    try {
      setPendingManualSync(
        await adapter.preflightDelivery(projectId, threadId, revision),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function confirmManualSync() {
    if (
      !pendingManualSync ||
      !threadId ||
      !revision ||
      !adapter.applyDelivery ||
      busyAction
    ) {
      return;
    }
    setBusyAction("sync");
    setError(undefined);
    try {
      await adapter.applyDelivery(projectId, threadId, revision);
      setPendingManualSync(undefined);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function undoDeliveryPoint() {
    const undoPoint = history?.undoPoint;
    if (!threadId || !undoPoint || !adapter.undoDelivery || busyAction) return;
    setBusyAction("undo");
    setError(undefined);
    try {
      if (liveState?.status === "synced" && onUndoAutomaticDelivery) {
        await onUndoAutomaticDelivery();
      } else {
        await adapter.undoDelivery(projectId, threadId, undoPoint.revision);
      }
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(undefined);
    }
  }

  function openPullRequestDialog(draft: boolean) {
    const fallback = {
      title: defaultCommitMessage?.trim() || t("defaultPullRequestTitle"),
      body: t("defaultPullRequestBody"),
    };
    const value: Extract<PendingGitHubAction, { action: "pr" }> = {
      action: "pr",
      draft,
      ...fallback,
      generation: generatePullRequestDescription ? "loading" : "ready",
    };
    setPendingCodeHostAction(value);
    if (generatePullRequestDescription) {
      void requestPullRequestDescription(value, fallback);
    }
  }

  async function requestPullRequestDescription(
    value: Extract<PendingGitHubAction, { action: "pr" }>,
    fallback = { title: value.title, body: value.body },
  ) {
    if (!generatePullRequestDescription) return;
    const request = ++pullRequestDescriptionRequest.current;
    setPendingCodeHostAction({
      ...value,
      generation: "loading",
      generationError: undefined,
    });
    try {
      const generated = await generatePullRequestDescription();
      if (pullRequestDescriptionRequest.current !== request) return;
      setPendingCodeHostAction((current) =>
        current?.action === "pr"
          ? {
              ...current,
              title: generated.title,
              body: generated.body,
              generation: "ready",
              generationError: undefined,
            }
          : current,
      );
    } catch (reason) {
      if (pullRequestDescriptionRequest.current !== request) return;
      setPendingCodeHostAction((current) =>
        current?.action === "pr"
          ? {
              ...current,
              ...fallback,
              generation: "error",
              generationError: errorMessage(reason),
            }
          : current,
      );
    }
  }

  async function confirmCodeHostAction() {
    if (!pendingCodeHostAction || !threadId || !revision) return;
    setLoading(true);
    setError(undefined);
    try {
      if (pendingCodeHostAction.action === "push") {
        if (!adapter.commitAndPush) {
          throw new Error(t("githubDeliveryUnavailable"));
        }
        const result = await adapter.commitAndPush(
          projectId,
          threadId,
          revision,
          pendingCodeHostAction.message,
        );
        setCodeHostStatus(result.status);
      } else {
        if (!adapter.createPullRequest) {
          throw new Error(t("githubDeliveryUnavailable"));
        }
        setCodeHostStatus(
          await adapter.createPullRequest(
            projectId,
            threadId,
            revision,
            pendingCodeHostAction.title,
            pendingCodeHostAction.body,
            pendingCodeHostAction.draft,
          ),
        );
      }
      setPendingCodeHostAction(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

  if (!threadId) {
    return (
      <PanelState icon={<PackageCheck size={22} />}>
        {t("deliveryCenterNeedsTask")}
      </PanelState>
    );
  }

  return (
    <div className="delivery-center-view">
      <header className="delivery-center-header">
        <div className="delivery-center-title">
          <span aria-hidden="true">
            <PackageCheck size={17} />
          </span>
          <div>
            <strong>{t("deliveryCenter")}</strong>
            <small>{t("deliveryCenterDescription")}</small>
          </div>
        </div>
        <button
          type="button"
          className="panel-icon-button pressable"
          aria-label={t("refreshDeliveryCenter")}
          title={t("refreshDeliveryCenter")}
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? "spin" : undefined} size={15} />
        </button>
      </header>

      <div className="delivery-center-scroll">
        {error && (
          <div className="delivery-center-error" role="status">
            <TriangleAlert size={14} />
            <span>{error}</span>
          </div>
        )}

        <section
          className="delivery-overview"
          aria-label={t("deliveryOverview")}
        >
          <div className="delivery-overview-item">
            <span aria-hidden="true">
              <GitMerge size={15} />
            </span>
            <div>
              <small>{t("targetBranch")}</small>
              <strong>{targetBranch ?? t("notRecorded")}</strong>
              {taskBranch && (
                <em>{t("fromTaskBranch", { branch: taskBranch })}</em>
              )}
            </div>
          </div>
          <div className={`delivery-overview-item ${syncTone ?? ""}`}>
            <span aria-hidden="true">
              {loading || liveState?.status === "syncing" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <PackageCheck size={15} />
              )}
            </span>
            <div>
              <small>{t("syncStatus")}</small>
              <strong>
                {deliveryHasNoChanges
                  ? t("deliveryStatusNoChanges")
                  : deliveryHistoryStatusLabel(visibleSyncStatus, t)}
              </strong>
              <em>
                {deliveryHasNoChanges
                  ? t("historyNoChanges")
                  : history?.currentRevision
                    ? t("revisionShort", {
                        revision: history.currentRevision.slice(0, 8),
                      })
                    : t("noSyncHistory")}
              </em>
            </div>
          </div>
        </section>

        {canStartManualSync && (
          <section className="delivery-sync-card">
            <span aria-hidden="true">
              <GitMerge size={15} />
            </span>
            <div>
              <strong>{t("automaticDelivery")}</strong>
              <small>{t("automaticDeliveryReady")}</small>
            </div>
            <button
              type="button"
              className="github-delivery-button primary pressable"
              disabled={disabled || loading || Boolean(busyAction)}
              onClick={() => void beginManualSync()}
            >
              {busyAction === "sync" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <GitMerge size={14} />
              )}
              {t("applyToOriginal")}
            </button>
          </section>
        )}

        {(canRetry || history?.undoPoint) && (
          <section className="delivery-recovery-card">
            <div>
              <strong>{t("recoveryActions")}</strong>
              <small>
                {history?.undoPoint
                  ? t("undoPointDescription", {
                      count: history.undoPoint.files.length,
                    })
                  : t("retryDeliveryDescription")}
              </small>
            </div>
            <div className="delivery-recovery-buttons">
              {canRetry && (
                <button
                  type="button"
                  className="github-delivery-button pressable"
                  disabled={disabled || Boolean(busyAction)}
                  onClick={() => void retryDelivery()}
                >
                  {busyAction === "retry" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {t("retry")}
                </button>
              )}
              {history?.undoPoint && adapter.undoDelivery && (
                <button
                  type="button"
                  className="github-delivery-button danger pressable"
                  disabled={disabled || Boolean(busyAction)}
                  onClick={() => void undoDeliveryPoint()}
                >
                  {busyAction === "undo" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  {t("undoAutomaticDelivery")}
                </button>
              )}
            </div>
            {history?.undoPoint && (
              <ul className="delivery-undo-files">
                {history.undoPoint.files.slice(0, 5).map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
                {history.undoPoint.files.length > 5 && (
                  <li>
                    {t("moreFiles", {
                      count: history.undoPoint.files.length - 5,
                    })}
                  </li>
                )}
              </ul>
            )}
          </section>
        )}

        {activeConflict?.length ? (
          <section className="delivery-conflict-card">
            <div className="delivery-section-heading">
              <span>
                <TriangleAlert size={15} />
              </span>
              <div>
                <strong>{t("conflictFiles")}</strong>
                <small>{t("conflictFilesDescription")}</small>
              </div>
            </div>
            <ul>
              {activeConflict.map((conflict) => (
                <li key={`${conflict.path}:${conflict.reason}`}>
                  <code>{conflict.path}</code>
                  <span>{t(deliveryConflictKey(conflict.reason))}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {adapter.getCodeHostStatus && revision && (
          <GitHubDeliveryCard
            status={codeHostStatus}
            loading={loading}
            error={undefined}
            disabled={disabled}
            onRefresh={() => void refresh()}
            onCommitPush={
              adapter.commitAndPush
                ? () =>
                    setPendingCodeHostAction({
                      action: "push",
                      message:
                        defaultCommitMessage?.trim() ||
                        t("defaultCommitMessage"),
                    })
                : undefined
            }
            onCreatePr={
              adapter.createPullRequest
                ? () => openPullRequestDialog(false)
                : undefined
            }
            onCreateDraftPr={
              adapter.createPullRequest
                ? () => openPullRequestDialog(true)
                : undefined
            }
          />
        )}

        <details className="delivery-history-card">
          <summary className="delivery-section-heading">
            <span>
              <GitCommitHorizontal size={15} />
            </span>
            <div>
              <strong>{t("syncHistory")}</strong>
              <small>{t("syncHistoryDescription")}</small>
            </div>
            <b>{entries.length}</b>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          {entries.length === 0 ? (
            <p className="delivery-history-empty">{t("noSyncHistory")}</p>
          ) : (
            <ol className="delivery-history-list">
              {entries.map((entry) => {
                const noChanges = deliveryHistoryEntryHasNoChanges(entry);
                return (
                  <li
                    key={entry.id}
                    className={noChanges ? "no-changes" : entry.status}
                  >
                    <span
                      className="delivery-history-marker"
                      aria-hidden="true"
                    >
                      {!noChanges &&
                      (entry.status === "conflict" ||
                        entry.status === "failed") ? (
                        <TriangleAlert size={13} />
                      ) : entry.status === "undone" ? (
                        <RotateCcw size={13} />
                      ) : (
                        <GitMerge size={13} />
                      )}
                    </span>
                    <div className="delivery-history-copy">
                      <div>
                        <strong>
                          {noChanges
                            ? t("deliveryStatusNoChanges")
                            : deliveryHistoryStatusLabel(entry.status, t)}
                        </strong>
                        <time dateTime={entry.createdAt}>
                          {formatDeliveryTime(entry.createdAt)}
                        </time>
                      </div>
                      <small>
                        {entry.status === "undone"
                          ? t("historyUndoSummary", {
                              count: entry.revertedFiles ?? 0,
                            })
                          : entry.status === "synced" || noChanges
                            ? noChanges
                              ? t("historyNoChanges")
                              : t("historySyncSummary", {
                                  branch:
                                    entry.targetBranch ?? t("notRecorded"),
                                  count: entry.appliedFiles ?? 0,
                                })
                            : (entry.error ?? t("deliveryBlocked"))}
                      </small>
                      {(entry.commit || entry.revision) && (
                        <code>
                          {entry.commit?.slice(0, 10) ??
                            entry.revision.slice(0, 10)}
                        </code>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </details>
      </div>

      {pendingCodeHostAction && (
        <GitHubDeliveryDialog
          action={pendingCodeHostAction.action}
          value={pendingCodeHostAction}
          busy={loading}
          onRegenerate={
            pendingCodeHostAction.action === "pr" &&
            generatePullRequestDescription
              ? () => void requestPullRequestDescription(pendingCodeHostAction)
              : undefined
          }
          error={error}
          onChange={setPendingCodeHostAction}
          onCancel={() => {
            if (!loading) {
              pullRequestDescriptionRequest.current += 1;
              setPendingCodeHostAction(undefined);
            }
          }}
          onConfirm={() => void confirmCodeHostAction()}
        />
      )}
      {pendingManualSync && (
        <WorktreeDeliveryDialog
          action="apply"
          preflight={pendingManualSync}
          message=""
          busy={busyAction === "sync"}
          error={error}
          onMessageChange={() => undefined}
          onCancel={() => {
            if (busyAction) return;
            setPendingManualSync(undefined);
            setError(undefined);
          }}
          onConfirm={() => void confirmManualSync()}
        />
      )}
    </div>
  );
}

function deliveryHistoryStatusLabel(
  status:
    | AutomaticDeliveryState["status"]
    | WorktreeDeliveryHistoryEntry["status"]
    | undefined,
  t: Translate,
): string {
  if (status === "syncing") return t("deliveryStatusSyncing");
  if (status === "conflict") return t("deliveryStatusConflict");
  if (status === "failed") return t("deliveryStatusFailed");
  if (status === "undone" || status === "undoing")
    return t("deliveryStatusUndone");
  if (status === "synced") return t("deliveryStatusSynced");
  return t("deliveryStatusWaiting");
}

function deliveryHistoryEntryHasNoChanges(
  entry: WorktreeDeliveryHistoryEntry | undefined,
): boolean {
  return Boolean(
    entry &&
    ((entry.status === "synced" && entry.files === 0) ||
      (entry.status === "failed" &&
        entry.error === "This task has no changes to deliver")),
  );
}

function formatDeliveryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export {
  GitHubDeliveryCard,
  GitHubDeliveryDialog,
  WorktreeDeliveryDialog,
} from "./code-host-card.js";
export type { PendingGitHubAction } from "./code-host-card.js";
import {
  GitHubDeliveryCard,
  GitHubDeliveryDialog,
  WorktreeDeliveryDialog,
  deliveryConflictKey,
  errorMessage,
  type PendingGitHubAction,
} from "./code-host-card.js";
