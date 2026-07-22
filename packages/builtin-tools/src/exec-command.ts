import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { defineTool, type Tool } from "@threadlight/agent-loop";

import {
  ProcessManager,
  type ManagedProcessSnapshot,
} from "./process-manager.js";

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
  processManager?: ProcessManager;
}

export interface ExecCommandResult extends ManagedProcessSnapshot {
  timedOut: boolean;
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
  const processManager = options.processManager ?? new ProcessManager();

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
          description:
            "How long to wait before returning a managed process session.",
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

      const sessionId = processManager.start(parsed.command, {
        cwd,
        shell: options.shell,
        environment: options.environment ?? safeEnvironment(),
        maxOutputChars,
      });
      try {
        const result = await processManager.wait(
          sessionId,
          parsed.timeout_ms,
          context.signal,
        );
        return { ...result, timedOut: result.status === "running" };
      } catch (error) {
        await processManager.kill(sessionId);
        throw error;
      }
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
