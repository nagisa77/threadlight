import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createBrowserUuid } from "@threadlight/client";
import type {
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalWorkspaceScope,
} from "@threadlight/protocol";
import { File, Terminal, X } from "lucide-react";

import { PanelAddMenu, type PanelViewKind } from "./panel-add-menu.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme } from "./theme.js";
import {
  terminalTabLabel,
  terminalWorkspaceContextLabel,
} from "./terminal-context.js";
import {
  FileView,
  type WorkspaceAdapter,
} from "./workspace-panel.js";

const LazyTerminalViewport = lazy(() =>
  import("./terminal-viewport.js").then(({ TerminalViewport }) => ({
    default: TerminalViewport,
  })),
);

export type TerminalEvent = TerminalSessionEvent;
export type { TerminalSessionInfo };

export interface TerminalAdapter {
  create(request: {
    projectId: string;
    threadId?: string;
    workspace?: TerminalWorkspaceScope;
    cols: number;
    rows: number;
  }): Promise<TerminalSessionInfo>;
  write(request: { sessionId: string; data: string }): void;
  resize(request: {
    sessionId: string;
    cols: number;
    rows: number;
  }): void;
  close(sessionId: string): Promise<void>;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
}

interface BottomPanelTab {
  id: string;
  kind: PanelViewKind;
  title: string;
  path?: string;
  branch?: string;
  terminalNumber?: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MIN_PANEL_HEIGHT = 170;
const MAX_PENDING_OUTPUT = 1_000_000;

export function TerminalPanel({
  adapter,
  workspace,
  projectId,
  threadId,
  projectName = "",
  taskBranch,
  originalBranch,
  defaultWorkspace = "task",
  taskWorkspaceAvailable = true,
  onClose,
}: {
  adapter: TerminalAdapter;
  workspace?: WorkspaceAdapter;
  projectId: string;
  threadId?: string;
  projectName?: string;
  taskBranch?: string;
  originalBranch?: string;
  defaultWorkspace?: TerminalWorkspaceScope;
  taskWorkspaceAvailable?: boolean;
  onClose(): void;
}) {
  const { t } = useI18n();
  const nextTerminalNumber = useRef(1);
  const [tabs, setTabs] = useState<BottomPanelTab[]>(() => [
    createTerminalTab(
      1,
      defaultWorkspace,
      defaultWorkspace === "original" ? originalBranch : taskBranch,
      t,
    ),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [panelHeight, setPanelHeight] = useState(260);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  function addTab(kind: PanelViewKind) {
    const tab =
      isTerminalKind(kind)
        ? createTerminalTab(
            ++nextTerminalNumber.current,
            kind === "original-terminal" ? "original" : "task",
            kind === "original-terminal" ? originalBranch : taskBranch,
            t,
          )
        : createBottomFileTab(t);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const { tabs: next, activeTabId: nextActive, panelClosed } =
        nextTabsAfterClose(current, activeTabId, id);
      if (nextActive !== activeTabId) setActiveTabId(nextActive);
      if (panelClosed) onClose();
      return next;
    });
  }

  function selectFile(tabId: string, path: string) {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === tabId ? { ...tab, path, title: fileName(path) } : tab,
      ),
    );
  }

  function updateTerminalContext(
    tabId: string,
    workspace: TerminalWorkspaceScope,
    session: TerminalSessionInfo,
  ) {
    const branch =
      session.branch ?? (workspace === "original" ? originalBranch : taskBranch);
    setTabs((current) =>
      current.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              branch,
              title: terminalTabLabel(
                workspace,
                branch,
                tab.terminalNumber,
                t,
              ),
            }
          : tab,
      ),
    );
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;
    const maxHeight = Math.max(
      MIN_PANEL_HEIGHT,
      Math.floor(window.innerHeight * 0.65),
    );
    const handleMove = (moveEvent: PointerEvent) => {
      setPanelHeight(
        Math.min(
          maxHeight,
          Math.max(MIN_PANEL_HEIGHT, startHeight + startY - moveEvent.clientY),
        ),
      );
    };
    const handleEnd = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      document.body.classList.remove("is-resizing-terminal");
    };
    document.body.classList.add("is-resizing-terminal");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
  }

  return (
    <section
      className="terminal-panel panel-container"
      style={{ height: panelHeight }}
      aria-label={t("bottomPanel")}
    >
      <div
        className="terminal-resize-handle"
        aria-hidden="true"
        onPointerDown={startResize}
      />
      <div className="terminal-toolbar">
        <div className="terminal-tabs" role="tablist" aria-label={t("panelTabs")}>
          <div className="terminal-tab-strip">
            {tabs.map((tab) => (
              <div
                className={`terminal-tab ${tab.id === activeTab?.id ? "active" : ""}`}
                key={tab.id}
              >
                <button
                  type="button"
                  className="terminal-tab-select pressable"
                  role="tab"
                  aria-selected={tab.id === activeTab?.id}
                  title={tab.title}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {isTerminalKind(tab.kind) ? (
                    <Terminal size={14} aria-hidden="true" />
                  ) : (
                    <File size={14} aria-hidden="true" />
                  )}
                  <span>{tab.title}</span>
                </button>
                <button
                  type="button"
                  className="terminal-tab-close pressable"
                  aria-label={t("closeTab", { title: tab.title })}
                  title={t("closeTab", { title: tab.title })}
                  onClick={() => closeTab(tab.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <PanelAddMenu
            available={
              workspace
                ? [
                    ...(taskWorkspaceAvailable ? (["terminal"] as const) : []),
                    "original-terminal",
                    "file",
                  ]
                : [
                    ...(taskWorkspaceAvailable ? (["terminal"] as const) : []),
                    "original-terminal",
                  ]
            }
            taskTerminalLabel={terminalWorkspaceContextLabel(
              "task",
              taskBranch,
              t,
            )}
            originalTerminalLabel={terminalWorkspaceContextLabel(
              "original",
              originalBranch,
              t,
            )}
            onSelect={addTab}
          />
        </div>
        <button
          type="button"
          className="terminal-panel-close pressable"
          aria-label={t("closePanel")}
          title={t("closePanel")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="panel-container-stage">
        {tabs.map((tab) =>
          isTerminalKind(tab.kind) ? (
            <TerminalView
              key={tab.id}
              adapter={adapter}
              projectId={projectId}
              threadId={threadId}
              workspace={
                tab.kind === "original-terminal" ? "original" : "task"
              }
              hidden={tab.id !== activeTab?.id}
              label={tab.title}
              onSessionChange={(session) =>
                updateTerminalContext(
                  tab.id,
                  tab.kind === "original-terminal" ? "original" : "task",
                  session,
                )
              }
              onExit={() => closeTab(tab.id)}
            />
          ) : workspace ? (
            <FileView
              key={tab.id}
              adapter={workspace}
              projectId={projectId}
              threadId={threadId}
              projectName={projectName}
              path={tab.path}
              hidden={tab.id !== activeTab?.id}
              onSelectFile={(path) => selectFile(tab.id, path)}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

export function TerminalView({
  adapter,
  projectId,
  threadId,
  workspace = "task",
  hidden = false,
  label,
  onSessionChange,
  onExit,
}: {
  adapter: TerminalAdapter;
  projectId: string;
  threadId?: string;
  workspace?: TerminalWorkspaceScope;
  hidden?: boolean;
  label?: string;
  onSessionChange?(session: TerminalSessionInfo): void;
  onExit?(exitCode: number): void;
}) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const accessibleLabel = label ?? t("terminal");
  const [session, setSession] = useState<TerminalSessionInfo>();
  const [error, setError] = useState<string>();
  const sessionId = useRef<string | null>(null);
  const outputWriter = useRef<((data: string) => void) | null>(null);
  const pendingOutput = useRef("");

  useEffect(() => {
    let mounted = true;
    let createdSessionId: string | undefined;
    const unsubscribe = adapter.subscribe((event) => {
      if (event.sessionId !== sessionId.current) return;
      if (event.type === "exit") {
        if (mounted) onExit?.(event.exitCode);
        return;
      }
      if (outputWriter.current) outputWriter.current(event.data);
      else {
        pendingOutput.current = `${pendingOutput.current}${event.data}`.slice(
          -MAX_PENDING_OUTPUT,
        );
      }
    });
    void adapter
      .create(projectTerminalCreateRequest(projectId, threadId, workspace))
      .then((created) => {
        createdSessionId = created.id;
        if (mounted) {
          sessionId.current = created.id;
          setSession(created);
          onSessionChange?.(created);
        } else {
          void adapter.close(created.id);
        }
      })
      .catch((cause) => {
        if (mounted) setError(errorMessage(cause));
      });

    return () => {
      mounted = false;
      unsubscribe();
      if (sessionId.current === createdSessionId) sessionId.current = null;
      if (createdSessionId) void adapter.close(createdSessionId);
    };
  }, [adapter, projectId, threadId, workspace]);

  const registerOutputWriter = useCallback(
    (writer: ((data: string) => void) | undefined) => {
      outputWriter.current = writer ?? null;
      if (writer && pendingOutput.current) {
        const buffered = pendingOutput.current;
        pendingOutput.current = "";
        writer(buffered);
      }
    },
    [],
  );

  return (
    <div
      className="terminal-view"
      role="tabpanel"
      aria-label={accessibleLabel}
      hidden={hidden}
    >
      {session ? (
        <>
          <Suspense
            fallback={
              <div className="terminal-empty" role="status">
                {t("startingTerminal")}
              </div>
            }
          >
            <LazyTerminalViewport
              adapter={adapter}
              session={session}
              active={!hidden}
              theme={resolvedTheme}
              registerOutputWriter={registerOutputWriter}
            />
          </Suspense>
          <div className="terminal-session-context">
            <span
              className="terminal-session-context-item cwd"
              title={session.cwd}
            >
              <span>{t("terminalCwd")}</span>
              <code>{session.cwd ?? "—"}</code>
            </span>
            <span
              className="terminal-session-context-item branch"
              title={session.branch}
            >
              <span>{t("terminalBranch")}</span>
              <code>{session.branch ?? "—"}</code>
            </span>
          </div>
        </>
      ) : (
        <div className={`terminal-empty ${error ? "error" : ""}`}>
          {error ?? t("startingTerminal")}
        </div>
      )}
    </div>
  );
}

export function projectTerminalCreateRequest(
  projectId: string,
  threadId?: string,
  workspace: TerminalWorkspaceScope = "task",
): Parameters<TerminalAdapter["create"]>[0] {
  return {
    projectId,
    ...(workspace === "task" && threadId ? { threadId } : {}),
    workspace,
    cols: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
  };
}

export function nextTabsAfterClose(
  tabs: BottomPanelTab[],
  activeTabId: string,
  closeId: string,
): { tabs: BottomPanelTab[]; activeTabId: string; panelClosed: boolean } {
  const index = tabs.findIndex((tab) => tab.id === closeId);
  const next = tabs.filter((tab) => tab.id !== closeId);
  const nextActiveId =
    closeId === activeTabId
      ? (next[Math.min(index, next.length - 1)]?.id ?? "")
      : activeTabId;
  return {
    tabs: next,
    activeTabId: nextActiveId,
    panelClosed: next.length === 0,
  };
}

function createTerminalTab(
  number: number,
  workspace: TerminalWorkspaceScope,
  branch: string | undefined,
  t: Translate,
): BottomPanelTab {
  return {
    id: createBrowserUuid(),
    kind: workspace === "original" ? "original-terminal" : "terminal",
    title: terminalTabLabel(workspace, branch, number, t),
    branch,
    terminalNumber: number,
  };
}

function isTerminalKind(kind: PanelViewKind): boolean {
  return kind === "terminal" || kind === "original-terminal";
}

function createBottomFileTab(t: Translate): BottomPanelTab {
  return {
    id: createBrowserUuid(),
    kind: "file",
    title: t("openFile"),
  };
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
