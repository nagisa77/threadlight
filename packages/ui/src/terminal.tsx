import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { Plus, Terminal as TerminalIcon, X } from "lucide-react";

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

interface VisibleTerminalSession extends TerminalSessionInfo {
  number: number;
  exitCode?: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MIN_PANEL_HEIGHT = 170;
const MAX_PENDING_OUTPUT = 1_000_000;

export function TerminalPanel({
  adapter,
  projectId,
  onClose,
}: {
  adapter: TerminalAdapter;
  projectId: string;
  onClose(): void;
}) {
  const [sessions, setSessions] = useState<VisibleTerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [panelHeight, setPanelHeight] = useState(260);
  const sessionNumber = useRef(0);
  const sessionIds = useRef<string[]>([]);
  const outputWriters = useRef(new Map<string, (data: string) => void>());
  const pendingOutput = useRef(new Map<string, string>());
  const createTerminalRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    sessionIds.current = sessions.map((session) => session.id);
  }, [sessions]);

  useEffect(() => {
    const unsubscribe = adapter.subscribe((event) => {
      if (event.type === "exit") {
        setSessions((current) =>
          current.map((session) =>
            session.id === event.sessionId
              ? { ...session, exitCode: event.exitCode }
              : session,
          ),
        );
        return;
      }
      const writer = outputWriters.current.get(event.sessionId);
      if (writer) {
        writer(event.data);
        return;
      }
      const buffered =
        (pendingOutput.current.get(event.sessionId) ?? "") + event.data;
      pendingOutput.current.set(
        event.sessionId,
        buffered.slice(-MAX_PENDING_OUTPUT),
      );
    });
    return unsubscribe;
  }, [adapter]);

  const createTerminal = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(undefined);
    try {
      const session = await adapter.create({
        projectId,
        cols: DEFAULT_COLUMNS,
        rows: DEFAULT_ROWS,
      });
      const number = ++sessionNumber.current;
      setSessions((current) => [...current, { ...session, number }]);
      setActiveSessionId(session.id);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }, [adapter, creating, projectId]);

  useEffect(() => {
    createTerminalRef.current = createTerminal;
  }, [createTerminal]);

  useEffect(() => {
    void createTerminalRef.current();
  }, []);

  useEffect(
    () => () => {
      for (const id of sessionIds.current) void adapter.close(id);
    },
    [adapter],
  );

  const registerOutputWriter = useCallback(
    (
      sessionId: string,
      writer: ((data: string) => void) | undefined,
    ) => {
      if (!writer) {
        outputWriters.current.delete(sessionId);
        return;
      }
      outputWriters.current.set(sessionId, writer);
      const buffered = pendingOutput.current.get(sessionId);
      if (buffered) {
        pendingOutput.current.delete(sessionId);
        writer(buffered);
      }
    },
    [],
  );

  async function closeSession(sessionId: string) {
    outputWriters.current.delete(sessionId);
    pendingOutput.current.delete(sessionId);
    await adapter.close(sessionId);
    setSessions((current) => {
      const index = current.findIndex((session) => session.id === sessionId);
      const next = current.filter((session) => session.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(
          next[Math.min(index, Math.max(0, next.length - 1))]?.id,
        );
      }
      if (next.length === 0) onClose();
      return next;
    });
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
      className="terminal-panel"
      style={{ height: panelHeight }}
      aria-label="终端面板"
    >
      <div
        className="terminal-resize-handle"
        aria-hidden="true"
        onPointerDown={startResize}
      />
      <div className="terminal-toolbar">
        <div className="terminal-tabs" role="tablist" aria-label="终端">
          {sessions.map((session) => (
            <div
              className={`terminal-tab ${session.id === activeSessionId ? "active" : ""}`}
              key={session.id}
            >
              <button
                type="button"
                className="terminal-tab-select pressable"
                role="tab"
                aria-selected={session.id === activeSessionId}
                onClick={() => setActiveSessionId(session.id)}
              >
                <TerminalIcon size={13} aria-hidden="true" />
                <span>
                  {session.shell} {session.number}
                </span>
                {session.exitCode !== undefined && (
                  <span className="terminal-exit-code">
                    已退出 {session.exitCode}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="terminal-tab-close pressable"
                aria-label={`关闭 ${session.shell} ${session.number}`}
                title="关闭终端"
                onClick={() => void closeSession(session.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="terminal-new-button pressable"
            aria-label="新建终端"
            title="新建终端"
            disabled={creating}
            onClick={() => void createTerminal()}
          >
            <Plus size={15} />
          </button>
        </div>
        <button
          type="button"
          className="terminal-panel-close pressable"
          aria-label="关闭终端面板"
          title="关闭终端面板"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="terminal-stage">
        {sessions.map((session) => (
          <TerminalViewport
            key={session.id}
            adapter={adapter}
            session={session}
            active={session.id === activeSessionId}
            registerOutputWriter={registerOutputWriter}
          />
        ))}
        {sessions.length === 0 && (
          <div className={`terminal-empty ${error ? "error" : ""}`}>
            {error ?? "正在启动终端…"}
          </div>
        )}
      </div>
    </section>
  );
}

function TerminalViewport({
  adapter,
  session,
  active,
  registerOutputWriter,
}: {
  adapter: TerminalAdapter;
  session: VisibleTerminalSession;
  active: boolean;
  registerOutputWriter(
    sessionId: string,
    writer: ((data: string) => void) | undefined,
  ): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<XtermTerminal | undefined>(undefined);
  const fitAddon = useRef<FitAddon | undefined>(undefined);

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
      theme: {
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
      },
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    const dataSubscription = instance.onData((data) => {
      adapter.write({ sessionId: session.id, data });
    });
    terminal.current = instance;
    fitAddon.current = fit;
    registerOutputWriter(session.id, (data) => instance.write(data));

    const resizeObserver = new ResizeObserver(() => {
      if (element.offsetWidth === 0 || element.offsetHeight === 0) return;
      fit.fit();
      adapter.resize({
        sessionId: session.id,
        cols: instance.cols,
        rows: instance.rows,
      });
    });
    resizeObserver.observe(element);

    requestAnimationFrame(() => {
      fit.fit();
      adapter.resize({
        sessionId: session.id,
        cols: instance.cols,
        rows: instance.rows,
      });
      if (active) instance.focus();
    });

    return () => {
      resizeObserver.disconnect();
      registerOutputWriter(session.id, undefined);
      dataSubscription.dispose();
      fit.dispose();
      instance.dispose();
      terminal.current = undefined;
      fitAddon.current = undefined;
    };
  }, [adapter, registerOutputWriter, session.id]);

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

  return (
    <div
      ref={container}
      className="terminal-viewport"
      role="tabpanel"
      aria-label={`${session.shell} ${session.number}`}
      hidden={!active}
    />
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
