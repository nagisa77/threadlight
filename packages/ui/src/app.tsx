import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleStop,
  LoaderCircle,
  Plus,
  Settings,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

import {
  useThreadlightSession,
  type PendingApproval,
  type ToolActivity,
} from "./session.js";
import { MarkdownContent } from "./markdown.js";
import { isNearBottom } from "./scroll.js";
import { SettingsPage, type SettingsAdapter } from "./settings.js";

export interface ThreadlightAppProps {
  client: ThreadlightClient;
  settings?: SettingsAdapter;
}

const suggestions = [
  "解释这个代码库的架构",
  "运行测试并修复失败",
  "帮我规划下一个功能",
];

export function ThreadlightApp({ client, settings }: ThreadlightAppProps) {
  const { state, retry, newThread, send, interrupt, resolveApproval } =
    useThreadlightSession(client);
  const [view, setView] = useState<"thread" | "settings">("thread");
  const [input, setInput] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const followOutput = useRef(true);

  useEffect(() => {
    const element = conversation.current;
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [state.messages.length, state.activities.length, state.approval]);

  async function submit(value = input) {
    followOutput.current = true;
    if (await send(value)) {
      setInput("");
      if (textarea.current) textarea.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag-region" />
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>Threadlight</span>
        </div>

        <button
          className="new-thread-button pressable"
          onClick={() => {
            setView("thread");
            void newThread();
          }}
          disabled={state.isRunning || state.connection !== "ready"}
        >
          <Plus size={15} strokeWidth={2.2} />
          新建任务
        </button>

        <nav className="thread-list" aria-label="任务列表">
          <p className="section-label">当前</p>
          {state.threadId ? (
            <div className="thread-item active" aria-current="page">
              <span className="thread-title">
                {state.messages[0]?.text || "新任务"}
              </span>
              <span className="thread-id">{shortId(state.threadId)}</span>
            </div>
          ) : (
            <div className="thread-placeholder">正在准备任务…</div>
          )}
        </nav>

        <div className="sidebar-footer">
          {settings && (
            <button
              type="button"
              className={`settings-nav-button pressable ${view === "settings" ? "active" : ""}`}
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => setView("settings")}
            >
              <Settings size={15} />
              设置
            </button>
          )}
          <div className="sidebar-status">
            <span className={`status-dot ${state.connection}`} />
            <span>{connectionLabel(state.connection)}</span>
            <span className="status-mode">本地</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {view === "settings" && settings ? (
          <SettingsPage adapter={settings} onRuntimeRestart={retry} />
        ) : (
          <>
            <header className="workspace-header">
              <div>
                <h1>{state.messages[0]?.text || "新任务"}</h1>
                <p>Agent runtime · {shortId(state.threadId)}</p>
              </div>
              {state.isRunning && (
                <span className="running-badge">
                  <LoaderCircle size={13} /> 正在运行
                </span>
              )}
            </header>

            <section
              ref={conversation}
              className="conversation"
              aria-live="polite"
              onScroll={(event) => {
                followOutput.current = isNearBottom(event.currentTarget);
              }}
            >
              <div className="conversation-inner">
                {state.connection === "error" && (
                  <ConnectionError
                    message={state.connectionError ?? "无法连接 app-server"}
                    onRetry={() => void retry()}
                    onOpenSettings={settings ? () => setView("settings") : undefined}
                  />
                )}

                {state.messages.length === 0 && state.connection !== "error" ? (
                  <EmptyState
                    connecting={state.connection === "connecting"}
                    onSelect={(value) => {
                      setInput(value);
                      textarea.current?.focus();
                    }}
                  />
                ) : (
                  <div className="message-list">
                    {state.messages.map((message) => (
                      <article
                        className={`message ${message.role} ${message.error ? "error" : ""}`}
                        key={message.id}
                      >
                        <div className="message-body">
                          {message.activities && message.activities.length > 0 && (
                            <ActivityList activities={message.activities} />
                          )}
                          {message.role === "assistant" ? (
                            <MarkdownContent>{message.text}</MarkdownContent>
                          ) : (
                            <p>{message.text}</p>
                          )}
                        </div>
                      </article>
                    ))}

                    {(state.activities.length > 0 || state.isThinking) && (
                      <div className="live-run">
                        {state.activities.length > 0 && (
                          <ActivityList activities={state.activities} live />
                        )}
                        {state.isThinking && (
                          <div className="thinking-row">
                            <LoaderCircle size={15} />
                            正在思考…
                          </div>
                        )}
                      </div>
                    )}

                    {state.approval && (
                      <ApprovalCard
                        approval={state.approval}
                        onResolve={(approved) => void resolveApproval(approved)}
                      />
                    )}
                  </div>
                )}
              </div>
            </section>

            <footer className="composer-wrap">
              <div className="composer">
                <textarea
                  ref={textarea}
                  value={input}
                  rows={1}
                  placeholder="向 Threadlight 提问…"
                  disabled={state.connection !== "ready"}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  onInput={(event) => {
                    event.currentTarget.style.height = "auto";
                    event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
                  }}
                  aria-label="消息"
                />
                {state.isRunning ? (
                  <button
                    className="composer-action stop pressable"
                    onClick={() => void interrupt()}
                    aria-label="停止运行"
                    title="停止"
                  >
                    <CircleStop size={18} />
                  </button>
                ) : (
                  <button
                    className="composer-action send pressable"
                    onClick={() => void submit()}
                    disabled={!input.trim() || state.connection !== "ready"}
                    aria-label="发送消息"
                    title="发送"
                  >
                    <ArrowUp size={18} strokeWidth={2.4} />
                  </button>
                )}
              </div>
              <p className="composer-hint">Enter 发送 · Shift + Enter 换行</p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({
  connecting,
  onSelect,
}: {
  connecting: boolean;
  onSelect(value: string): void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      <h2>{connecting ? "正在连接运行时…" : "今天想推进什么？"}</h2>
      <p>描述目标，Threadlight 会展示每一步模型调用和工具执行。</p>
      {!connecting && (
        <div className="suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              className="suggestion pressable"
              onClick={() => onSelect(suggestion)}
            >
              {suggestion}
              <ArrowUp size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityList({
  activities,
  live = false,
}: {
  activities: readonly ToolActivity[];
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState(live);

  return (
    <details
      className={live ? "activity-list live" : "activity-list"}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="activity-heading">
        <Terminal size={14} />
        <span>{live ? "执行中" : "执行记录"}</span>
        <span className="activity-count">{activities.length}</span>
        <ChevronRight className="activity-chevron" size={13} aria-hidden="true" />
      </summary>
      <div className="activity-content">
        {activities.map((activity) => (
          <div className="activity-item" key={activity.id}>
            <div className="activity-summary">
              <ActivityStatus status={activity.status} />
              <code>{activity.name}</code>
            </div>
            {activity.detail && <pre>{activity.detail}</pre>}
          </div>
        ))}
      </div>
    </details>
  );
}

function ActivityStatus({ status }: Pick<ToolActivity, "status">) {
  if (status === "running") return <LoaderCircle className="spin" size={14} />;
  if (status === "failed") return <X className="failed" size={14} />;
  return <Check className="completed" size={14} />;
}

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: PendingApproval;
  onResolve(approved: boolean): void;
}) {
  return (
    <div className="approval-card">
      <div className="approval-icon">
        <Terminal size={16} />
      </div>
      <div className="approval-content">
        <strong>允许执行 {approval.call.name}？</strong>
        <p>此工具将以当前用户权限在本地运行。</p>
        <pre>{formatArguments(approval.call.arguments)}</pre>
        <div className="approval-actions">
          <button className="secondary pressable" onClick={() => onResolve(false)}>
            拒绝
          </button>
          <button className="primary pressable" onClick={() => onResolve(true)}>
            允许
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionError({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  onRetry(): void;
  onOpenSettings?(): void;
}) {
  return (
    <div className="connection-error">
      <span className="error-icon">
        <X size={16} />
      </span>
      <div>
        <strong>无法连接到运行时</strong>
        <p>{message}</p>
        <p className="error-help">请在设置中配置 OpenAI API Key，然后重新连接。</p>
        <div className="connection-actions">
          {onOpenSettings && (
            <button className="primary pressable" onClick={onOpenSettings}>
              打开设置
            </button>
          )}
          <button className="secondary pressable" onClick={onRetry}>
            重新连接
          </button>
        </div>
      </div>
    </div>
  );
}

function shortId(id?: string): string {
  return id ? id.slice(0, 8) : "—";
}

function connectionLabel(connection: string): string {
  if (connection === "ready") return "运行时已连接";
  if (connection === "error") return "运行时离线";
  return "正在连接";
}

function formatArguments(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
