import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import {
  ArrowUp,
  Check,
  CircleStop,
  LoaderCircle,
  Plus,
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

export interface ThreadlightAppProps {
  client: ThreadlightClient;
}

const suggestions = [
  "解释这个代码库的架构",
  "运行测试并修复失败",
  "帮我规划下一个功能",
];

export function ThreadlightApp({ client }: ThreadlightAppProps) {
  const { state, retry, newThread, send, interrupt, resolveApproval } =
    useThreadlightSession(client);
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
          onClick={() => void newThread()}
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

        <div className="sidebar-status">
          <span className={`status-dot ${state.connection}`} />
          <span>{connectionLabel(state.connection)}</span>
          <span className="status-mode">本地</span>
        </div>
      </aside>

      <main className="workspace">
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

                {(state.activities.length > 0 || state.isRunning) && (
                  <div className="live-run">
                    {state.activities.length > 0 ? (
                      <ActivityList activities={state.activities} live />
                    ) : (
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

function ActivityList({
  activities,
  live = false,
}: {
  activities: readonly ToolActivity[];
  live?: boolean;
}) {
  return (
    <div className={`activity-list ${live ? "live" : ""}`}>
      <div className="activity-heading">
        <Terminal size={14} />
        <span>{live ? "执行中" : "执行记录"}</span>
        <span className="activity-count">{activities.length}</span>
      </div>
      {activities.map((activity) => (
        <div className="activity-item" key={activity.id}>
          <ActivityStatus status={activity.status} />
          <div>
            <code>{activity.name}</code>
            {activity.detail && <pre>{activity.detail}</pre>}
          </div>
        </div>
      ))}
    </div>
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
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <div className="connection-error">
      <span className="error-icon">
        <X size={16} />
      </span>
      <div>
        <strong>无法连接到运行时</strong>
        <p>{message}</p>
        <p className="error-help">确认启动环境已设置 OPENAI_API_KEY；必要时重启客户端。</p>
        <button className="secondary pressable" onClick={onRetry}>
          重新连接
        </button>
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
