import { spawn, type ChildProcess } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { defineTool, type Tool } from "@threadlight/agent-loop";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

export interface ExecCommandToolOptions {
  workspaceRoot?: string;
  allowOutsideWorkspace?: boolean;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputChars?: number;
  shell?: string;
  environment?: NodeJS.ProcessEnv;
  needsApproval?: Tool["needsApproval"];
}

export interface ExecCommandResult {
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

interface ExecCommandArguments {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

export function createExecCommandTool(
  options: ExecCommandToolOptions = {},
): Tool {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const defaultTimeoutMs = positiveInteger(
    options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    "defaultTimeoutMs",
  );
  const maxTimeoutMs = positiveInteger(
    options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
    "maxTimeoutMs",
  );
  const maxOutputChars = positiveInteger(
    options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
    "maxOutputChars",
  );

  if (defaultTimeoutMs > maxTimeoutMs) {
    throw new Error("defaultTimeoutMs cannot exceed maxTimeoutMs");
  }

  return defineTool({
    name: "exec_command",
    description:
      "Execute a shell command in the configured workspace and return its exit status, stdout, and stderr.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          minLength: 1,
          description: "The shell command to execute.",
        },
        cwd: {
          type: ["string", "null"],
          description:
            "Optional working directory, relative to the configured workspace root.",
        },
        timeout_ms: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: maxTimeoutMs,
          description: "Optional command timeout in milliseconds.",
        },
      },
      required: ["command", "cwd", "timeout_ms"],
      additionalProperties: false,
    },
    needsApproval: options.needsApproval ?? true,
    async execute(arguments_, context) {
      const parsed = parseArguments(arguments_, defaultTimeoutMs, maxTimeoutMs);
      const cwd = await resolveWorkingDirectory(
        workspaceRoot,
        parsed.cwd,
        options.allowOutsideWorkspace ?? false,
      );

      return runCommand(parsed.command, cwd, parsed.timeout_ms, context.signal, {
        shell: options.shell,
        environment: options.environment ?? safeEnvironment(),
        maxOutputChars,
      });
    },
  });
}

function parseArguments(
  value: unknown,
  defaultTimeoutMs: number,
  maxTimeoutMs: number,
): Required<Pick<ExecCommandArguments, "command" | "timeout_ms">> &
  Pick<ExecCommandArguments, "cwd"> {
  if (!isObject(value)) throw new Error("arguments must be an object");

  const command = value.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("command must be a non-empty string");
  }

  const cwd = value.cwd;
  if (
    cwd !== undefined &&
    cwd !== null &&
    (typeof cwd !== "string" || cwd.length === 0)
  ) {
    throw new Error("cwd must be a non-empty string");
  }

  const timeout = value.timeout_ms ?? defaultTimeoutMs;
  if (!Number.isInteger(timeout) || Number(timeout) < 1) {
    throw new Error("timeout_ms must be a positive integer");
  }
  if (Number(timeout) > maxTimeoutMs) {
    throw new Error(`timeout_ms cannot exceed ${maxTimeoutMs}`);
  }

  return {
    command,
    cwd: typeof cwd === "string" ? cwd : undefined,
    timeout_ms: Number(timeout),
  };
}

async function resolveWorkingDirectory(
  workspaceRoot: string,
  requestedCwd: string | undefined,
  allowOutsideWorkspace: boolean,
): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot);
  const candidate = requestedCwd
    ? resolve(canonicalRoot, requestedCwd)
    : canonicalRoot;
  const canonicalCwd = await realpath(candidate);

  if (!allowOutsideWorkspace && !isWithin(canonicalRoot, canonicalCwd)) {
    throw new Error("cwd must stay within the configured workspace root");
  }

  return canonicalCwd;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

interface RunCommandOptions {
  shell?: string;
  environment: NodeJS.ProcessEnv;
  maxOutputChars: number;
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
  options: RunCommandOptions,
): Promise<ExecCommandResult> {
  signal.throwIfAborted();

  const invocation = shellInvocation(command, options.shell);
  const child = spawn(invocation.file, invocation.arguments, {
    cwd,
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let stdout = "";
  let stderr = "";
  let remaining = options.maxOutputChars;
  let truncated = false;
  let timedOut = false;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const capture = (target: "stdout" | "stderr", chunk: string): void => {
    if (remaining === 0) {
      truncated = true;
      return;
    }

    const captured = chunk.slice(0, remaining);
    remaining -= captured.length;
    truncated ||= captured.length < chunk.length;
    if (target === "stdout") stdout += captured;
    else stderr += captured;
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => capture("stdout", chunk));
  child.stderr.on("data", (chunk: string) => capture("stderr", chunk));

  return new Promise<ExecCommandResult>((resolvePromise, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal.removeEventListener("abort", handleAbort);
    };

    const finish = (
      error: unknown,
      result?: ExecCommandResult,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else resolvePromise(result as ExecCommandResult);
    };

    const terminate = (): void => {
      terminateProcess(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcess(child, "SIGKILL"), 1_000);
      forceKillTimer.unref();
    };

    const handleAbort = (): void => terminate();

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref();

    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();

    child.once("error", (error) => finish(error));
    child.once("close", (exitCode, exitSignal) => {
      if (signal.aborted) {
        finish(signal.reason ?? new Error("Command aborted"));
        return;
      }

      finish(undefined, {
        cwd,
        exitCode,
        signal: exitSignal,
        timedOut,
        stdout,
        stderr,
        truncated,
      });
    });
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
    child.kill(signal);
  }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "SHELL",
    "USER",
    "LOGNAME",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
  ];

  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
