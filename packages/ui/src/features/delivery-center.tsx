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

import { useI18n, type Translate } from "../i18n.js";
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
  const [busyAction, setBusyAction] = useState<
    "sync" | "retry" | "undo"
  >();
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
    if (
      !threadId ||
      !revision ||
      !adapter.preflightDelivery ||
      busyAction
    ) {
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

export function GitHubDeliveryCard({
  status,
  loading,
  error,
  disabled,
  onRefresh,
  onCommitPush,
  onCreatePr,
  onCreateDraftPr,
}: {
  status?: CodeHostDeliveryStatus;
  loading: boolean;
  error?: string;
  disabled: boolean;
  onRefresh(): void;
  onCommitPush?(): void;
  onCreatePr?(): void;
  onCreateDraftPr?(): void;
}) {
  const { t } = useI18n();
  const pullRequest = status?.pullRequest;
  const comments = pullRequest?.comments.slice(0, 8) ?? [];
  const setupIssue = codeHostSetupIssue(status);
  const setupCommand = codeHostSetupCommand(setupIssue, status);
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
              (loading
                ? t("loadingGitHubStatus")
                : status && !status.available
                  ? t(codeHostSetupTitleKey(setupIssue))
                  : t("githubDeliveryUnavailable"))}
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
          <span className={`github-push-state ${status.pushed ? "ready" : ""}`}>
            {status.pushed ? t("branchPushed") : t("branchLocalOnly")}
          </span>
        </div>
      )}

      {(error || (status && !status.available)) && (
        <div
          className={`github-delivery-error ${error ? "" : "setup"}`}
          role={error ? "alert" : "note"}
        >
          {error ? <TriangleAlert size={13} /> : <Info size={13} />}
          <div>
            <p>{error ?? t(codeHostSetupHelpKey(setupIssue))}</p>
            {!error && setupCommand && <code>{setupCommand}</code>}
            {!error && setupIssue === "cli_missing" && (
              <a
                href="https://github.com/cli/cli#installation"
                target="_blank"
                rel="noreferrer"
              >
                {t("githubCliInstallGuide")}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
            )}
            {!error && status?.reason && (
              <small>
                {t("githubStatusDetails", { reason: status.reason })}
              </small>
            )}
          </div>
        </div>
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
              className="github-delivery-button pressable"
              disabled={disabled || loading || !status.pushed}
              title={!status.pushed ? t("pushBeforeDraftPr") : undefined}
              onClick={onCreateDraftPr}
            >
              <GitPullRequestDraft size={14} />
              {t("createDraftPr")}
            </button>
          )}
          {onCreatePr && (
            <button
              type="button"
              className="github-delivery-button primary pressable"
              disabled={disabled || loading || !status.pushed}
              title={!status.pushed ? t("pushBeforePullRequest") : undefined}
              onClick={onCreatePr}
            >
              <GitPullRequest size={14} />
              {t("createPullRequest")}
            </button>
          )}
        </div>
      )}

      {pullRequest && (
        <div className="github-pr">
          <div className="github-pr-summary">
            {pullRequest.draft ? (
              <GitPullRequestDraft size={15} aria-hidden="true" />
            ) : (
              <GitPullRequest size={15} aria-hidden="true" />
            )}
            <a href={pullRequest.url} target="_blank" rel="noreferrer">
              #{pullRequest.number} {pullRequest.title}
            </a>
            <span className="github-pr-draft">
              {pullRequest.draft ? t("draft") : pullRequest.state}
            </span>
            <a
              className="github-pr-open pressable"
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={12} aria-hidden="true" />
              {t("openPullRequest")}
            </a>
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

function codeHostSetupIssue(
  status?: CodeHostDeliveryStatus,
): CodeHostDeliverySetupIssue {
  if (status?.setupIssue) return status.setupIssue;
  const reason = status?.reason?.toLowerCase() ?? "";
  if (/\bgh\b.*(enoent|not found|not recognized)/.test(reason)) {
    return "cli_missing";
  }
  if (/auth login|not logged|authentication/.test(reason)) {
    return "authentication_required";
  }
  if (/no git remotes? found|no remotes?/.test(reason)) {
    return "remote_missing";
  }
  if (/choose a git remote|multiple remotes?/.test(reason)) {
    return "remote_ambiguous";
  }
  return "unknown";
}

function codeHostSetupTitleKey(
  issue: CodeHostDeliverySetupIssue,
):
  | "githubCliMissing"
  | "githubAuthRequired"
  | "githubRemoteMissing"
  | "githubRemoteAmbiguous"
  | "githubRepositoryUnavailable"
  | "githubDeliveryUnavailable" {
  if (issue === "cli_missing") return "githubCliMissing";
  if (issue === "authentication_required") return "githubAuthRequired";
  if (issue === "remote_missing") return "githubRemoteMissing";
  if (issue === "remote_ambiguous") return "githubRemoteAmbiguous";
  if (issue === "repository_unavailable") {
    return "githubRepositoryUnavailable";
  }
  return "githubDeliveryUnavailable";
}

function codeHostSetupHelpKey(
  issue: CodeHostDeliverySetupIssue,
):
  | "githubCliMissingHelp"
  | "githubAuthRequiredHelp"
  | "githubRemoteMissingHelp"
  | "githubRemoteAmbiguousHelp"
  | "githubRepositoryUnavailableHelp"
  | "githubDeliveryUnavailableHelp" {
  if (issue === "cli_missing") return "githubCliMissingHelp";
  if (issue === "authentication_required") return "githubAuthRequiredHelp";
  if (issue === "remote_missing") return "githubRemoteMissingHelp";
  if (issue === "remote_ambiguous") return "githubRemoteAmbiguousHelp";
  if (issue === "repository_unavailable") {
    return "githubRepositoryUnavailableHelp";
  }
  return "githubDeliveryUnavailableHelp";
}

function codeHostSetupCommand(
  issue: CodeHostDeliverySetupIssue,
  status?: CodeHostDeliveryStatus,
): string | undefined {
  if (issue === "cli_missing" || issue === "authentication_required") {
    return "gh auth login";
  }
  if (issue === "remote_missing") {
    return "git remote add origin <repository-url>";
  }
  if (issue === "remote_ambiguous" && status) {
    return `git config branch.${status.taskBranch}.remote <remote>`;
  }
  return undefined;
}

export type PendingGitHubAction =
  | { action: "push"; message: string }
  | {
      action: "pr";
      title: string;
      body: string;
      draft: boolean;
      generation: "loading" | "ready" | "error";
      generationError?: string;
    };

export function GitHubDeliveryDialog({
  action,
  value,
  busy,
  error,
  onRegenerate,
  onChange,
  onCancel,
  onConfirm,
}: {
  action: PendingGitHubAction["action"];
  value: PendingGitHubAction;
  busy: boolean;
  error?: string;
  onRegenerate?(): void;
  onChange(value: PendingGitHubAction): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  const firstField = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const generating = value.action === "pr" && value.generation === "loading";

  useEffect(() => {
    if (generating) return;
    firstField.current?.focus();
    firstField.current?.select();
  }, [action, generating]);

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && !generating) onConfirm();
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
        aria-busy={generating}
        aria-labelledby="github-delivery-dialog-title"
      >
        <span className="delivery-dialog-icon" aria-hidden="true">
          {action === "push" ? (
            <UploadCloud size={18} />
          ) : value.action === "pr" && value.draft ? (
            <GitPullRequestDraft size={18} />
          ) : (
            <GitPullRequest size={18} />
          )}
        </span>
        <form onSubmit={submit}>
          <div className="delivery-dialog-copy">
            <h2 id="github-delivery-dialog-title">
              {action === "push"
                ? t("commitAndPush")
                : value.action === "pr" && value.draft
                  ? t("createDraftPr")
                  : t("createPullRequest")}
            </h2>
            <p>
              {action === "push"
                ? t("commitAndPushDescription")
                : value.action === "pr" && value.draft
                  ? t("createDraftPrDescription")
                  : t("createPullRequestDescription")}
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
                <div
                  className={`github-pr-generation ${value.generation}`}
                  role="status"
                >
                  {value.generation === "loading" ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  <span>
                    <strong>
                      {value.generation === "loading"
                        ? t("generatingPullRequestDescription")
                        : value.generation === "error"
                          ? t("pullRequestGenerationFailed")
                          : t("pullRequestDescriptionGenerated")}
                    </strong>
                    <small>
                      {value.generation === "error"
                        ? value.generationError
                        : value.generation === "loading"
                          ? t("generatingPullRequestDescriptionHelp")
                          : t("pullRequestDescriptionGeneratedHelp")}
                    </small>
                  </span>
                  {value.generation !== "loading" && onRegenerate && (
                    <button
                      type="button"
                      className="github-pr-regenerate pressable"
                      disabled={busy}
                      onClick={onRegenerate}
                    >
                      <RefreshCw size={12} />
                      {t("regenerate")}
                    </button>
                  )}
                </div>
                <label className="delivery-commit-field">
                  <span>{t("pullRequestTitle")}</span>
                  <input
                    ref={firstField}
                    value={value.title}
                    maxLength={256}
                    disabled={busy || generating}
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
                    rows={9}
                    disabled={busy || generating}
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
              disabled={busy || generating || !valid}
            >
              {busy && <LoaderCircle className="spin" size={14} />}
              {busy
                ? t("publishingToGitHub")
                : action === "push"
                  ? t("commitAndPush")
                  : value.action === "pr" && value.draft
                    ? t("createDraftPr")
                    : t("createPullRequest")}
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

export function WorktreeDeliveryDialog({
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
  const blocked = preflight.branchChanged || preflight.conflicts.length > 0;
  const alreadyApplied = action === "apply" && preflight.pendingFiles === 0;

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
                  if (event.key === "Enter" && message.trim() && !busy) {
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
              disabled={busy || (action === "commit" && !message.trim())}
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
