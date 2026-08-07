import {
  Check,
  ChevronRight,
  GitMerge,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";

import { useI18n, type Translate } from "../../i18n.js";
import type {
  AutomaticDeliveryState,
  WorktreeDeliveryHistorySnapshot,
} from "../../workspace-panel.js";

export function shouldShowDeliveryTurnStatus(
  workspaceMode: string | undefined,
  isRunning: boolean,
): boolean {
  return workspaceMode === "worktree" && !isRunning;
}

export function DeliveryTurnStatus({
  delivery,
  disabled = false,
  onOpen,
  onRetry,
  onUndo,
}: {
  delivery?: AutomaticDeliveryState;
  disabled?: boolean;
  onOpen(): void;
  onRetry?(): void;
  onUndo?(): void;
}) {
  const { t } = useI18n();
  const attention =
    delivery?.status === "conflict" || delivery?.status === "failed";
  const conflicts = delivery?.preflight?.conflicts ?? [];
  const label = delivery
    ? deliveryTurnLabel(delivery, t)
    : t("deliveryStatusWaiting");
  const detail = delivery
    ? deliveryTurnDetail(delivery, t)
    : t("automaticDeliveryReady");
  const status = delivery?.status ?? "ready";

  return (
    <section
      className={`turn-delivery-status ${status} ${attention ? "attention" : ""}`}
      role={attention ? "alert" : "status"}
      aria-live="polite"
      aria-label={`${t("automaticDelivery")}: ${label}`}
    >
      <span className="turn-delivery-icon" aria-hidden="true">
        {delivery?.status === "syncing" || delivery?.status === "undoing" ? (
          <LoaderCircle className="spin" size={16} />
        ) : attention ? (
          <TriangleAlert size={16} />
        ) : delivery?.status === "undone" ? (
          <RotateCcw size={16} />
        ) : delivery?.result?.files === 0 ? (
          <Check size={16} />
        ) : (
          <GitMerge size={16} />
        )}
      </span>

      <div className="turn-delivery-copy">
        <span>{t("automaticDelivery")}</span>
        <strong>{label}</strong>
        <small title={detail}>{detail}</small>
        {attention && conflicts.length > 0 && (
          <div className="turn-delivery-conflicts">
            {conflicts.slice(0, 2).map((conflict) => (
              <code key={conflict.path} title={conflict.path}>
                {conflict.path}
              </code>
            ))}
            {conflicts.length > 2 && (
              <span>{t("moreFiles", { count: conflicts.length - 2 })}</span>
            )}
          </div>
        )}
      </div>

      <div className="turn-delivery-actions">
        {attention && onRetry && (
          <button
            type="button"
            className="turn-delivery-action pressable"
            disabled={disabled}
            onClick={onRetry}
          >
            <RefreshCw size={13} />
            {t("retry")}
          </button>
        )}
        {delivery?.status === "synced" &&
          delivery.result?.undoAvailable &&
          onUndo && (
            <button
              type="button"
              className="turn-delivery-action pressable"
              disabled={disabled}
              onClick={onUndo}
            >
              <RotateCcw size={13} />
              {t("undoAutomaticDelivery")}
            </button>
          )}
        <button
          type="button"
          className="turn-delivery-action details pressable"
          onClick={onOpen}
        >
          {t("openDeliveryCenter")}
          <ChevronRight size={13} />
        </button>
      </div>
    </section>
  );
}

export function deliveryTurnLabel(
  delivery: AutomaticDeliveryState,
  t: Translate,
): string {
  if (delivery.status === "syncing") return t("deliveryStatusSyncing");
  if (delivery.status === "undoing") return t("deliveryStatusSyncing");
  if (delivery.status === "undone") return t("deliveryStatusUndone");
  if (delivery.status === "conflict") return t("deliveryStatusConflict");
  if (delivery.status === "failed") return t("deliveryStatusFailed");
  return delivery.result?.files === 0
    ? t("deliveryStatusNoChanges")
    : t("deliveryStatusSynced");
}

export function deliveryTurnDetail(
  delivery: AutomaticDeliveryState,
  t: Translate,
): string {
  if (delivery.status === "syncing") return t("automaticDeliverySyncing");
  if (delivery.status === "undoing") return t("automaticDeliveryUndoing");
  if (delivery.status === "undone") return t("automaticDeliveryUndone");
  if (delivery.status === "conflict") {
    return t("deliveryConflicts", {
      count: delivery.preflight?.conflicts.length ?? 0,
    });
  }
  if (delivery.status === "failed") {
    return delivery.error || t("deliveryStatusFailed");
  }
  if (!delivery.result || delivery.result.files === 0) {
    return t("automaticDeliveryNoChanges");
  }
  return t("automaticDeliverySynced", {
    branch: delivery.result.targetBranch,
    count: delivery.result.appliedFiles,
  });
}

export function automaticDeliveryFromHistory(
  scope: string,
  history: WorktreeDeliveryHistorySnapshot,
): AutomaticDeliveryState | undefined {
  const latest = history.entries.at(-1);
  if (!latest) return;
  const targetBranch = latest.targetBranch ?? history.targetBranch ?? "";
  const taskBranch = latest.taskBranch ?? "";
  const files = latest.files ?? latest.appliedFiles ?? 0;
  const common = {
    scope,
    revision: latest.revision,
  };

  if (latest.status === "undone") {
    return { ...common, status: "undone" };
  }
  if (latest.status === "synced") {
    return {
      ...common,
      status: "synced",
      result: {
        taskBranch,
        targetBranch,
        branchChanged: false,
        files,
        pendingFiles: 0,
        alreadyAppliedFiles: files,
        conflicts: [],
        appliedFiles: latest.appliedFiles ?? files,
        undoAvailable: latest.undoAvailable,
        ...(latest.commit ? { commit: latest.commit } : {}),
      },
    };
  }

  const preflight = latest.conflicts?.length
    ? {
        taskBranch,
        targetBranch,
        branchChanged: false,
        files,
        pendingFiles: files,
        alreadyAppliedFiles: 0,
        conflicts: latest.conflicts,
      }
    : undefined;
  return {
    ...common,
    status: latest.status,
    ...(preflight ? { preflight } : {}),
    ...(latest.error ? { error: latest.error } : {}),
  };
}
