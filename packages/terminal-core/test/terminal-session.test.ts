import { describe, expect, it, vi } from "vitest";

import {
  TerminalSessionManager,
  type TerminalProcess,
  type TerminalSessionEvent,
} from "../src/index.js";

class ScriptedTerminalProcess implements TerminalProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  #dataListener?: (data: string) => void;
  #exitListener?: (event: { exitCode: number }) => void;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.#dataListener = listener;
    return {
      dispose: () => {
        this.#dataListener = undefined;
      },
    };
  }

  onExit(
    listener: (event: { exitCode: number }) => void,
  ): { dispose(): void } {
    this.#exitListener = listener;
    return {
      dispose: () => {
        this.#exitListener = undefined;
      },
    };
  }

  emitData(data: string): void {
    this.#dataListener?.(data);
  }

  emitExit(exitCode: number): void {
    this.#exitListener?.({ exitCode });
  }
}

describe("TerminalSessionManager", () => {
  it("runs an interactive shell in the project and preserves terminal data", () => {
    const events: TerminalSessionEvent[] = [];
    const process = new ScriptedTerminalProcess();
    const spawnProcess = vi.fn(() => process);
    const manager = new TerminalSessionManager(
      (event) => events.push(event),
      {
        createId: () => "terminal-1",
        environment: { PATH: "/usr/bin" },
        shell: "/bin/zsh",
        spawnProcess,
      },
    );

    expect(manager.create("/workspace/threadlight", 100, 30)).toEqual({
      id: "terminal-1",
      shell: "zsh",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-l"],
      expect.objectContaining({
        cwd: "/workspace/threadlight",
        cols: 100,
        rows: 30,
        env: expect.objectContaining({
          PATH: "/usr/bin",
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        }),
      }),
    );

    manager.write("terminal-1", "npm test\r");
    manager.resize("terminal-1", 120, 36);
    process.emitData("\u001b[32mready\u001b[0m\r\n");

    expect(process.writes).toEqual(["npm test\r"]);
    expect(process.resizes).toEqual([{ cols: 120, rows: 36 }]);
    expect(events).toEqual([
      {
        type: "data",
        sessionId: "terminal-1",
        data: "\u001b[32mready\u001b[0m\r\n",
      },
    ]);
  });

  it("reports natural exits and rejects further input", () => {
    const events: TerminalSessionEvent[] = [];
    const process = new ScriptedTerminalProcess();
    const manager = new TerminalSessionManager(
      (event) => events.push(event),
      {
        createId: () => "terminal-1",
        shell: "/bin/zsh",
        spawnProcess: () => process,
      },
    );
    manager.create("/workspace/threadlight", 80, 24);

    process.emitExit(7);

    expect(events).toEqual([
      { type: "exit", sessionId: "terminal-1", exitCode: 7 },
    ]);
    expect(() => manager.write("terminal-1", "pwd\r")).toThrow(
      "Unknown terminal session",
    );
  });

  it("closes every live terminal on disposal", () => {
    const processes = [
      new ScriptedTerminalProcess(),
      new ScriptedTerminalProcess(),
    ];
    const pendingProcesses = [...processes];
    const ids = ["terminal-1", "terminal-2"];
    const manager = new TerminalSessionManager(vi.fn(), {
      createId: () => ids.shift() ?? "unexpected",
      shell: "/bin/zsh",
      spawnProcess: () =>
        pendingProcesses.shift() ?? new ScriptedTerminalProcess(),
    });
    manager.create("/workspace/threadlight", 80, 24);
    manager.create("/workspace/threadlight", 80, 24);

    manager.dispose();

    expect(processes.every((process) => process.killed)).toBe(true);
  });

  it("enforces a bounded session count", () => {
    const manager = new TerminalSessionManager(vi.fn(), {
      createId: () => "terminal-1",
      shell: "/bin/zsh",
      maxSessions: 1,
      spawnProcess: () => new ScriptedTerminalProcess(),
    });
    manager.create("/workspace/threadlight", 80, 24);

    expect(() =>
      manager.create("/workspace/threadlight", 80, 24),
    ).toThrow("session limit");
  });
});
