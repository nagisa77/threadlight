import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AttachmentData } from "@threadlight/protocol";
import {
  Check,
  ChevronRight,
  CircleStop,
  FileText,
  Link2,
  LoaderCircle,
  Terminal,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";

import { useI18n, type Translate } from "../../i18n.js";
import { MarkdownContent, type LocalFileReference } from "../../markdown.js";
import type { ProjectSummary, ProjectsSnapshot } from "../../projects.js";
import type { AttachmentPreviewAdapter } from "../composer/types.js";
import type {
  PendingAttachment,
  VoiceInputStatus,
} from "../composer/controller.js";
import type { ConversationProgress, ToolActivity } from "./session.js";

export function ProgressList({
  progress,
  live = false,
  onTerminateProcess,
  onOpenLocalFile,
  onRevealLocalFile,
}: {
  progress: readonly ConversationProgress[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
  onOpenLocalFile?(reference: LocalFileReference): void;
  onRevealLocalFile?(reference: LocalFileReference): void | Promise<void>;
}) {
  return (
    <div className="progress-list">
      {progress.map((step, index) => (
        <div className="progress-step" key={index}>
          {step.text.trim() && (
            <div className="progress-copy">
              <MarkdownContent
                onOpenLocalFile={onOpenLocalFile}
                onRevealLocalFile={onRevealLocalFile}
              >
                {step.text}
              </MarkdownContent>
            </div>
          )}
          {step.activities.length > 0 && (
            <ActivityList
              activities={step.activities}
              live={live}
              onTerminateProcess={onTerminateProcess}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function ActivityList({
  activities,
  live = false,
  onTerminateProcess,
}: {
  activities: readonly ToolActivity[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const hasAttentionActivity = activities.some(
    (activity) =>
      activity.status === "failed" ||
      activity.status === "terminated" ||
      activity.status === "completed_with_warnings",
  );
  const [expanded, setExpanded] = useState(live || hasAttentionActivity);
  const hasRunningActivity = activities.some(
    (activity) => activity.status === "running",
  );

  return (
    <details
      className={live ? "activity-list live" : "activity-list"}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="activity-heading">
        <Terminal size={14} />
        <span>
          {live
            ? hasRunningActivity
              ? t("executing")
              : t("executed")
            : t("executionLog")}
        </span>
        <span className="activity-count">{activities.length}</span>
        <ChevronRight
          className="activity-chevron"
          size={13}
          aria-hidden="true"
        />
      </summary>
      <div className="activity-content">
        {activities.map((activity) => (
          <div
            id={`activity-${activity.id}`}
            className="activity-item"
            key={activity.id}
            tabIndex={-1}
          >
            <div className="activity-summary">
              <ActivityStatus status={activity.status} />
              <code>{activity.name}</code>
              {activity.name === "exec_command" &&
                activity.process?.status === "running" &&
                onTerminateProcess && (
                  <TerminateProcessButton
                    sessionId={activity.process.sessionId}
                    onTerminate={onTerminateProcess}
                  />
                )}
            </div>
            {activity.detail && <pre>{activity.detail}</pre>}
            {activity.name === "exec_command" && activity.process && (
              <CommandOutput process={activity.process} />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function ActivityStatus({ status }: Pick<ToolActivity, "status">) {
  if (status === "running") return <LoaderCircle className="spin" size={14} />;
  if (status === "failed") return <X className="failed" size={14} />;
  if (status === "completed_with_warnings") {
    return <TriangleAlert className="warning" size={14} />;
  }
  if (status === "terminated") {
    return <CircleStop className="terminated" size={14} />;
  }
  return <Check className="completed" size={14} />;
}

function CommandOutput({ process }: Pick<ToolActivity, "process">) {
  const { t } = useI18n();
  if (!process) return null;
  const output = [
    process.stdout,
    process.stderr ? `stderr\n${process.stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <details className="command-output">
      <summary>
        <ChevronRight size={12} aria-hidden="true" />
        <span>{t("commandOutput")}</span>
        {process.truncated && (
          <span className="output-note">{t("truncated")}</span>
        )}
      </summary>
      <pre>{output || t("noOutput")}</pre>
    </details>
  );
}

function TerminateProcessButton({
  sessionId,
  onTerminate,
}: {
  sessionId: string;
  onTerminate(sessionId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [terminating, setTerminating] = useState(false);
  const [error, setError] = useState(false);

  return (
    <>
      <button
        type="button"
        className="process-terminate-button pressable"
        disabled={terminating}
        title={t("terminateCommand")}
        aria-label={t("terminateCommand")}
        onClick={() => {
          setTerminating(true);
          setError(false);
          void onTerminate(sessionId).catch(() => {
            setTerminating(false);
            setError(true);
          });
        }}
      >
        {terminating ? (
          <LoaderCircle className="spin" size={12} />
        ) : (
          <CircleStop size={12} />
        )}
        {terminating ? t("terminating") : t("terminate")}
      </button>
      {error && (
        <span className="process-action-error" role="status">
          {t("terminateFailed")}
        </span>
      )}
    </>
  );
}

export function ConnectionError({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  onRetry(): void;
  onOpenSettings?(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="connection-error">
      <span className="error-icon">
        <X size={16} />
      </span>
      <div>
        <strong>{t("runtimeConnectionFailed")}</strong>
        <p>{message}</p>
        <p className="error-help">{t("runtimeConnectionHelp")}</p>
        <div className="connection-actions">
          {onOpenSettings && (
            <button className="primary pressable" onClick={onOpenSettings}>
              {t("openSettings")}
            </button>
          )}
          <button className="secondary pressable" onClick={onRetry}>
            {t("reconnect")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MissingThreadRecovery({
  threadId,
  busy,
  error,
  onRepair,
  onRelink,
  onDeleteMetadata,
}: {
  threadId: string;
  busy: boolean;
  error?: string;
  onRepair(): void;
  onRelink(threadId: string): void;
  onDeleteMetadata(): void;
}) {
  const { t } = useI18n();
  const [showRelink, setShowRelink] = useState(false);
  const [replacementId, setReplacementId] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showRelink) input.current?.focus();
  }, [showRelink]);

  return (
    <section
      className="missing-thread-recovery"
      aria-labelledby="missing-thread-title"
    >
      <span className="missing-thread-icon" aria-hidden="true">
        <TriangleAlert size={18} />
      </span>
      <div className="missing-thread-copy">
        <h2 id="missing-thread-title">{t("missingThreadTitle")}</h2>
        <p>{t("missingThreadDescription")}</p>
        <code className="missing-thread-id">{threadId}</code>
        <p className="missing-thread-help">{t("missingThreadHelp")}</p>

        {showRelink && (
          <form
            className="missing-thread-relink"
            onSubmit={(event) => {
              event.preventDefault();
              const candidate = replacementId.trim();
              if (candidate) onRelink(candidate);
            }}
          >
            <label htmlFor="missing-thread-replacement">
              {t("replacementThreadId")}
            </label>
            <div>
              <input
                ref={input}
                id="missing-thread-replacement"
                value={replacementId}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("replacementThreadIdPlaceholder")}
                onChange={(event) => setReplacementId(event.target.value)}
              />
              <button
                type="submit"
                className="primary pressable"
                disabled={busy || !replacementId.trim()}
              >
                {busy && <LoaderCircle className="spin" size={13} />}
                {t("verifyAndRelink")}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="missing-thread-error" role="status">
            {error}
          </p>
        )}

        <div className="missing-thread-actions">
          <button
            type="button"
            className="primary pressable"
            disabled={busy}
            onClick={onRepair}
          >
            {busy ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <Wrench size={13} />
            )}
            {t("repairMissingThread")}
          </button>
          <button
            type="button"
            className="secondary pressable"
            disabled={busy}
            onClick={() => setShowRelink((visible) => !visible)}
          >
            <Link2 size={13} />
            {t("relinkThread")}
          </button>
          <button
            type="button"
            className="missing-thread-delete pressable"
            disabled={busy}
            onClick={onDeleteMetadata}
          >
            <Trash2 size={13} />
            {t("deleteTaskMetadata")}
          </button>
        </div>
      </div>
    </section>
  );
}

export function MessageAttachments({
  attachments,
  attachmentPreview,
}: {
  attachments: readonly AttachmentData[];
  attachmentPreview?: AttachmentPreviewAdapter;
}) {
  const { t } = useI18n();
  const images = attachments.filter(
    (attachment) =>
      attachment.kind === "image" &&
      Boolean(
        attachmentPreview &&
        (previewUrlFor(attachmentPreview, attachment) ||
          attachmentPreview.loadImageUrl),
      ),
  );
  const imageIds = new Set(images.map((attachment) => attachment.id));
  const files = attachments.filter(
    (attachment) => !imageIds.has(attachment.id),
  );
  return (
    <div className="message-attachments" aria-label={t("messageAttachments")}>
      {images.length > 0 && (
        <div className="message-image-grid">
          {images.map((attachment) => (
            <AttachmentImage
              key={attachment.id}
              attachment={attachment}
              attachmentPreview={attachmentPreview!}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="message-file-list">
          {files.map((attachment) => (
            <div className="message-file" key={attachment.id}>
              <span className="attachment-file-icon">
                <FileText size={16} />
              </span>
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatFileSize(attachment.size)}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentImage({
  attachment,
  attachmentPreview,
}: {
  attachment: AttachmentData;
  attachmentPreview: AttachmentPreviewAdapter;
}) {
  const [url, setUrl] = useState(() =>
    previewUrlFor(attachmentPreview, attachment),
  );

  useEffect(() => {
    let active = true;
    const immediate = previewUrlFor(attachmentPreview, attachment);
    setUrl(immediate);
    if (!immediate && attachmentPreview.loadImageUrl) {
      void attachmentPreview
        .loadImageUrl(attachment)
        .then((loaded) => {
          if (active && loaded) setUrl(loaded);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [attachment.id, attachment.mimeType, attachment.path, attachmentPreview]);

  return url ? (
    <img src={url} alt={attachment.name} loading="lazy" />
  ) : (
    <div className="message-image-placeholder" aria-label={attachment.name}>
      <FileText size={18} />
      <span>{attachment.name}</span>
    </div>
  );
}

function previewUrlFor(
  attachmentPreview: AttachmentPreviewAdapter | undefined,
  attachment: AttachmentData,
): string | undefined {
  try {
    return attachmentPreview?.imageUrl(attachment);
  } catch {
    return undefined;
  }
}

export function ComposerAttachments({
  attachments,
  onRemove,
  disabled,
}: {
  attachments: readonly PendingAttachment[];
  onRemove(id: string): void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="composer-attachments" aria-label={t("pendingAttachments")}>
      {attachments.map((attachment) => {
        const isImage = attachment.file.type.startsWith("image/");
        return (
          <div
            className={`composer-attachment ${isImage ? "image" : "file"}`}
            key={attachment.id}
            title={attachment.file.name}
          >
            {isImage && attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt={attachment.file.name} />
            ) : (
              <span className="attachment-file-icon">
                <FileText size={17} />
              </span>
            )}
            {!isImage && (
              <span className="composer-attachment-copy">
                <strong>{attachment.file.name}</strong>
                <small>{formatFileSize(attachment.file.size)}</small>
              </span>
            )}
            <button
              type="button"
              className="attachment-remove pressable"
              onClick={() => onRemove(attachment.id)}
              disabled={disabled}
              aria-label={t("removeFile", { name: attachment.file.name })}
              title={t("remove")}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function shortId(id?: string): string {
  return id ? id.slice(0, 8) : "—";
}

export function connectionLabel(connection: string, t: Translate): string {
  if (connection === "ready") return t("runtimeConnected");
  if (connection === "error") return t("runtimeOffline");
  return t("connectionConnecting");
}

export function voiceInputHint(
  status: VoiceInputStatus,
  error: string | undefined,
  t: Translate,
): string {
  if (error) return error;
  if (status === "requesting") return t("microphoneRequestHint");
  if (status === "recording") return t("recordingHint");
  if (status === "transcribing") return t("transcribingHint");
  return t("composerHint");
}

export function attachmentHint(
  status: VoiceInputStatus,
  voiceError: string | undefined,
  attachmentError: string | undefined,
  submissionError: string | undefined,
  attachments: readonly PendingAttachment[],
  preparing: boolean,
  isRunning: boolean,
  submitting: boolean,
  t: Translate,
): string {
  if (voiceError || status !== "idle") {
    return voiceInputHint(status, voiceError, t);
  }
  if (attachmentError) return attachmentError;
  if (submissionError) return t("sendFailed", { message: submissionError });
  if (submitting) return t("sending");
  if (preparing) return t("preparingAttachments");
  if (attachments.length > 0) {
    return t(isRunning ? "queuedAttachmentsAdded" : "attachmentsAdded", {
      count: attachments.length,
    });
  }
  if (isRunning) return t("runningComposerHint");
  return voiceInputHint(status, undefined, t);
}

export function composerSubmitDelivery(
  _event: Pick<KeyboardEvent<HTMLTextAreaElement>, "metaKey" | "ctrlKey">,
  isRunning: boolean,
): "inject" | "queued" {
  return isRunning ? "queued" : "inject";
}

export function hasFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function hasUserInput(
  messages: readonly { role: "user" | "assistant" }[],
): boolean {
  return messages.some((message) => message.role === "user");
}

export function projectContainingThread(
  snapshot: ProjectsSnapshot,
  threadId: string | undefined,
): ProjectSummary | undefined {
  if (!threadId) return;
  return snapshot.projects.find((project) =>
    project.conversations.some((conversation) => conversation.id === threadId),
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
