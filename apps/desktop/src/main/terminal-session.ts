import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { spawn, type IPty } from "node-pty";

export interface TerminalSessionInfo {
  id: string;
  shell: string;
}

export type TerminalSessionEvent =
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

export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(
    listener: (event: { exitCode: number }) => void,
  ): { dispose(): void };
}

interface TerminalSession {
  process: TerminalProcess;
  disposeData(): void;
  disposeExit(): void;
}

export interface TerminalSessionManagerOptions {
  createId?(): string;
  environment?: NodeJS.ProcessEnv;
  shell?: string;
  spawnProcess?(
    shell: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ): TerminalProcess;
}

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 1_000;
const MIN_ROWS = 1;
const MAX_ROWS = 500;
const MAX_INPUT_LENGTH = 128 * 1024;

export class TerminalSessionManager {
  readonly #sessions = new Map<string, TerminalSession>();
  readonly #createId: () => string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #shell: string;
  readonly #spawnProcess: NonNullable<
    TerminalSessionManagerOptions["spawnProcess"]
  >;
  readonly #send: (event: TerminalSessionEvent) => void;

  constructor(
    send: (event: TerminalSessionEvent) => void,
    options: TerminalSessionManagerOptions = {},
  ) {
    this.#send = send;
    this.#createId = options.createId ?? randomUUID;
    this.#environment = options.environment ?? process.env;
    this.#shell =
      options.shell ??
      process.env.SHELL ??
      (process.platform === "win32"
        ? (process.env.ComSpec ?? "powershell.exe")
        : "/bin/sh");
    this.#spawnProcess =
      options.spawnProcess ??
      ((shell, args, spawnOptions) =>
        spawn(shell, args, spawnOptions) as IPty);
  }

  create(cwd: string, cols: number, rows: number): TerminalSessionInfo {
    const dimensions = validateDimensions(cols, rows);
    const id = this.#createId();
    const shell = this.#shell;
    const terminalProcess = this.#spawnProcess(
      shell,
      process.platform === "win32" ? [] : ["-l"],
      {
        name: "xterm-256color",
        cwd,
        cols: dimensions.cols,
        rows: dimensions.rows,
        env: {
          ...this.#environment,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
      },
    );
    const dataSubscription = terminalProcess.onData((data) => {
      if (!this.#sessions.has(id)) return;
      this.#send({ type: "data", sessionId: id, data });
    });
    const exitSubscription = terminalProcess.onExit(({ exitCode }) => {
      const session = this.#sessions.get(id);
      if (!session) return;
      session.disposeData();
      session.disposeExit();
      this.#sessions.delete(id);
      this.#send({ type: "exit", sessionId: id, exitCode });
    });
    this.#sessions.set(id, {
      process: terminalProcess,
      disposeData: () => dataSubscription.dispose(),
      disposeExit: () => exitSubscription.dispose(),
    });
    return { id, shell: basename(shell) };
  }

  write(sessionId: string, data: string): void {
    if (typeof data !== "string" || data.length > MAX_INPUT_LENGTH) {
      throw new Error("Invalid terminal input");
    }
    this.#requireSession(sessionId).process.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const dimensions = validateDimensions(cols, rows);
    this.#requireSession(sessionId).process.resize(
      dimensions.cols,
      dimensions.rows,
    );
  }

  close(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    session.disposeData();
    session.disposeExit();
    session.process.kill();
  }

  dispose(): void {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }

  #requireSession(sessionId: string): TerminalSession {
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid terminal session id");
    }
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Unknown terminal session: ${sessionId}`);
    return session;
  }
}

function validateDimensions(
  cols: number,
  rows: number,
): { cols: number; rows: number } {
  if (
    !Number.isInteger(cols) ||
    cols < MIN_COLUMNS ||
    cols > MAX_COLUMNS ||
    !Number.isInteger(rows) ||
    rows < MIN_ROWS ||
    rows > MAX_ROWS
  ) {
    throw new Error("Invalid terminal dimensions");
  }
  return { cols, rows };
}
