import { useEffect, useRef, useState } from "react";
import type { AgentPlanData } from "@threadlight/protocol";
import {
  Check,
  Copy,
  FileDiff,
  LoaderCircle,
  PencilLine,
  PictureInPicture2,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n.js";
import type { ConversationProgress } from "./session.js";
import type {
  ComputerPermissionCapability,
  ComputerPermissionSnapshot,
  ComputerShareSnapshot,
} from "./computer-types.js";
import type {
  ConversationChangesSnapshot,
  WorkspaceFileOpenRequest,
} from "../../workspace-panel.js";

export const WORKSPACE_CHANGE_REFRESH_TOOL_NAMES = [
  "exec_command",
  "process_status",
  "process_read",
  "process_wait",
  "process_kill",
  "apply_patch",
  "write_file",
  "edit_file",
] as const;

const workspaceChangeRefreshTools = new Set<string>(
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
);

export function MessageActions({
  role,
  text,
  copyText,
  onRewrite,
}: {
  role: "user" | "assistant";
  text: string;
  copyText?(text: string): Promise<void>;
  onRewrite?(): void;
}) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(
    () => () => {
      if (copyStatusTimer.current) clearTimeout(copyStatusTimer.current);
    },
    [],
  );

  async function copyMessage() {
    try {
      await writeClipboardText(text, copyText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    if (copyStatusTimer.current) clearTimeout(copyStatusTimer.current);
    copyStatusTimer.current = setTimeout(() => setCopyStatus("idle"), 1600);
  }

  const copyLabel =
    copyStatus === "copied"
      ? t("copied")
      : copyStatus === "failed"
        ? t("copyFailed")
        : t("copyMessage");

  return (
    <div
      className={`message-actions ${role}`}
      aria-label={t("messageActions")}
      aria-live="polite"
    >
      <button
        type="button"
        className={`message-action pressable ${copyStatus}`}
        onClick={() => void copyMessage()}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copyStatus === "copied" ? (
          <Check size={14} />
        ) : copyStatus === "failed" ? (
          <X size={14} />
        ) : (
          <Copy size={14} />
        )}
      </button>
      {role === "user" && onRewrite && (
        <button
          type="button"
          className="message-action pressable"
          onClick={onRewrite}
          aria-label={t("rewriteQuestion")}
          title={t("rewriteQuestion")}
        >
          <PencilLine size={14} />
        </button>
      )}
    </div>
  );
}

export async function writeClipboardText(
  text: string,
  desktopWriteText?: (text: string) => Promise<void>,
): Promise<void> {
  if (desktopWriteText) {
    try {
      await desktopWriteText(text);
      return;
    } catch {
      // Continue through the browser fallbacks.
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard API can exist but reject writes in Electron or non-secure contexts.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard write is unavailable");
  }
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.top = "0";
  document.body.append(fallback);
  fallback.focus();
  fallback.select();
  fallback.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  fallback.remove();
  previousFocus?.focus({ preventScroll: true });
  if (!copied) throw new Error("Clipboard write failed");
}

export function ConversationChangesButton({
  changes,
  onOpen,
}: {
  changes: ConversationChangesSnapshot;
  onOpen(): void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="conversation-changes-button pressable"
      onClick={onOpen}
    >
      <FileDiff size={14} />
      <span>{t("filesChanged", { count: changes.files.length })}</span>
      <span className="change-additions">+{changes.additions}</span>
      <span className="change-deletions">-{changes.deletions}</span>
    </button>
  );
}

export function TurnStatusPill({
  plan,
  changes,
  onOpenChanges,
}: {
  plan?: AgentPlanData;
  changes?: ConversationChangesSnapshot;
  onOpenChanges(): void;
}) {
  const { t } = useI18n();
  const step = plan ? currentPlanStep(plan) : undefined;
  const completed =
    !!plan?.items.length &&
    plan.items.every((item) => item.status === "completed");

  return (
    <div className="turn-status-float">
      <div className="turn-status-pill">
        {plan && (
          <div className="plan-status">
            <button
              type="button"
              className="plan-status-trigger"
              aria-label={
                plan.items.length
                  ? t("planStep", {
                      current: step ?? 1,
                      total: plan.items.length,
                    })
                  : t("planning")
              }
            >
              {completed ? (
                <span className="plan-status-icon completed">
                  <Check size={11} strokeWidth={2.5} />
                </span>
              ) : (
                <LoaderCircle
                  className="plan-status-icon spin"
                  size={15}
                  strokeWidth={2.2}
                />
              )}
              <strong>
                {plan.items.length
                  ? t("planStep", {
                      current: step ?? 1,
                      total: plan.items.length,
                    })
                  : t("planning")}
              </strong>
            </button>
            {plan.items.length > 0 && (
              <div
                className="plan-status-popover"
                role="list"
                aria-label={t("plan")}
              >
                {plan.items.map((item, index) => (
                  <div
                    className={`plan-status-item ${item.status}`}
                    role="listitem"
                    data-current={index + 1 === step || undefined}
                    key={`${index}:${item.step}`}
                  >
                    {item.status === "completed" ? (
                      <span className="plan-item-icon completed">
                        <Check size={11} strokeWidth={2.5} />
                      </span>
                    ) : (
                      <LoaderCircle
                        className={`plan-item-icon ${item.status === "in_progress" ? "spin" : ""}`}
                        size={15}
                        strokeWidth={2}
                      />
                    )}
                    <span title={item.step}>{item.step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {plan && changes && <span className="turn-status-separator">·</span>}
        {changes && (
          <ConversationChangesButton changes={changes} onOpen={onOpenChanges} />
        )}
      </div>
    </div>
  );
}

export function currentPlanStep(plan: AgentPlanData): number | undefined {
  if (plan.items.length === 0) return;
  const active = plan.items.findIndex((item) => item.status === "in_progress");
  if (active >= 0) return active + 1;
  const pending = plan.items.findIndex((item) => item.status === "pending");
  return pending >= 0 ? pending + 1 : plan.items.length;
}

export function planDocumentOpenRequest(
  plan: AgentPlanData | undefined,
  threadId: string | undefined,
  activeDocumentKey: string | undefined,
  requestId: number,
):
  | {
      documentKey: string;
      openPanel: boolean;
      request: WorkspaceFileOpenRequest;
    }
  | undefined {
  if (!threadId || !plan?.documentPath || !plan.documentVersion) {
    return;
  }
  const documentKey = `${threadId}\u0000${plan.documentPath}`;
  const openPanel = activeDocumentKey !== documentKey;
  return {
    documentKey,
    openPanel,
    request: {
      id: requestId,
      path: plan.documentPath,
      activate: openPanel,
    },
  };
}

export function conversationChangesRefreshKey(
  progress: readonly ConversationProgress[],
): string {
  return progress
    .flatMap((step) => step.activities)
    .filter(
      (activity) =>
        workspaceChangeRefreshTools.has(activity.name) &&
        (activity.status !== "running" || activity.process !== undefined),
    )
    .map(
      (activity) =>
        `${activity.id}:${activity.status}:${activity.process?.sessionId ?? ""}`,
    )
    .join("\u0000");
}

export function clampWorkspacePanelWidth(
  requestedWidth: number,
  workspaceWidth: number,
): number {
  const minimumWidth = Math.min(420, workspaceWidth / 2);
  const maximumWidth = Math.max(minimumWidth, workspaceWidth - 360);
  return Math.round(
    Math.min(maximumWidth, Math.max(minimumWidth, requestedWidth)),
  );
}

export function ComputerPermissionCard({
  snapshot,
  busy,
  error,
  onRequest,
  onRefresh,
  onRelaunch,
}: {
  snapshot: ComputerPermissionSnapshot;
  busy?: ComputerPermissionCapability | "refresh" | "relaunch";
  error?: string;
  onRequest(capability: ComputerPermissionCapability): void;
  onRefresh(): void;
  onRelaunch(): void;
}) {
  const { t } = useI18n();
  const screenReady = snapshot.screenRecording === "granted";
  const accessibilityReady = snapshot.accessibility === "granted";
  const ready = screenReady && accessibilityReady;

  return (
    <section className="computer-permission-card" aria-live="polite">
      <div className="computer-permission-heading">
        <span className="computer-permission-icon" aria-hidden="true">
          <ShieldAlert size={16} />
        </span>
        <span>
          <strong>
            {ready
              ? t("computerPermissionReady")
              : t("computerPermissionTitle")}
          </strong>
          <small>
            {ready
              ? t("computerPermissionRestartHint")
              : t("computerPermissionDescription")}
          </small>
        </span>
      </div>
      <div className="computer-permission-list">
        <ComputerPermissionRow
          label={t("screenRecordingPermission")}
          ready={screenReady}
          busy={busy === "screen_recording"}
          disabled={!!busy}
          onRequest={() => onRequest("screen_recording")}
        />
        <ComputerPermissionRow
          label={t("accessibilityPermission")}
          ready={accessibilityReady}
          busy={busy === "accessibility"}
          disabled={!!busy}
          onRequest={() => onRequest("accessibility")}
        />
      </div>
      {error && <p className="computer-permission-error">{error}</p>}
      <div className="computer-permission-actions">
        {ready ? (
          <button
            type="button"
            className="computer-permission-primary pressable"
            disabled={!!busy}
            onClick={onRelaunch}
          >
            {busy === "relaunch" && <LoaderCircle className="spin" size={13} />}
            {t("restartThreadlight")}
          </button>
        ) : (
          <button
            type="button"
            className="computer-permission-refresh pressable"
            disabled={!!busy}
            onClick={onRefresh}
          >
            {busy === "refresh" ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
            {t("recheckPermissions")}
          </button>
        )}
      </div>
    </section>
  );
}

export function pendingComputerPermissionResume(
  value: string | null,
  now: number,
): { threadId: string; expiresAt: number } | undefined {
  if (!value) return;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const resume = parsed as Record<string, unknown>;
    if (
      typeof resume.threadId !== "string" ||
      !resume.threadId ||
      typeof resume.expiresAt !== "number" ||
      !Number.isFinite(resume.expiresAt) ||
      resume.expiresAt <= now
    ) {
      return;
    }
    return {
      threadId: resume.threadId,
      expiresAt: resume.expiresAt,
    };
  } catch {
    return;
  }
}

function ComputerPermissionRow({
  label,
  ready,
  busy,
  disabled,
  onRequest,
}: {
  label: string;
  ready: boolean;
  busy: boolean;
  disabled: boolean;
  onRequest(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="computer-permission-row">
      <span className={ready ? "permission-dot granted" : "permission-dot"} />
      <strong>{label}</strong>
      <span className={ready ? "permission-state granted" : "permission-state"}>
        {ready ? t("permissionGranted") : t("permissionRequired")}
      </span>
      {!ready && (
        <button
          type="button"
          className="computer-permission-grant pressable"
          disabled={disabled}
          onClick={onRequest}
        >
          {busy && <LoaderCircle className="spin" size={12} />}
          {t("grantPermission")}
        </button>
      )}
    </div>
  );
}

export function ComputerShareStatus({
  snapshot,
  busy,
  stopping,
  error,
  onShow,
  onStop,
}: {
  snapshot: ComputerShareSnapshot;
  busy: boolean;
  stopping: boolean;
  error?: string;
  onShow(): void;
  onStop(): void;
}) {
  const { t } = useI18n();
  const applications = [
    ...new Set(
      snapshot.targets.map((target) => target.applicationName ?? target.name),
    ),
  ];
  const targetLabel =
    applications.length > 0
      ? applications.join("、")
      : t("windowsCount", { count: snapshot.targets.length });

  return (
    <div className="composer-share" aria-live="polite">
      <span className="composer-share-icon" aria-hidden="true">
        <PictureInPicture2 size={14} />
        <span />
      </span>
      <span className="composer-share-copy">
        <strong>
          {t("sharing")}
          {snapshot.targets.length > 1
            ? ` ${t("windowsCount", { count: snapshot.targets.length })}`
            : ""}
        </strong>
        <small title={targetLabel}>{error ?? targetLabel}</small>
      </span>
      <button
        type="button"
        className="composer-share-action pressable"
        disabled={busy}
        onClick={onShow}
      >
        {busy && !stopping && <LoaderCircle className="spin" size={12} />}
        {snapshot.pictureInPicture ? t("showPictureInPicture") : t("reopen")}
      </button>
      <button
        type="button"
        className="composer-share-stop pressable"
        disabled={busy}
        onClick={onStop}
        aria-label={t("stopSharing")}
        title={t("stopSharing")}
      >
        {stopping ? (
          <LoaderCircle className="spin" size={12} />
        ) : (
          <X size={13} />
        )}
      </button>
    </div>
  );
}
