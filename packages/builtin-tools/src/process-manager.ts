import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_MAX_SESSIONS = 100;

export type ManagedProcessStatus =
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "terminated";

export interface ManagedProcessSnapshot {
  sessionId: string;
  command: string;
  cwd: string;
  status: ManagedProcessStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface StartManagedProcessOptions {
  cwd: string;
  shell?: string;
  environment: NodeJS.ProcessEnv;
  maxOutputChars?: number;
}

export interface ProcessManagerOptions {
  maxSessions?: number;
  createSessionId?: () => string;
  now?: () => Date;
}

interface ManagedProcessSession {
  child: ChildProcess;
  snapshot: ManagedProcessSnapshot;
  remainingOutputChars: number;
  terminationRequested: boolean;
  settled: boolean;
  completed: Promise<void>;
  resolveCompleted(): void;
}

export class ProcessManager {
  private readonly sessions = new Map<string, ManagedProcessSession>();
  private readonly maxSessions: number;
  private readonly createSessionId: () => string;
  private readonly now: () => Date;

  constructor(options: ProcessManagerOptions = {}) {
    this.maxSessions = positiveInteger(
      options.maxSessions ?? DEFAULT_MAX_SESSIONS,
      "maxSessions",
    );
    this.createSessionId = options.createSessionId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  start(command: string, options: StartManagedProcessOptions): string {
    this.pruneCompletedSessions();
    const sessionId = this.createSessionId();
    if (this.sessions.has(sessionId)) {
      throw new Error(`Duplicate process session: ${sessionId}`);
    }

    const invocation = shellInvocation(command, options.shell);
    const child = spawn(invocation.file, invocation.arguments, {
      cwd: options.cwd,
      env: options.environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let resolveCompleted!: () => void;
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    const session: ManagedProcessSession = {
      child,
      snapshot: {
        sessionId,
        command,
        cwd: options.cwd,
        status: "running",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        truncated: false,
        startedAt: this.now().toISOString(),
      },
      remainingOutputChars: positiveInteger(
        options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
        "maxOutputChars",
      ),
      terminationRequested: false,
      settled: false,
      completed,
      resolveCompleted,
    };
    this.sessions.set(sessionId, session);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) =>
      this.capture(session, "stdout", chunk),
    );
    child.stderr?.on("data", (chunk: string) =>
      this.capture(session, "stderr", chunk),
    );
    child.once("error", (error) => {
      this.capture(session, "stderr", `${error.message}\n`);
      if (child.pid === undefined) this.finish(session, null, null, true);
    });
    child.once("close", (exitCode, signal) => {
      this.terminateRemainingProcessGroup(child.pid);
      this.finish(session, exitCode, signal, false);
    });

    return sessionId;
  }

  status(sessionId: string): ManagedProcessSnapshot {
    return this.snapshot(this.requireSession(sessionId));
  }

  read(sessionId: string): ManagedProcessSnapshot {
    return this.status(sessionId);
  }

  async wait(
    sessionId: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<ManagedProcessSnapshot> {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "running") return this.snapshot(session);
    await waitForCompletion(session.completed, timeoutMs, signal);
    return this.snapshot(session);
  }

  async kill(sessionId: string): Promise<ManagedProcessSnapshot> {
    const session = this.requireSession(sessionId);
    if (session.snapshot.status !== "running") return this.snapshot(session);

    session.terminationRequested = true;
    terminateProcess(session.child, "SIGTERM");
    await waitForCompletion(session.completed, 1_000);
    if (session.snapshot.status === "running") {
      terminateProcess(session.child, "SIGKILL");
      await waitForCompletion(session.completed, 2_000);
    }
    if (session.snapshot.status === "running") {
      throw new Error(`Could not terminate process session: ${sessionId}`);
    }
    return this.snapshot(session);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((session) => session.snapshot.status === "running")
        .map((session) => this.kill(session.snapshot.sessionId)),
    );
  }

  private capture(
    session: ManagedProcessSession,
    target: "stdout" | "stderr",
    chunk: string,
  ): void {
    if (session.remainingOutputChars === 0) {
      session.snapshot.truncated = true;
      return;
    }

    const captured = chunk.slice(0, session.remainingOutputChars);
    session.remainingOutputChars -= captured.length;
    session.snapshot.truncated ||= captured.length < chunk.length;
    session.snapshot[target] += captured;
  }

  private finish(
    session: ManagedProcessSession,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    spawnFailed: boolean,
  ): void {
    if (session.settled) return;
    session.settled = true;
    session.snapshot.exitCode = exitCode;
    session.snapshot.signal = signal;
    session.snapshot.status = session.terminationRequested
      ? "terminated"
      : spawnFailed || exitCode !== 0
        ? "failed"
        : session.snapshot.stderr.trim()
          ? "completed_with_warnings"
          : "completed";
    session.snapshot.completedAt = this.now().toISOString();
    session.resolveCompleted();
  }

  private requireSession(sessionId: string): ManagedProcessSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown process session: ${sessionId}`);
    return session;
  }

  private snapshot(session: ManagedProcessSession): ManagedProcessSnapshot {
    return structuredClone(session.snapshot);
  }

  private pruneCompletedSessions(): void {
    if (this.sessions.size < this.maxSessions) return;
    for (const [sessionId, session] of this.sessions) {
      if (session.snapshot.status === "running") continue;
      this.sessions.delete(sessionId);
      if (this.sessions.size < this.maxSessions) return;
    }
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Too many running process sessions (${this.maxSessions})`);
    }
  }

  private terminateRemainingProcessGroup(pid: number | undefined): void {
    if (pid === undefined || process.platform === "win32") return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group normally no longer exists. Any remaining descendants
      // are killed so shell background operators cannot escape the manager.
    }
  }
}

async function waitForCompletion(
  completed: Promise<void>,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (timeoutMs === undefined && !signal) {
    await completed;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const abort = (): void =>
      finish(signal?.reason ?? new Error("Process wait aborted"));

    void completed.then(() => finish());
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => finish(), positiveInteger(timeoutMs, "timeoutMs"));
      timeout.unref();
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function shellInvocation(
  command: string,
  configuredShell: string | undefined,
): { file: string; arguments: string[] } {
  if (process.platform === "win32") {
    return {
      file: configuredShell ?? process.env.ComSpec ?? "cmd.exe",
      arguments: ["/d", "/s", "/c", command],
    };
  }

  return {
    file: configuredShell ?? "/bin/sh",
    arguments: ["-c", command],
  };
}

function terminateProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may have exited between the status check and the signal.
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
