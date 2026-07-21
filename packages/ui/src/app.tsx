import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ThreadlightClient } from "@threadlight/client";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleStop,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Plus,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
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
import {
  activeProject,
  type ConversationSummary,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "./projects.js";

export interface ThreadlightAppProps {
  client: ThreadlightClient;
  settings?: SettingsAdapter;
  projects?: ProjectsAdapter;
}

const suggestions = [
  "解释这个代码库的架构",
  "运行测试并修复失败",
  "帮我规划下一个功能",
];

export function ThreadlightApp({
  client,
  settings,
  projects,
}: ThreadlightAppProps) {
  const {
    state,
    retry,
    openThread,
    newThread,
    deleteThread,
    send,
    interrupt,
    resolveApproval,
  } = useThreadlightSession(client, { autoConnect: !projects });
  const [view, setView] = useState<"thread" | "settings">("thread");
  const [input, setInput] = useState("");
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectsSnapshot>();
  const [projectError, setProjectError] = useState<string>();
  const [switchingProject, setSwitchingProject] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    projectId: string;
    conversation: ConversationSummary;
  }>();
  const [deleteError, setDeleteError] = useState<string>();
  const [deletingConversation, setDeletingConversation] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLElement>(null);
  const followOutput = useRef(true);
  const currentProject = activeProject(projectSnapshot);

  const connectProject = useCallback(
    async (snapshot: ProjectsSnapshot, preferredThreadId?: string) => {
      if (!projects) return;
      const project = activeProject(snapshot);
      if (!project) return;

      const requestedThreadId =
        preferredThreadId ?? project.conversations[0]?.id;
      await openThread(requestedThreadId);
    },
    [openThread, projects],
  );

  useEffect(() => {
    if (!projects) return;
    let active = true;
    void projects
      .load()
      .then(async (snapshot) => {
        if (!active) return;
        setProjectSnapshot(snapshot);
        await connectProject(snapshot);
      })
      .catch((error) => {
        if (active) setProjectError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [connectProject, projects]);

  useEffect(() => {
    const element = conversation.current;
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [state.messages.length, state.activities.length, state.approval]);

  async function submit(value = input) {
    followOutput.current = true;
    const shouldNameConversation = !hasUserInput(state.messages);
    if (await send(value)) {
      setInput("");
      if (textarea.current) textarea.current.style.height = "auto";
      if (projects && currentProject && state.threadId) {
        try {
          const existingTitle = currentProject.conversations.find(
            (conversation) => conversation.id === state.threadId,
          )?.title;
          const snapshot = await projects.upsertConversation({
            projectId: currentProject.id,
            id: state.threadId,
            title: shouldNameConversation
              ? conversationTitle(value)
              : (existingTitle ??
                conversationTitle(state.messages[0]?.text ?? value)),
          });
          setProjectSnapshot(snapshot);
        } catch (error) {
          setProjectError(errorMessage(error));
        }
      }
    }
  }

  async function createThread() {
    if (!currentProject) return;
    setView("thread");
    if (!hasUserInput(state.messages)) {
      textarea.current?.focus();
      return;
    }
    await newThread();
  }

  async function openProjectFolder() {
    if (!projects || state.isRunning || switchingProject) return;
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      const snapshot = await projects.openFolder();
      setProjectSnapshot(snapshot);
      setView("thread");
      if (snapshot.activeProjectId === projectSnapshot?.activeProjectId) return;
      await connectProject(snapshot);
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function selectConversation(projectId: string, threadId?: string) {
    if (!projects || state.isRunning || switchingProject) return;
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      let snapshot = projectSnapshot;
      if (projectId !== projectSnapshot?.activeProjectId) {
        snapshot = await projects.activate(projectId);
        setProjectSnapshot(snapshot);
      }
      if (!snapshot) return;
      setView("thread");
      await connectProject(snapshot, threadId);
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function confirmDeleteConversation() {
    if (!projects || !pendingDelete || deletingConversation) return;
    const target = pendingDelete;
    const deletingActiveConversation =
      target.projectId === projectSnapshot?.activeProjectId &&
      target.conversation.id === state.threadId;
    setDeletingConversation(true);
    setDeleteError(undefined);

    try {
      if (target.projectId === projectSnapshot?.activeProjectId) {
        await deleteThread(target.conversation.id);
      }
      const snapshot = await projects.deleteConversation({
        projectId: target.projectId,
        id: target.conversation.id,
      });
      setProjectSnapshot(snapshot);
      setPendingDelete(undefined);
      if (deletingActiveConversation) {
        setView("thread");
        await connectProject(snapshot);
      }
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeletingConversation(false);
    }
  }

  async function reconnectRuntime() {
    if (currentProject || !projects) await retry();
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
          onClick={() => void createThread()}
          disabled={
            !currentProject ||
            state.isRunning ||
            state.connection !== "ready" ||
            switchingProject
          }
        >
          <Plus size={15} strokeWidth={2.2} />
          新建任务
        </button>

        <nav className="thread-list" aria-label="项目与任务列表">
          {projects ? (
            <>
              <div className="project-list-heading">
                <p className="section-label">项目</p>
                <button
                  className="icon-button pressable"
                  type="button"
                  title="通过文件夹打开项目"
                  aria-label="通过文件夹打开项目"
                  disabled={state.isRunning || switchingProject}
                  onClick={() => void openProjectFolder()}
                >
                  <FolderPlus size={15} />
                </button>
              </div>
              <div className="project-list-scroll">
                {projectSnapshot?.projects.map((project) => (
                  <ProjectGroup
                    key={project.id}
                    project={project}
                    active={project.id === projectSnapshot.activeProjectId}
                    activeThreadId={state.threadId}
                    disabled={state.isRunning || switchingProject}
                    onSelect={(threadId) =>
                      void selectConversation(project.id, threadId)
                    }
                    onDelete={(conversation) => {
                      setDeleteError(undefined);
                      setPendingDelete({ projectId: project.id, conversation });
                    }}
                  />
                ))}
                {projectSnapshot?.projects.length === 0 && (
                  <div className="thread-placeholder">打开一个文件夹开始</div>
                )}
              </div>
            </>
          ) : (
            <>
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
            </>
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
            <span
              className={`status-dot ${currentProject || !projects ? state.connection : "idle"}`}
            />
            <span>
              {currentProject || !projects
                ? connectionLabel(state.connection)
                : "未打开项目"}
            </span>
            <span className="status-mode">本地</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {view === "settings" && settings ? (
          <SettingsPage
            adapter={settings}
            onRuntimeRestart={reconnectRuntime}
          />
        ) : projects && !currentProject ? (
          <ProjectEmptyState
            error={projectError}
            opening={switchingProject}
            onOpen={() => void openProjectFolder()}
          />
        ) : (
          <>
            <header className="workspace-header">
              <div>
                <h1>{state.messages[0]?.text || "新任务"}</h1>
                <p>
                  {currentProject?.basePath ?? "Agent runtime"} ·{" "}
                  {shortId(state.threadId)}
                </p>
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
      {pendingDelete && (
        <DeleteConversationDialog
          conversation={pendingDelete.conversation}
          deleting={deletingConversation}
          error={deleteError}
          onCancel={() => {
            setPendingDelete(undefined);
            setDeleteError(undefined);
          }}
          onConfirm={() => void confirmDeleteConversation()}
        />
      )}
    </div>
  );
}

export function ProjectGroup({
  project,
  active,
  activeThreadId,
  disabled,
  onSelect,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  disabled: boolean;
  onSelect(threadId?: string): void;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const [expanded, setExpanded] = useState(false);

  function toggleExpanded() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !active) onSelect(project.conversations[0]?.id);
  }

  return (
    <section className="project-group" aria-label={project.name}>
      <button
        type="button"
        className="project-row pressable"
        aria-current={active ? "location" : undefined}
        aria-expanded={expanded}
        disabled={disabled}
        title={project.basePath}
        onClick={toggleExpanded}
      >
        {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span>{project.name}</span>
        <ChevronRight className="project-chevron" size={14} />
      </button>
      {expanded && (
        <div className="project-conversations">
          {project.conversations.map((conversation) => (
            <ProjectConversationItem
              key={conversation.id}
              conversation={conversation}
              active={active && conversation.id === activeThreadId}
              disabled={disabled}
              onSelect={() => onSelect(conversation.id)}
              onDelete={onDelete ? () => onDelete(conversation) : undefined}
            />
          ))}
          {project.conversations.length === 0 && (
            <span className="project-empty-label">暂无任务</span>
          )}
        </div>
      )}
    </section>
  );
}

export function ProjectConversationItem({
  conversation,
  active,
  disabled,
  onSelect,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  disabled: boolean;
  onSelect(): void;
  onDelete?(): void;
}) {
  return (
    <div className={`thread-item ${active ? "active" : ""}`}>
      <button
        type="button"
        className="thread-item-select pressable"
        aria-current={active ? "page" : undefined}
        disabled={disabled}
        title={conversation.title}
        onClick={onSelect}
      >
        <span className="thread-title">{conversation.title}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          className="thread-delete-button pressable"
          disabled={disabled}
          title={`删除“${conversation.title}”`}
          aria-label={`删除任务“${conversation.title}”`}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

export function DeleteConversationDialog({
  conversation,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  conversation: ConversationSummary;
  deleting: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [deleting, onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <section
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <span className="delete-dialog-icon" aria-hidden="true">
          <Trash2 size={18} />
        </span>
        <div className="delete-dialog-copy">
          <h2 id="delete-dialog-title">删除任务？</h2>
          <p id="delete-dialog-description">
            “{conversation.title}”及其对话记录将被永久删除，此操作无法撤销。
          </p>
          {error && <p className="delete-dialog-error">{error}</p>}
        </div>
        <div className="delete-dialog-actions">
          <button
            ref={cancelButton}
            type="button"
            className="dialog-button secondary pressable"
            disabled={deleting}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="dialog-button danger pressable"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting && <LoaderCircle className="spin" size={14} />}
            {deleting ? "正在删除…" : "删除任务"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProjectEmptyState({
  error,
  opening,
  onOpen,
}: {
  error?: string;
  opening: boolean;
  onOpen(): void;
}) {
  return (
    <div className="project-empty-state">
      <span className="project-empty-icon" aria-hidden="true">
        <FolderOpen size={23} />
      </span>
      <h1>打开一个项目</h1>
      <p>
        选择项目文件夹后，任务会按项目整理，运行时也会以该目录为 base 地址。
      </p>
      {error && <p className="project-open-error">{error}</p>}
      <button
        type="button"
        className="project-open-button pressable"
        disabled={opening}
        onClick={onOpen}
      >
        {opening ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <FolderPlus size={15} />
        )}
        {opening ? "正在打开…" : "通过文件夹打开"}
      </button>
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

function conversationTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  return title.length > 56 ? `${title.slice(0, 56)}…` : title || "新任务";
}

export function hasUserInput(
  messages: readonly { role: "user" | "assistant" }[],
): boolean {
  return messages.some((message) => message.role === "user");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
