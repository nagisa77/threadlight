import { defineTool, type Tool } from "@threadlight/agent-loop";

import { ProcessManager } from "./process-manager.js";

const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
const MAX_WAIT_TIMEOUT_MS = 120_000;

export interface ProcessToolOptions {
  processManager: ProcessManager;
}

export function createProcessStatusTool(options: ProcessToolOptions): Tool {
  return defineTool({
    name: "process_status",
    description:
      "Get the current status and captured output of a managed process session.",
    parameters: sessionParameters(),
    async execute(arguments_) {
      return options.processManager.status(parseSessionId(arguments_));
    },
  });
}

export function createProcessReadTool(options: ProcessToolOptions): Tool {
  return defineTool({
    name: "process_read",
    description:
      "Read the stdout, stderr, and current status of a managed process session.",
    parameters: sessionParameters(),
    async execute(arguments_) {
      return options.processManager.read(parseSessionId(arguments_));
    },
  });
}

export function createProcessWaitTool(options: ProcessToolOptions): Tool {
  return defineTool({
    name: "process_wait",
    description:
      "Wait for a managed process session to finish, or return its current state when the wait timeout is reached.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          minLength: 1,
          description: "Opaque process session identifier.",
        },
        timeout_ms: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: MAX_WAIT_TIMEOUT_MS,
          description: "How long to wait before returning the current state.",
        },
      },
      required: ["session_id", "timeout_ms"],
      additionalProperties: false,
    },
    async execute(arguments_, context) {
      const value = objectArguments(arguments_);
      const sessionId = requiredString(value.session_id, "session_id");
      const timeoutMs = optionalTimeout(value.timeout_ms);
      return options.processManager.wait(sessionId, timeoutMs, context.signal);
    },
  });
}

export function createProcessKillTool(options: ProcessToolOptions): Tool {
  return defineTool({
    name: "process_kill",
    description: "Terminate a managed process session and its process group.",
    parameters: sessionParameters(),
    needsApproval: true,
    async execute(arguments_) {
      return options.processManager.kill(parseSessionId(arguments_));
    },
  });
}

function sessionParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        minLength: 1,
        description: "Opaque process session identifier.",
      },
    },
    required: ["session_id"],
    additionalProperties: false,
  };
}

function parseSessionId(value: unknown): string {
  return requiredString(objectArguments(value).session_id, "session_id");
}

function optionalTimeout(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_WAIT_TIMEOUT_MS;
  if (
    !Number.isInteger(value) ||
    Number(value) < 1 ||
    Number(value) > MAX_WAIT_TIMEOUT_MS
  ) {
    throw new Error(
      `timeout_ms must be an integer between 1 and ${MAX_WAIT_TIMEOUT_MS}`,
    );
  }
  return Number(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function objectArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  return value as Record<string, unknown>;
}
