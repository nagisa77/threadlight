import { useEffect, useMemo, useState } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type {
  AgentTaskData,
  AgentTaskTranscriptEntryData,
  AgentTreeData,
} from "@threadlight/protocol";
import {
  Bot,
  Check,
  CircleStop,
  Clock3,
  GitBranch,
  LoaderCircle,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react";

import { useI18n, type Translate } from "../../i18n.js";
import { MarkdownContent } from "../../markdown.js";

export interface AgentPanelControls {
  client: Pick<ThreadlightClient, "cancelAgent" | "retryAgent" | "steerAgent">;
  threadId?: string;
}

export function AgentPanel({
  tree,
  live = false,
  controls,
  hidden = false,
}: {
  tree?: AgentTreeData;
  live?: boolean;
  controls?: AgentPanelControls;
  hidden?: boolean;
}) {
  const { t } = useI18n();
  const agents = tree?.agents ?? [];
  const preferredId = useMemo(
    () =>
      agents.find(
        ({ parentId, status }) =>
          parentId === tree?.rootId &&
          (status === "running" || status === "queued"),
      )?.id ??
      agents.find(({ parentId }) => parentId === tree?.rootId)?.id ??
      tree?.rootId,
    [agents, tree?.rootId],
  );
  const [selectedId, setSelectedId] = useState(preferredId);

  useEffect(() => {
    if (!agents.some(({ id }) => id === selectedId)) {
      setSelectedId(preferredId);
    }
  }, [agents, preferredId, selectedId]);

  const selected = agents.find(({ id }) => id === selectedId);
  const active = agents.filter(
    ({ status }) => status === "queued" || status === "running",
  ).length;

  return (
    <section
      className="agent-panel"
      role="tabpanel"
      aria-label={t("agents")}
      hidden={hidden}
    >
      {!tree || agents.length === 0 ? (
        <div className="agent-panel-empty">
          <GitBranch size={18} />
          <strong>{t("noAgentRuns")}</strong>
          <p>{t("noAgentRunsDescription")}</p>
        </div>
      ) : (
        <>
          <header className="agent-panel-summary">
            <span>
              <GitBranch size={15} />
              <strong>{t("agents")}</strong>
            </span>
            <small>
              {active > 0
                ? t("agentActiveCount", { count: active })
                : t("agentDoneCount", { count: agents.length - 1 })}
              {" · "}
              {t("agentConcurrency", { count: tree.maxConcurrent })}
            </small>
          </header>
          <div className="agent-panel-layout">
            <nav className="agent-panel-list" aria-label={t("agentList")}>
              {agents.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  className={`agent-panel-agent pressable${agent.id === selectedId ? " selected" : ""}`}
                  aria-current={agent.id === selectedId ? "true" : undefined}
                  onClick={() => setSelectedId(agent.id)}
                >
                  <AgentStateIcon agent={agent} />
                  <span>
                    <strong>
                      {agent.id === tree.rootId ? t("mainAgent") : agent.name}
                    </strong>
                    <small>{agent.task}</small>
                  </span>
                  <em>{agentStatus(agent, t)}</em>
                </button>
              ))}
            </nav>
            {selected && (
              <AgentConversation
                agent={selected}
                isRoot={selected.id === tree.rootId}
                live={live}
                controls={controls}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function AgentConversation({
  agent,
  isRoot,
  live,
  controls,
}: {
  agent: AgentTaskData;
  isRoot: boolean;
  live: boolean;
  controls?: AgentPanelControls;
}) {
  const { t } = useI18n();
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const active = agent.status === "queued" || agent.status === "running";
  const retryable = agent.status === "failed" || agent.status === "cancelled";
  const canControl = live && !isRoot && controls?.threadId;
  const transcript = agent.transcript ?? [];

  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="agent-conversation">
      <header className="agent-conversation-header">
        <div>
          <span>
            <AgentStateIcon agent={agent} />
            <strong>{isRoot ? t("mainAgent") : agent.name}</strong>
            <small>{agentStatus(agent, t)}</small>
          </span>
          <p>{agent.task}</p>
        </div>
        <div className="agent-conversation-actions">
          {canControl && active && (
            <button
              type="button"
              className="agent-action danger pressable"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await controls.client.cancelAgent(
                    controls.threadId!,
                    agent.id,
                  );
                  if (!result.cancelled) {
                    throw new Error(t("agentActionUnavailable"));
                  }
                })
              }
            >
              <Square size={11} fill="currentColor" />
              {t("stopAgent")}
            </button>
          )}
          {canControl && retryable && (
            <button
              type="button"
              className="agent-action pressable"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await controls.client.retryAgent(
                    controls.threadId!,
                    agent.id,
                  );
                  if (!result.agent) {
                    throw new Error(t("agentActionUnavailable"));
                  }
                })
              }
            >
              <RotateCcw size={12} />
              {t("retryAgent")}
            </button>
          )}
        </div>
      </header>
      <div className="agent-conversation-meta">
        <span>
          <Clock3 size={11} /> {formatDuration(agent.elapsedMs, t)}
        </span>
        {agent.steps !== undefined && (
          <span>
            {agent.steps} {t("step")}
          </span>
        )}
        {(agent.usage?.totalTokens ?? 0) > 0 && (
          <span>
            {agent.usage?.totalTokens.toLocaleString()} {t("tokens")}
          </span>
        )}
      </div>
      <p className="agent-visible-process-note">
        <Sparkles size={12} />
        {t("agentVisibleProcessNote")}
      </p>
      <div className="agent-transcript" aria-label={t("agentActivity")}>
        {transcript.map((entry) => (
          <AgentTranscriptEntry key={entry.id} entry={entry} />
        ))}
        {transcript.length === 0 && active && (
          <div className="agent-transcript-thinking">
            <LoaderCircle className="spin" size={14} />
            {t("agentThinking")}
          </div>
        )}
        {transcript.length === 0 && (agent.output || agent.error) && (
          <div
            className={`agent-transcript-message${agent.error ? " error" : ""}`}
          >
            <MarkdownContent>
              {agent.output ?? agent.error ?? ""}
            </MarkdownContent>
          </div>
        )}
        {transcript.length === 0 &&
          !active &&
          !agent.output &&
          !agent.error && (
            <div className="agent-transcript-empty">{t("noAgentActivity")}</div>
          )}
      </div>
      {canControl && active && (
        <form
          className="agent-steer agent-panel-steer"
          onSubmit={(event) => {
            event.preventDefault();
            const input = direction.trim();
            if (!input) return;
            void act(async () => {
              const result = await controls.client.steerAgent(
                controls.threadId!,
                agent.id,
                input,
              );
              if (!result.accepted) {
                throw new Error(t("agentActionUnavailable"));
              }
            }).then((sent) => {
              if (sent) setDirection("");
            });
          }}
        >
          <input
            value={direction}
            disabled={busy}
            aria-label={t("steerAgent")}
            placeholder={t("steerAgentPlaceholder")}
            onChange={(event) => setDirection(event.currentTarget.value)}
          />
          <button
            type="submit"
            className="agent-steer-send pressable"
            disabled={busy || !direction.trim()}
            aria-label={t("sendDirection")}
          >
            <SendHorizontal size={13} />
          </button>
        </form>
      )}
      {actionError && (
        <p className="agent-action-error" role="alert">
          {actionError}
        </p>
      )}
    </article>
  );
}

