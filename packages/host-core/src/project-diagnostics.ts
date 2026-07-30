import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  HostProjectDiagnosticsSnapshot,
  HostTurnDiagnostic,
} from "@threadlight/protocol";

export interface DiagnosticsProject {
  id: string;
  name: string;
  basePath: string;
  conversations: readonly {
    id: string;
    title: string;
  }[];
}

export function projectDiagnostics(
  project: DiagnosticsProject,
  now: () => Date = () => new Date(),
): HostProjectDiagnosticsSnapshot {
  const turns = project.conversations
    .flatMap((conversation) =>
      readConversationDiagnostics(
        project.basePath,
        conversation.id,
        conversation.title,
      ),
    )
    .sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt),
    );
  return {
    projectId: project.id,
    projectName: project.name,
    generatedAt: now().toISOString(),
    totals: {
      turns: turns.length,
      failedTurns: turns.filter(({ status }) => status === "failed").length,
      inputTokens: sum(turns, ({ inputTokens }) => inputTokens),
      outputTokens: sum(turns, ({ outputTokens }) => outputTokens),
      totalTokens: sum(turns, ({ totalTokens }) => totalTokens),
      durationMs: sum(turns, ({ durationMs }) => durationMs),
      modelSteps: sum(turns, ({ modelSteps }) => modelSteps.length),
      toolCalls: sum(turns, ({ toolCalls }) => toolCalls.length),
      toolDurationMs: sum(turns, ({ toolCalls }) =>
        sum(toolCalls, ({ durationMs }) => durationMs),
      ),
    },
    turns: turns.slice(0, 100),
  };
}

function readConversationDiagnostics(
  basePath: string,
  threadId: string,
  title: string,
): readonly HostTurnDiagnostic[] {
  if (!threadId || !/^[\w-]+$/.test(threadId)) return [];
  let value: unknown;
  try {
    value = JSON.parse(
      readFileSync(
        join(
          basePath,
          ".threadlight",
          "conversations",
          `${threadId}.json`,
        ),
        "utf8",
      ),
    );
  } catch {
    return [];
  }
  if (!isRecord(value) || !Array.isArray(value.messages)) return [];
  return value.messages.flatMap((message) => {
    if (
      !isRecord(message) ||
      message.role !== "assistant" ||
      !isTurnDiagnostics(message.diagnostics)
    ) {
      return [];
    }
    const diagnostics = message.diagnostics;
    return [
      {
        threadId,
        title,
        status: diagnostics.status,
        startedAt: diagnostics.startedAt,
        completedAt: diagnostics.completedAt,
        durationMs: diagnostics.durationMs,
        ...(typeof diagnostics.model === "string"
          ? { model: diagnostics.model }
          : {}),
        inputTokens: diagnostics.usage.inputTokens,
        outputTokens: diagnostics.usage.outputTokens,
        totalTokens: diagnostics.usage.totalTokens,
        modelSteps: diagnostics.modelSteps.map((step) => ({
          step: step.step,
          durationMs: step.durationMs,
          inputTokens: step.usage.inputTokens,
          outputTokens: step.usage.outputTokens,
          totalTokens: step.usage.totalTokens,
        })),
        toolCalls: diagnostics.toolCalls.map((tool) => ({
          callId: tool.callId,
          name: tool.name,
          durationMs: tool.durationMs,
          isError: tool.isError,
        })),
      },
    ];
  });
}

interface StoredDiagnostics {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  model?: string;
  usage: Usage;
  modelSteps: Array<{
    step: number;
    durationMs: number;
    usage: Usage;
  }>;
  toolCalls: Array<{
    callId: string;
    name: string;
    durationMs: number;
    isError: boolean;
  }>;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function isTurnDiagnostics(value: unknown): value is StoredDiagnostics {
  if (!isRecord(value)) return false;
  return (
    (value.status === "completed" || value.status === "failed") &&
    typeof value.startedAt === "string" &&
    typeof value.completedAt === "string" &&
    isNonNegativeNumber(value.durationMs) &&
    (value.model === undefined || typeof value.model === "string") &&
    isUsage(value.usage) &&
    Array.isArray(value.modelSteps) &&
    value.modelSteps.every(
      (step) =>
        isRecord(step) &&
        Number.isInteger(step.step) &&
        isNonNegativeNumber(step.durationMs) &&
        isUsage(step.usage),
    ) &&
    Array.isArray(value.toolCalls) &&
    value.toolCalls.every(
      (tool) =>
        isRecord(tool) &&
        typeof tool.callId === "string" &&
        typeof tool.name === "string" &&
        isNonNegativeNumber(tool.durationMs) &&
        typeof tool.isError === "boolean",
    )
  );
}

function isUsage(value: unknown): value is Usage {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.inputTokens) &&
    isNonNegativeNumber(value.outputTokens) &&
    isNonNegativeNumber(value.totalTokens)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sum<T>(
  values: readonly T[],
  select: (value: T) => number,
): number {
  return values.reduce((total, value) => total + select(value), 0);
}
