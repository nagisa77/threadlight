import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalSessionInfo } from "@threadlight/protocol";

import type { ResolvedTheme } from "./theme.js";
import type { TerminalAdapter } from "./terminal.js";

import "@xterm/xterm/css/xterm.css";

export function TerminalViewport({
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
    brightWhite: "#f7f7f8",
  };
}