function AgentTranscriptEntry({
  entry,
}: {
  entry: AgentTaskTranscriptEntryData;
}) {
  const { t } = useI18n();
  if (entry.kind === "model") {
    if (!entry.text && entry.status === "running") {
      return (
        <div className="agent-transcript-thinking">
          <LoaderCircle className="spin" size={14} />
          {t("agentThinking")}
        </div>
      );
    }
    if (!entry.text) return null;
    return (
      <section className="agent-transcript-message">
        <header>
          <Bot size={13} />
          <span>{t("agentModelStep", { step: entry.step })}</span>
          {entry.status === "running" && (
            <LoaderCircle className="spin" size={12} />
          )}
        </header>
        <MarkdownContent>{entry.text}</MarkdownContent>
      </section>
    );
  }

  const failed = entry.status === "failed" || entry.isError;
  return (
    <details
      className={`agent-transcript-tool${failed ? " error" : ""}`}
      open={entry.status === "running" || failed}
    >
      <summary>
        {entry.status === "running" ? (
          <LoaderCircle className="spin" size={13} />
        ) : failed ? (
          <X size={13} />
        ) : (
          <Check size={13} />
        )}
        <Terminal size={12} />
        <code>{entry.name}</code>
        {entry.durationMs !== undefined && (
          <small>{formatDuration(entry.durationMs, t)}</small>
        )}
      </summary>
      <div>
        <label>{t("toolArguments")}</label>
        <pre>{entry.arguments || "{}"}</pre>
        {entry.output !== undefined && (
          <>
            <label>{t("toolOutput")}</label>
            <pre>{entry.output || t("noOutput")}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function AgentStateIcon({ agent }: { agent: AgentTaskData }) {
  if (agent.status === "running") {
    return agent.phase === "thinking" ? (
      <LoaderCircle className="spin" size={14} />
    ) : (
      <Bot size={14} />
    );
  }
  if (agent.status === "queued") return <Clock3 size={14} />;
  if (agent.status === "failed") return <X size={14} />;
  if (agent.status === "cancelled") return <CircleStop size={14} />;
  return <Check size={14} />;
}

function agentStatus(agent: AgentTaskData, t: Translate): string {
  if (agent.status === "queued") return t("agentQueued");
  if (agent.status === "failed") return t("agentFailed");
  if (agent.status === "cancelled") return t("agentCancelled");
  if (agent.status === "completed") return t("agentCompleted");
  if (agent.phase === "working") return t("agentWorking");
  if (agent.phase === "waiting") return t("agentWaiting");
  return t("agentThinking");
}

function formatDuration(elapsedMs: number, t: Translate): string {
  if (elapsedMs < 1_000) return t("agentNow");
  if (elapsedMs < 60_000)
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`;
  return `${Math.round(elapsedMs / 60_000)}m`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
