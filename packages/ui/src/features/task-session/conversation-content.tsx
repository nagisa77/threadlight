import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  AgentTaskData,
  AgentTreeData,
  AttachmentData,
} from "@threadlight/protocol";
import {
  Bot,
  Check,
  ChevronRight,
  CirclePause,
  CircleStop,
  Clock3,
  FileText,
  GitBranch,
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
import type {
  PendingAttachment,
  VoiceInputStatus,
  AttachmentPreviewAdapter,
} from "../shared/adapters.js";
import { connectionLabel, errorMessage, shortId } from "../shared/format.js";
import { agentThreadTree } from "./agent-threads.js";
import type { ConversationProgress, ToolActivity } from "./session.js";

export function ProgressList({
  progress,
  live = false,
  onTerminateProcess,
  onReadActivity,
  onOpenLocalFile,
  onRevealLocalFile,
}: {
  progress: readonly ConversationProgress[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
  onReadActivity?(activityId: string): Promise<ToolActivity>;
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
              onReadActivity={onReadActivity}
            />
          )}
        </div>
      ))}
    </div>
  );
}

type AgentTreePanelProps = {
  tree?: AgentTreeData;
  onOpenInPanel(tree: AgentTreeData, agentThreadId: string): void;
};

export function AgentTreePanel(props: AgentTreePanelProps) {
  return props.tree ? <AgentTreeContent {...props} tree={props.tree} /> : null;
}

