import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { File, Terminal, X } from "lucide-react";

import { PanelAddMenu, type PanelViewKind } from "./panel-add-menu.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme, type ResolvedTheme } from "./theme.js";
import {
  FileView,
  type WorkspaceAdapter,
} from "./workspace-panel.js";

import "@xterm/xterm/css/xterm.css";

export interface TerminalSessionInfo {
  id: string;
  shell: string;
}

export type TerminalEvent =
  | {
      type: "data";
      sessionId: string;
      data: string;
    }
  | {
      type: "exit";
      sessionId: string;
      exitCode: number;
    };

export interface TerminalAdapter {
  create(request: {
    projectId: string;
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
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MIN_PANEL_HEIGHT = 170;
const MAX_PENDING_OUTPUT = 1_000_000;

export function TerminalPanel({
  adapter,
  workspace,
  projectId,
  projectName = "",
  onClose,
}: {
  adapter: TerminalAdapter;
  workspace?: WorkspaceAdapter;
  projectId: string;
  projectName?: string;
  onClose(): void;
}) {
  const { t } = useI18n();
  const nextTerminalNumber = useRef(1);
  const [tabs, setTabs] = useState<BottomPanelTab[]>(() => [
    createTerminalTab(1, t),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [panelHeight, setPanelHeight] = useState(260);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  function addTab(kind: PanelViewKind) {
    const tab =
      kind === "terminal"
        ? createTerminalTab(++nextTerminalNumber.current, t)
        : createBottomFileTab(t);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId) {
        setActiveTabId(next[Math.min(index, next.length - 1)]?.id ?? "");
      }
      if (next.length === 0) onClose();
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
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.kind === "terminal" ? (
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
            available={workspace ? ["terminal", "file"] : ["terminal"]}
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
          tab.kind === "terminal" ? (
            <TerminalView
              key={tab.id}
              adapter={adapter}
              projectId={projectId}
              hidden={tab.id !== activeTab?.id}
              label={tab.title}
            />
          ) : workspace ? (
            <FileView
              key={tab.id}
              adapter={workspace}
              projectId={projectId}
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
  hidden = false,
  label,
}: {
  adapter: TerminalAdapter;
  projectId: string;
  hidden?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const accessibleLabel = label ?? t("terminal");
  const [session, setSession] = useState<TerminalSessionInfo>();
  const [exitCode, setExitCode] = useState<number>();
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
        if (mounted) setExitCode(event.exitCode);
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
      .create({
        projectId,
        cols: DEFAULT_COLUMNS,
        rows: DEFAULT_ROWS,
      })
      .then((created) => {
        createdSessionId = created.id;
        if (mounted) {
          sessionId.current = created.id;
          setSession(created);
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
  }, [adapter, projectId]);

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
          <TerminalViewport
            adapter={adapter}
            session={session}
            active={!hidden}
            theme={resolvedTheme}
            registerOutputWriter={registerOutputWriter}
          />
          {exitCode !== undefined && (
            <div className="terminal-exited">
              {t("terminalExited", { code: exitCode })}
            </div>
          )}
        </>
      ) : (
        <div className={`terminal-empty ${error ? "error" : ""}`}>
          {error ?? t("startingTerminal")}
        </div>
      )}
    </div>
  );
}

function TerminalViewport({
  adapter,
  session,
  active,
  theme,
  registerOutputWriter,
}: {
  adapter: TerminalAdapter;
  session: TerminalSessionInfo;
  active: boolean;
  theme: ResolvedTheme;
  registerOutputWriter(writer: ((data: string) => void) | undefined): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<XtermTerminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = new XtermTerminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "outline",
      fontFamily:
        '"SFMono-Regular", "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 5_000,
      theme: terminalTheme(theme),
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    const dataSubscription = instance.onData((data) => {
      adapter.write({ sessionId: session.id, data });
    });
    terminal.current = instance;
    fitAddon.current = fit;
    registerOutputWriter((data) => instance.write(data));

    const fitAndResize = () => {
      if (element.offsetWidth === 0 || element.offsetHeight === 0) return;
      fit.fit();
      adapter.resize({
        sessionId: session.id,
        cols: instance.cols,
        rows: instance.rows,
      });
    };
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(element);
    requestAnimationFrame(() => {
      fitAndResize();
      if (active) instance.focus();
    });

    return () => {
      resizeObserver.disconnect();
      registerOutputWriter(undefined);
      dataSubscription.dispose();
      fit.dispose();
      instance.dispose();
      terminal.current = null;
      fitAddon.current = null;
    };
  }, [adapter, registerOutputWriter, session.id]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = terminalTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!active || !terminal.current || !fitAddon.current) return;
    requestAnimationFrame(() => {
      fitAddon.current?.fit();
      const instance = terminal.current;
      if (!instance) return;
      adapter.resize({
        sessionId: session.id,
        cols: instance.cols,
        rows: instance.rows,
      });
      instance.focus();
    });
  }, [active, adapter, session.id]);

  return <div ref={container} className="terminal-viewport" />;
}

function terminalTheme(theme: ResolvedTheme) {
  if (theme === "dark") {
    return {
      background: "#1f2022",
      foreground: "#dededa",
      cursor: "#aaa9a4",
      cursorAccent: "#1f2022",
      selectionBackground: "#41444a",
      black: "#17181a",
      red: "#e2746d",
      green: "#72ab84",
      yellow: "#c39a5b",
      blue: "#69a4c1",
      magenta: "#b38abe",
      cyan: "#65aaa8",
      white: "#d5d5d0",
      brightBlack: "#858581",
      brightRed: "#ef8d86",
      brightGreen: "#8ac49a",
      brightYellow: "#d6ad6b",
      brightBlue: "#82b8d1",
      brightMagenta: "#c59bcf",
      brightCyan: "#7dbfbd",
      brightWhite: "#f2f2ef",
    };
  }
  return {
    background: "#fbfbfa",
    foreground: "#383832",
    cursor: "#65655f",
    cursorAccent: "#fbfbfa",
    selectionBackground: "#dfe6ea",
    black: "#242420",
    red: "#b84a42",
    green: "#47765a",
    yellow: "#9a6a32",
    blue: "#3d7290",
    magenta: "#815f8b",
    cyan: "#3d7d7c",
    white: "#d9d8d2",
    brightBlack: "#77766f",
    brightRed: "#d0645b",
    brightGreen: "#5f9270",
    brightYellow: "#b5864a",
    brightBlue: "#5c8faa",
    brightMagenta: "#9873a3",
    brightCyan: "#5c9998",
    brightWhite: "#f7f6f2",
  };
}

function createTerminalTab(number: number, t: Translate): BottomPanelTab {
  return {
    id: crypto.randomUUID(),
    kind: "terminal",
    title: t("terminalNumber", { number }),
  };
}

function createBottomFileTab(t: Translate): BottomPanelTab {
  return {
    id: crypto.randomUUID(),
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
