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
    const total = diagnostics.metrics?.total ?? diagnostics;
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
        inputTokens: total.usage.inputTokens,
        outputTokens: total.usage.outputTokens,
        totalTokens: total.usage.totalTokens,
        modelSteps: total.modelSteps.map((step) => ({
          step: step.step,
          durationMs: step.durationMs,
          inputTokens: step.usage.inputTokens,
          outputTokens: step.usage.outputTokens,
          totalTokens: step.usage.totalTokens,
          ...(step.agentId ? { agentId: step.agentId } : {}),
          ...(step.agentRole ? { agentRole: step.agentRole } : {}),
        })),
        toolCalls: total.toolCalls.map((tool) => ({
          callId: tool.callId,
          name: tool.name,
          durationMs: tool.durationMs,
          isError: tool.isError,
          ...(tool.errorCode ? { errorCode: tool.errorCode } : {}),
          ...(tool.agentId ? { agentId: tool.agentId } : {}),
          ...(tool.agentRole ? { agentRole: tool.agentRole } : {}),
        })),
        ...(diagnostics.metrics
          ? {
              metrics: {
                root: hostScope(diagnostics.metrics.root),
                children: hostScope(diagnostics.metrics.children),
                total: hostScope(diagnostics.metrics.total),
              },
            }
          : {}),
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
  modelSteps: ModelStep[];
  toolCalls: ToolCall[];
  metrics?: {
    root: DiagnosticScope;
    children: DiagnosticScope;
    total: DiagnosticScope;
  };
}

interface DiagnosticScope {
  usage: Usage;
  modelSteps: ModelStep[];
  toolCalls: ToolCall[];
}

interface ModelStep {
  step: number;
  durationMs: number;
  usage: Usage;
  agentId?: string;
  agentRole?: string;
}

interface ToolCall {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
  errorCode?: string;
  agentId?: string;
  agentRole?: string;
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
    isModelSteps(value.modelSteps) &&
    isToolCalls(value.toolCalls) &&
    (value.metrics === undefined || isDiagnosticMetrics(value.metrics))
  );
}

function isDiagnosticMetrics(value: unknown): boolean {
  return (
    isRecord(value) &&
    isDiagnosticScope(value.root) &&
    isDiagnosticScope(value.children) &&
    isDiagnosticScope(value.total)
  );
}

function isDiagnosticScope(value: unknown): value is DiagnosticScope {
  return (
    isRecord(value) &&
    isUsage(value.usage) &&
    isModelSteps(value.modelSteps) &&
    isToolCalls(value.toolCalls)
  );
}

function isModelSteps(value: unknown): value is ModelStep[] {
  return (
    Array.isArray(value) &&
    value.every(
      (step) =>
        isRecord(step) &&
        Number.isInteger(step.step) &&
        isNonNegativeNumber(step.durationMs) &&
        isUsage(step.usage) &&
        (step.agentId === undefined || typeof step.agentId === "string") &&
        (step.agentRole === undefined || typeof step.agentRole === "string"),
    )
  );
}

function isToolCalls(value: unknown): value is ToolCall[] {
  return (
    Array.isArray(value) &&
    value.every(
      (tool) =>
        isRecord(tool) &&
        typeof tool.callId === "string" &&
        typeof tool.name === "string" &&
        isNonNegativeNumber(tool.durationMs) &&
        typeof tool.isError === "boolean" &&
        (tool.errorCode === undefined || typeof tool.errorCode === "string") &&
        (tool.agentId === undefined || typeof tool.agentId === "string") &&
        (tool.agentRole === undefined || typeof tool.agentRole === "string"),
    )
  );
}

function hostScope(scope: DiagnosticScope) {
  return {
    inputTokens: scope.usage.inputTokens,
    outputTokens: scope.usage.outputTokens,
    totalTokens: scope.usage.totalTokens,
    modelSteps: scope.modelSteps.length,
    toolCalls: scope.toolCalls.length,
    toolDurationMs: sum(scope.toolCalls, ({ durationMs }) => durationMs),
  };
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