function AgentTreeContent({
  tree,
  onOpenInPanel,
}: AgentTreePanelProps & { tree: AgentTreeData }) {
  const { t } = useI18n();
  const agentThreads = agentThreadTree(tree.agents, tree.rootId, {
    includeRoot: false,
  });
  const activeCount = agentThreads.filter(
    ({ latest }) => latest.status === "queued" || latest.status === "running",
  ).length;

  if (agentThreads.length === 0) return null;

  return (
    <section className="agent-tree" aria-label={t("agents")}>
      <header className="agent-tree-heading">
        <GitBranch size={14} aria-hidden="true" />
        <h3>{t("agents")}</h3>
        <span className="agent-tree-count">
          {activeCount > 0
            ? t("agentActiveCount", { count: activeCount })
            : t("agentDoneCount", { count: agentThreads.length })}
        </span>
      </header>
      <div className="agent-tree-content">
        <ul className="agent-tree-list">
          {agentThreads.map((thread) => {
            const agent = thread.latest;
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  className="agent-row pressable"
                  data-depth={thread.depth}
                  style={{
                    paddingInlineStart: `${12 + thread.depth * 14}px`,
                  }}
                  onClick={() => onOpenInPanel(tree, thread.id)}
                >
                  <AgentStatusIcon agent={agent} />
                  <span className="agent-row-copy">
                    <span className="agent-row-title">
                      <strong>
                        {agent.id === tree.rootId ? t("mainAgent") : agent.name}
                      </strong>
                      <small>{agent.task}</small>
                    </span>
                    <span className="agent-row-meta">
                      <span>{agentStatusLabel(agent, t)}</span>
                      {thread.turns.length > 1 && (
                        <span>
                          {t("agentTurnCount", { count: thread.turns.length })}
                        </span>
                      )}
                      {agent.latestActivity && (
                        <span className="agent-row-activity">
                          {agent.latestActivity}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="agent-row-time">
                    <Clock3 size={11} aria-hidden="true" />
                    {formatAgentDuration(agent.elapsedMs, t)}
                  </span>
                  <ChevronRight
                    className="agent-row-chevron"
                    size={13}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function AgentStatusIcon({ agent }: { agent: AgentTaskData }) {
  if (agent.closedAt) {
    return (
      <span className="agent-status closed">
        <CircleStop size={14} />
      </span>
    );
  }
  if (agent.status === "running") {
    return (
      <span className="agent-status running">
        {agent.phase === "thinking" ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Bot size={14} />
        )}
      </span>
    );
  }
  if (agent.status === "queued") {
    return (
      <span className="agent-status queued">
        <Clock3 size={14} />
      </span>
    );
  }
  if (agent.status === "failed") {
    return (
      <span className="agent-status failed">
        <X size={14} />
      </span>
    );
  }
  if (agent.status === "cancelled") {
    return (
      <span className="agent-status cancelled">
        <CircleStop size={14} />
      </span>
    );
  }
  if (agent.status === "interrupted") {
    return (
      <span className="agent-status interrupted">
        <CirclePause size={14} />
      </span>
    );
  }
  return (
    <span className="agent-status completed">
      <Check size={14} />
    </span>
  );
}

function agentStatusLabel(agent: AgentTaskData, t: Translate): string {
  if (agent.closedAt) return t("agentClosed");
  if (agent.status === "queued") return t("agentQueued");
  if (agent.status === "failed") return t("agentFailed");
  if (agent.status === "cancelled") return t("agentCancelled");
  if (agent.status === "interrupted") return t("agentInterrupted");
  if (agent.status === "completed") return t("agentCompleted");
  if (agent.phase === "working") return t("agentWorking");
  if (agent.phase === "waiting") return t("agentWaiting");
  return t("agentThinking");
}

function formatAgentDuration(elapsedMs: number, t: Translate): string {
  if (elapsedMs < 1_000) return t("agentNow");
  if (elapsedMs < 60_000)
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`;
  return `${Math.round(elapsedMs / 60_000)}m`;
}

export function ActivityList({
  activities,
  live = false,
  onTerminateProcess,
  onReadActivity,
}: {
  activities: readonly ToolActivity[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
  onReadActivity?(activityId: string): Promise<ToolActivity>;
}) {
  const { t } = useI18n();
  const hasAttentionActivity = activities.some(
    (activity) =>
      activity.status === "failed" ||
      activity.status === "terminated" ||
      activity.status === "completed_with_warnings",
  );
  const [expanded, setExpanded] = useState(live || hasAttentionActivity);
  const [details, setDetails] = useState<ReadonlyMap<string, ToolActivity>>(
    () => new Map(),
  );
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const requestedIds = useRef(new Set<string>());
  const hasRunningActivity = activities.some(
    (activity) => activity.status === "running",
  );

  useEffect(() => {
    if (!expanded || !onReadActivity) return;
    for (const activity of activities) {
      if (
        !activity.detailAvailable ||
        activity.detail !== undefined ||
        activity.process !== undefined ||
        details.has(activity.id) ||
        requestedIds.current.has(activity.id)
      ) {
        continue;
      }
      requestedIds.current.add(activity.id);
      setLoadingIds((current) => new Set(current).add(activity.id));
      setFailedIds((current) => {
        if (!current.has(activity.id)) return current;
        const next = new Set(current);
        next.delete(activity.id);
        return next;
      });
      void onReadActivity(activity.id)
        .then((detail) => {
          setDetails((current) => new Map(current).set(activity.id, detail));
        })
        .catch(() => {
          requestedIds.current.delete(activity.id);
          setFailedIds((current) => new Set(current).add(activity.id));
        })
        .finally(() => {
          setLoadingIds((current) => {
            const next = new Set(current);
            next.delete(activity.id);
            return next;
          });
        });
    }
  }, [activities, details, expanded, onReadActivity]);

  return (
    <details
      className={live ? "activity-list live" : "activity-list"}
      data-activity-ids={activities.map(({ id }) => id).join(" ")}
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
      {expanded && (
        <div className="activity-content">
          {activities.map((activity) => {
            const resolved =
              activity.detail !== undefined || activity.process !== undefined
                ? activity
                : (details.get(activity.id) ?? activity);
            return (
              <div
                id={`activity-${activity.id}`}
                className="activity-item"
                key={activity.id}
                tabIndex={-1}
              >
                <div className="activity-summary">
                  <ActivityStatus status={activity.status} />
                  <code>{activity.name}</code>
                  {loadingIds.has(activity.id) && (
                    <span className="activity-detail-state">
                      <LoaderCircle className="spin" size={12} />
                      {t("loading")}
                    </span>
                  )}
                  {failedIds.has(activity.id) && (
                    <span className="activity-detail-state failed">
                      {t("activityDetailsUnavailable")}
                    </span>
                  )}
                  {resolved.name === "exec_command" &&
                    resolved.process?.status === "running" &&
                    onTerminateProcess && (
                      <TerminateProcessButton
                        sessionId={resolved.process.sessionId}
                        onTerminate={onTerminateProcess}
                      />
                    )}
                </div>
                {resolved.detail && <pre>{resolved.detail}</pre>}
                {resolved.name === "exec_command" && resolved.process && (
                  <CommandOutput process={resolved.process} />
                )}
              </div>
            );
          })}
        </div>
      )}
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
  const [expanded, setExpanded] = useState(false);
  if (!process) return null;
  const output = expanded
    ? [process.stdout, process.stderr ? `stderr\n${process.stderr}` : ""]
        .filter(Boolean)
        .join("\n")
    : "";
  return (
    <details
      className="command-output"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight size={12} aria-hidden="true" />
        <span>{t("commandOutput")}</span>
        {process.truncated && (
          <span className="output-note">{t("truncated")}</span>
        )}
      </summary>
      {expanded && <pre>{output || t("noOutput")}</pre>}
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

export { connectionLabel, shortId } from "../shared/format.js";

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

export { errorMessage } from "../shared/format.js";
