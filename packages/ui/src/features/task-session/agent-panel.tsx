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
  ChevronDown,
  ChevronUp,
  CirclePause,
  CircleStop,
  Clock3,
  GitBranch,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react";

import { useI18n, type Translate } from "../../i18n.js";
import { MarkdownContent } from "../../markdown.js";
import {
  agentThreadTree,
  totalAgentElapsedMs,
  totalAgentSteps,
  totalAgentTokens,
  type AgentThreadView,
} from "./agent-threads.js";

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
  const agentThreads = useMemo(
    () => (tree ? agentThreadTree(agents, tree.rootId) : []),
    [agents, tree?.rootId],
  );
  const preferredId = useMemo(
    () =>
      agentThreads.find(
        ({ latest }) =>
          latest.parentId === tree?.rootId &&
          (latest.status === "running" || latest.status === "queued"),
      )?.id ??
      agentThreads.find(
        ({ latest }) =>
          latest.status === "running" || latest.status === "queued",
      )?.id ??
      agentThreads.find(({ latest }) => latest.parentId === tree?.rootId)?.id ??
      tree?.rootId,
    [agentThreads, tree?.rootId],
  );
  const [selectedId, setSelectedId] = useState(preferredId);
  const [listCollapsed, setListCollapsed] = useState(false);

  useEffect(() => {
    if (!agentThreads.some(({ id }) => id === selectedId)) {
      setSelectedId(preferredId);
    }
  }, [agentThreads, preferredId, selectedId]);

  const selected = agentThreads.find(({ id }) => id === selectedId);
  const childThreads = agentThreads.filter(({ id }) => id !== tree?.rootId);
  const active = childThreads.filter(
    ({ latest }) => latest.status === "queued" || latest.status === "running",
  ).length;

  return (
    <section
      className="agent-panel"
      role="tabpanel"
      aria-label={t("agents")}
      hidden={hidden}
    >
      {!tree || agentThreads.length === 0 ? (
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
            <div className="agent-panel-summary-actions">
              <small>
                {active > 0
                  ? t("agentActiveCount", { count: active })
                  : t("agentDoneCount", { count: childThreads.length })}
                {" · "}
                {t("agentConcurrency", { count: tree.maxConcurrent })}
              </small>
              <button
                type="button"
                className="agent-panel-list-toggle pressable"
                aria-controls="agent-panel-list"
                aria-expanded={!listCollapsed}
                aria-label={
                  listCollapsed ? t("showAgentList") : t("hideAgentList")
                }
                title={listCollapsed ? t("showAgentList") : t("hideAgentList")}
                onClick={() => setListCollapsed((collapsed) => !collapsed)}
              >
                {listCollapsed ? (
                  <PanelRightOpen size={14} />
                ) : (
                  <PanelRightClose size={14} />
                )}
              </button>
            </div>
          </header>
          <div
            className={`agent-panel-layout${listCollapsed ? " collapsed" : ""}`}
          >
            {selected && (
              <AgentConversation
                key={selected.id}
                thread={selected}
                isRoot={selected.id === tree.rootId}
                live={live}
                controls={controls}
              />
            )}
            <nav
              id="agent-panel-list"
              className="agent-panel-list"
              aria-label={t("agentList")}
              hidden={listCollapsed}
            >
              {agentThreads.map((thread) => {
                const agent = thread.latest;
                return (
                  <button
                    type="button"
                    key={thread.id}
                    className={`agent-panel-agent pressable${thread.id === selectedId ? " selected" : ""}`}
                    data-depth={thread.depth}
                    style={{
                      paddingInlineStart: `${12 + thread.depth * 14}px`,
                    }}
                    aria-current={thread.id === selectedId ? "true" : undefined}
                    onClick={() => setSelectedId(thread.id)}
                  >
                    <AgentStateIcon agent={agent} />
                    <span>
                      <strong>
                        {thread.id === tree.rootId
                          ? t("mainAgent")
                          : thread.initial.name}
                      </strong>
                      <small>{agent.task}</small>
                    </span>
                    <em>
                      {agentStatus(agent, t)}
                      {thread.turns.length > 1 && (
                        <>
                          {" "}
                          ·{" "}
                          {t("agentTurnCount", { count: thread.turns.length })}
                        </>
                      )}
                    </em>
                  </button>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </section>
  );
}

function AgentConversation({
  thread,
  isRoot,
  live,
  controls,
}: {
  thread: AgentThreadView;
  isRoot: boolean;
  live: boolean;
  controls?: AgentPanelControls;
}) {
  const { t } = useI18n();
  const agent = thread.latest;
  const [direction, setDirection] = useState("");
  const [taskExpanded, setTaskExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const active = agent.status === "queued" || agent.status === "running";
  const retryable =
    !agent.closedAt &&
    (agent.status === "failed" ||
      agent.status === "cancelled" ||
      agent.status === "interrupted");
  const canControl = live && !isRoot && controls?.threadId;
  const taskExpandable =
    thread.initial.task.length > 72 || thread.initial.task.includes("\n");
  const taskId = `agent-task-${thread.id}`;
  const steps = totalAgentSteps(thread);
  const tokens = totalAgentTokens(thread);

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
        <div className="agent-conversation-title-row">
          <span className="agent-conversation-identity">
            <AgentStateIcon agent={agent} />
            <strong>{isRoot ? t("mainAgent") : thread.initial.name}</strong>
            <small>{agentStatus(agent, t)}</small>
          </span>
          <div className="agent-conversation-actions">
            {canControl && active && (
              <button
                type="button"
                className="agent-action danger pressable"
                disabled={busy}
                aria-label={t("stopAgent")}
                title={t("stopAgent")}
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
                <span>{t("stopAgent")}</span>
              </button>
            )}
            {canControl && retryable && (
              <button
                type="button"
                className="agent-action pressable"
                disabled={busy}
                aria-label={t("retryAgent")}
                title={t("retryAgent")}
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
                <span>{t("retryAgent")}</span>
              </button>
            )}
          </div>
        </div>
        <div
          className={`agent-conversation-task${taskExpanded ? " expanded" : ""}`}
        >
          <p id={taskId}>{thread.initial.task}</p>
          {taskExpandable && (
            <button
              type="button"
              className="agent-conversation-task-toggle pressable"
              aria-controls={taskId}
              aria-expanded={taskExpanded}
              aria-label={
                taskExpanded ? t("hideAgentTask") : t("showAgentTask")
              }
              title={taskExpanded ? t("hideAgentTask") : t("showAgentTask")}
              onClick={() => setTaskExpanded((expanded) => !expanded)}
            >
              {taskExpanded ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          )}
        </div>
      </header>
      <div className="agent-conversation-meta">
        <span>
          <Clock3 size={11} /> {formatDuration(totalAgentElapsedMs(thread), t)}
        </span>
        {thread.turns.length > 1 && (
          <span>{t("agentTurnCount", { count: thread.turns.length })}</span>
        )}
        {steps !== undefined && (
          <span>
            {steps} {t("step")}
          </span>
        )}
        {tokens > 0 && (
          <span>
            {tokens.toLocaleString()} {t("tokens")}
          </span>
        )}
      </div>
      <p className="agent-visible-process-note">
        <Sparkles size={12} />
        {t("agentVisibleProcessNote")}
      </p>
      <div className="agent-transcript" aria-label={t("agentActivity")}>
        {thread.turns.map((turn, index) => (
          <AgentTurnTranscript
            key={turn.id}
            turn={turn}
            index={index}
            showTask={index > 0}
            showTimeline={thread.turns.length > 1}
          />
        ))}
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

function AgentTurnTranscript({
  turn,
  index,
  showTask,
  showTimeline,
}: {
  turn: AgentTaskData;
  index: number;
  showTask: boolean;
  showTimeline: boolean;
}) {
  const { t } = useI18n();
  const transcript = turn.transcript ?? [];
  const timeline = [
    ...(turn.messages ?? []).map((message) => ({
      id: message.id,
      at: message.createdAt,
      message,
    })),
    ...transcript.map((entry) => ({
      id: entry.id,
      at: entry.startedAt,
      entry,
    })),
  ].sort((left, right) => left.at.localeCompare(right.at));
  const active = turn.status === "queued" || turn.status === "running";

  return (
    <section className={showTimeline ? "agent-turn" : undefined}>
      {showTimeline && (
        <header className="agent-turn-header">
          <span>{t("agentTurn", { count: index + 1 })}</span>
          <small>{agentStatus(turn, t)}</small>
        </header>
      )}
      {showTask && <p className="agent-turn-task">{turn.task}</p>}
      {timeline.map((item) =>
        "message" in item ? (
          <section
            className="agent-transcript-message agent-transcript-agent-message"
            key={item.id}
          >
            <header>
              <SendHorizontal size={12} />
              <span>{item.message.fromAgentName}</span>
            </header>
            <MarkdownContent>{item.message.text}</MarkdownContent>
          </section>
        ) : (
          <AgentTranscriptEntry key={item.id} entry={item.entry} />
        ),
      )}
      {timeline.length === 0 && active && (
        <div className="agent-transcript-thinking">
          <LoaderCircle className="spin" size={14} />
          {t("agentThinking")}
        </div>
      )}
      {timeline.length === 0 && (turn.output || turn.error) && (
        <div
          className={`agent-transcript-message${turn.error ? " error" : ""}`}
        >
          <MarkdownContent>{turn.output ?? turn.error ?? ""}</MarkdownContent>
        </div>
      )}
      {timeline.length === 0 && !active && !turn.output && !turn.error && (
        <div className="agent-transcript-empty">{t("noAgentActivity")}</div>
      )}
    </section>
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
  if (agent.closedAt) return <CircleStop size={14} />;
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
  if (agent.status === "interrupted") return <CirclePause size={14} />;
  return <Check size={14} />;
}

function agentStatus(agent: AgentTaskData, t: Translate): string {
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

function formatDuration(elapsedMs: number, t: Translate): string {
  if (elapsedMs < 1_000) return t("agentNow");
  if (elapsedMs < 60_000)
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`;
  return `${Math.round(elapsedMs / 60_000)}m`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
