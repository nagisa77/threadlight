import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  HostDiagnosticAttachment,
  HostDiagnosticConversation,
  HostDiagnosticEnvironment,
  HostDiagnosticError,
  HostDiagnosticFile,
  HostDiagnosticMessage,
  HostDiagnosticQueuedTurn,
  HostDiagnosticTimelineEvent,
  HostProjectDiagnosticBundle,
  HostProjectDiagnosticsSnapshot,
  HostTaskWorkspace,
} from "@threadlight/protocol";

import type { ConversationChangeTracker } from "./conversation-changes.js";
import {
  projectDiagnostics,
  type DiagnosticsProject,
} from "./project-diagnostics.js";

const REDACTION = "[REDACTED]" as const;
const DEFAULT_TEXT_FIELD_BYTES = 512 * 1024;
const DEFAULT_TOTAL_TEXT_BYTES = 20 * 1024 * 1024;

export interface DiagnosticBundleProject extends DiagnosticsProject {
  scope?: "project" | "standalone";
  conversations: readonly {
    id: string;
    title: string;
    createdAt?: string;
    updatedAt?: string;
    workspace?: HostTaskWorkspace;
  }[];
}

export interface ProjectDiagnosticBundleOptions {
  environment: HostDiagnosticEnvironment;
  changes: ConversationChangeTracker;
  now?: () => Date;
  maxTextFieldBytes?: number;
  maxTotalTextBytes?: number;
}

interface OrderedTimelineEvent {
  sortAt: string;
  order: number;
  event: Omit<HostDiagnosticTimelineEvent, "sequence">;
}

interface StoredDiagnostics {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  model?: string;
  modelSteps: readonly {
    step: number;
    durationMs: number;
  }[];
  toolCalls: readonly {
    callId: string;
    name: string;
    durationMs: number;
    isError: boolean;
    errorCode?: string;
  }[];
}

/**
 * Builds a shareable, task-scoped diagnostic export. It intentionally omits
 * provider state, agent snapshots, environment variables, and attachment
 * paths. Only tracked changed-file bodies are included.
 */
export async function projectDiagnosticBundle(
  project: DiagnosticBundleProject,
  options: ProjectDiagnosticBundleOptions,
): Promise<HostProjectDiagnosticBundle> {
  const generatedAt = (options.now ?? (() => new Date()))();
  const warnings: string[] = [];
  const sanitizer = new DiagnosticTextSanitizer(
    pathAliases(project),
    options.maxTextFieldBytes ?? DEFAULT_TEXT_FIELD_BYTES,
    options.maxTotalTextBytes ?? DEFAULT_TOTAL_TEXT_BYTES,
  );
  const conversations: HostDiagnosticConversation[] = [];
  const files: HostDiagnosticFile[] = [];
  const errors: HostDiagnosticError[] = [];
  const timeline: OrderedTimelineEvent[] = [];
  let timelineOrder = 0;
  let missingSnapshots = 0;

  for (const conversation of project.conversations) {
    const stored = await readStoredConversation(
      project.basePath,
      conversation.id,
      warnings,
    );
    const messages = Array.isArray(stored?.messages)
      ? stored.messages.flatMap((value) => {
          const message = diagnosticMessage(value, sanitizer);
          if (!message) return [];
          const diagnostics = storedDiagnostics(value);
          if (diagnostics) {
            const sortAt = diagnostics.startedAt;
            timeline.push({
              sortAt,
              order: timelineOrder++,
              event: {
                threadId: conversation.id,
                messageId: message.id,
                kind: "turn",
                name: sanitizer.text(conversation.title).value,
                status: diagnostics.status,
                startedAt: diagnostics.startedAt,
                completedAt: diagnostics.completedAt,
                durationMs: diagnostics.durationMs,
                ...(diagnostics.status === "failed"
                  ? { errorCode: "TURN_FAILED" }
                  : {}),
              },
            });
            diagnostics.modelSteps.forEach((step) => {
              timeline.push({
                sortAt,
                order: timelineOrder++,
                event: {
                  threadId: conversation.id,
                  messageId: message.id,
                  kind: "model",
                  name: `model.step.${step.step}`,
                  status: "completed",
                  durationMs: step.durationMs,
                },
              });
            });
            diagnostics.toolCalls.forEach((tool) => {
              const errorCode = tool.isError
                ? sanitizer.text(tool.errorCode ?? "TOOL_ERROR").value
                : undefined;
              timeline.push({
                sortAt,
                order: timelineOrder++,
                event: {
                  threadId: conversation.id,
                  messageId: message.id,
                  kind: "tool",
                  name: sanitizer.text(tool.name).value,
                  status: tool.isError ? "failed" : "completed",
                  durationMs: tool.durationMs,
                  ...(errorCode ? { errorCode } : {}),
                },
              });
              if (errorCode) {
                errors.push({
                  threadId: conversation.id,
                  messageId: message.id,
                  source: "tool",
                  code: errorCode,
                  message: sanitizer.text(tool.name).value,
                  occurredAt: diagnostics.completedAt,
                });
              }
            });
            if (diagnostics.status === "failed") {
              errors.push({
                threadId: conversation.id,
                messageId: message.id,
                source: "turn",
                code: "TURN_FAILED",
                message: message.text,
                occurredAt: diagnostics.completedAt,
              });
            }
          } else if (message.error) {
            errors.push({
              threadId: conversation.id,
              messageId: message.id,
              source: "turn",
              code: message.errorCode ?? "TURN_FAILED",
              message: message.text,
            });
          }
          collectProcessEvents(
            value,
            conversation.id,
            message.id,
            sanitizer,
            timeline,
            errors,
            () => timelineOrder++,
          );
          return [message];
        })
      : [];
    const queuedTurns = Array.isArray(stored?.queuedTurns)
      ? stored.queuedTurns.flatMap((value) => {
          const turn = diagnosticQueuedTurn(value, sanitizer);
          return turn ? [turn] : [];
        })
      : [];
    conversations.push({
      threadId: conversation.id,
      title: sanitizer.text(conversation.title).value,
      ...((stringValue(stored?.createdAt) ?? conversation.createdAt)
        ? {
            createdAt: stringValue(stored?.createdAt) ?? conversation.createdAt,
          }
        : {}),
      ...((stringValue(stored?.updatedAt) ?? conversation.updatedAt)
        ? {
            updatedAt: stringValue(stored?.updatedAt) ?? conversation.updatedAt,
          }
        : {}),
      ...(stringValue(stored?.provider)
        ? { provider: sanitizer.text(String(stored?.provider)).value }
        : {}),
      ...(stringValue(stored?.model)
        ? { model: sanitizer.text(String(stored?.model)).value }
        : {}),
      ...(conversation.workspace
        ? { workspaceMode: conversation.workspace.mode }
        : {}),
      messages,
      queuedTurns,
    });

    const workspacePath = conversation.workspace?.path ?? project.basePath;
    try {
      const snapshot = await options.changes.trackedChanges(
        project.id,
        conversation.id,
        workspacePath,
      );
      if (!snapshot) {
        missingSnapshots += 1;
        continue;
      }
      for (const file of snapshot.files) {
        const oldContent =
          file.oldContent === undefined
            ? undefined
            : sanitizer.text(file.oldContent);
        const newContent =
          file.newContent === undefined
            ? undefined
            : sanitizer.text(file.newContent);
        const expectedBodyMissing =
          !file.binary &&
          ((file.status !== "added" && oldContent === undefined) ||
            (file.status !== "deleted" && newContent === undefined));
        const contentTruncated = oldContent?.truncated || newContent?.truncated;
        files.push({
          threadId: conversation.id,
          path: sanitizer.text(file.path).value,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          binary: file.binary,
          ...(file.localOnly ? { localOnly: true } : {}),
          ...(oldContent ? { oldContent: oldContent.value } : {}),
          ...(newContent ? { newContent: newContent.value } : {}),
          ...(file.binary
            ? { omittedReason: "binary" as const }
            : expectedBodyMissing || contentTruncated
              ? { omittedReason: "too_large" as const }
              : {}),
        });
      }
    } catch (error) {
      warnings.push(
        `Could not collect changed files for task ${conversation.id}: ${safeErrorMessage(error)}`,
      );
    }
  }

  const sanitizedProjectName = sanitizer.text(project.name).value;
  const summary = sanitizedDiagnosticsSnapshot(
    projectDiagnostics(project, () => generatedAt),
    sanitizer,
    sanitizedProjectName,
  );
  if (missingSnapshots > 0) {
    warnings.push(
      `${missingSnapshots} task(s) had no tracked file baseline; their file bodies were not exported.`,
    );
  }
  if (sanitizer.truncatedTextFields > 0) {
    warnings.push(
      `${sanitizer.truncatedTextFields} text field(s) were truncated to keep the bundle shareable.`,
    );
  }
  const sanitizedWarnings = warnings.map(
    (warning) => sanitizer.text(warning).value,
  );

  const sortedTimeline = timeline
    .sort(
      (left, right) =>
        left.sortAt.localeCompare(right.sortAt) || left.order - right.order,
    )
    .map(({ event }, sequence) => ({ ...event, sequence: sequence + 1 }));
  errors.sort((left, right) =>
    (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""),
  );

  return {
    schemaVersion: 1,
    filename: diagnosticBundleFilename(sanitizedProjectName, generatedAt),
    generatedAt: generatedAt.toISOString(),
    project: {
      id: project.id,
      name: sanitizedProjectName,
      ...(project.scope ? { scope: project.scope } : {}),
      conversationCount: project.conversations.length,
    },
    environment: options.environment,
    summary,
    timeline: sortedTimeline,
    errors,
    conversations,
    files,
    redaction: {
      applied: true,
      replacement: REDACTION,
      count: sanitizer.redactionCount,
      truncatedTextFields: sanitizer.truncatedTextFields,
    },
    warnings: sanitizedWarnings,
  };
}

function sanitizedDiagnosticsSnapshot(
  snapshot: HostProjectDiagnosticsSnapshot,
  sanitizer: DiagnosticTextSanitizer,
  projectName: string,
): HostProjectDiagnosticsSnapshot {
  return {
    ...snapshot,
    projectName,
    turns: snapshot.turns.map((turn) => ({
      ...turn,
      title: sanitizer.text(turn.title).value,
      ...(turn.model ? { model: sanitizer.text(turn.model).value } : {}),
      toolCalls: turn.toolCalls.map((tool) => ({
        ...tool,
        name: sanitizer.text(tool.name).value,
        ...(tool.errorCode
          ? { errorCode: sanitizer.text(tool.errorCode).value }
          : {}),
      })),
    })),
  };
}

export function diagnosticBundleFilename(
  projectName: string,
  generatedAt: Date,
): string {
  const projectSlug =
    projectName
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  const timestamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `threadlight-diagnostics-${projectSlug}-${timestamp}.json`;
}

class DiagnosticTextSanitizer {
  redactionCount = 0;
  truncatedTextFields = 0;
  private totalTextBytes = 0;

  constructor(
    private readonly aliases: readonly {
      value: string;
      replacement: string;
    }[],
    private readonly maxTextFieldBytes: number,
    private readonly maxTotalTextBytes: number,
  ) {}

  text(value: string): { value: string; truncated: boolean } {
    let next = value;
    for (const alias of this.aliases) {
      if (!alias.value) continue;
      next = next.replaceAll(alias.value, alias.replacement);
    }
    next = this.redact(next);
    const remaining = Math.max(0, this.maxTotalTextBytes - this.totalTextBytes);
    const limit = Math.min(this.maxTextFieldBytes, remaining);
    const originalBytes = Buffer.byteLength(next);
    let truncated = originalBytes > limit;
    if (truncated) {
      next = `${truncateUtf8(next, Math.max(0, limit - 42))}\n[TRUNCATED FOR DIAGNOSTIC EXPORT]`;
      this.truncatedTextFields += 1;
    }
    this.totalTextBytes += Math.min(Buffer.byteLength(next), remaining);
    return { value: next, truncated };
  }

  private redact(value: string): string {
    let next = value;
    const replace = (
      pattern: RegExp,
      replacement: string | ((...args: string[]) => string),
    ) => {
      next = next.replace(pattern, (...args) => {
        this.redactionCount += 1;
        return typeof replacement === "string"
          ? replacement
          : replacement(...args.map(String));
      });
    };
    replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      REDACTION,
    );
    replace(
      /\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s"',]+/gi,
      (_match, prefix) => `${prefix}${REDACTION}`,
    );
    replace(
      /((?:"|')?(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd)(?:"|')?\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)/gi,
      (_match, prefix) => `${prefix}"${REDACTION}"`,
    );
    replace(
      /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd)\s*=\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\r\n]+)/gi,
      (_match, prefix, secret) => {
        const quote = secret.startsWith('"')
          ? '"'
          : secret.startsWith("'")
            ? "'"
            : "";
        return `${prefix}${quote}${REDACTION}${quote}`;
      },
    );
    replace(
      /(^|\n)(\s*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd)\s*=\s*)[^\r\n]+/gi,
      (_match, lineStart, prefix) => `${lineStart}${prefix}${REDACTION}`,
    );
    replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
      REDACTION,
    );
    return next;
  }
}

async function readStoredConversation(
  basePath: string,
  threadId: string,
  warnings: string[],
): Promise<Record<string, unknown> | undefined> {
  if (!threadId || !/^[\w-]+$/.test(threadId)) {
    warnings.push(`Skipped conversation with invalid id: ${threadId}`);
    return;
  }
  try {
    const value = JSON.parse(
      await readFile(
        join(basePath, ".threadlight", "conversations", `${threadId}.json`),
        "utf8",
      ),
    ) as unknown;
    if (!isRecord(value)) throw new Error("unsupported conversation format");
    return value;
  } catch (error) {
    warnings.push(
      `Could not read conversation ${threadId}: ${safeErrorMessage(error)}`,
    );
    return;
  }
}

function diagnosticMessage(
  value: unknown,
  sanitizer: DiagnosticTextSanitizer,
): HostDiagnosticMessage | undefined {
  if (!isRecord(value)) return;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.text !== "string"
  ) {
    return;
  }
  const attachments = diagnosticAttachments(value.attachments, sanitizer);
  return {
    id: value.id,
    role: value.role,
    text: sanitizer.text(value.text).value,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(value.followUpDelivery === "inject" ||
    value.followUpDelivery === "queued"
      ? { followUpDelivery: value.followUpDelivery }
      : {}),
    ...(typeof value.error === "boolean" ? { error: value.error } : {}),
    ...(typeof value.errorCode === "string"
      ? { errorCode: sanitizer.text(value.errorCode).value }
      : value.error === true
        ? { errorCode: "TURN_FAILED" }
        : {}),
    ...(value.mode === "default" || value.mode === "plan"
      ? { mode: value.mode }
      : {}),
  };
}

function diagnosticQueuedTurn(
  value: unknown,
  sanitizer: DiagnosticTextSanitizer,
): HostDiagnosticQueuedTurn | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.input !== "string" ||
    (value.delivery !== "inject" && value.delivery !== "queued") ||
    typeof value.createdAt !== "string"
  ) {
    return;
  }
  const attachments = diagnosticAttachments(value.attachments, sanitizer);
  return {
    id: value.id,
    text: sanitizer.text(value.input).value,
    delivery: value.delivery,
    createdAt: value.createdAt,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function diagnosticAttachments(
  value: unknown,
  sanitizer: DiagnosticTextSanitizer,
): readonly HostDiagnosticAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.mimeType !== "string" ||
      typeof item.size !== "number" ||
      (item.kind !== "image" && item.kind !== "file")
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        name: sanitizer.text(item.name).value,
        mimeType: item.mimeType,
        size: item.size,
        kind: item.kind,
      },
    ];
  });
}

function storedDiagnostics(value: unknown): StoredDiagnostics | undefined {
  if (!isRecord(value) || !isRecord(value.diagnostics)) return;
  const diagnostics = value.diagnostics;
  if (
    (diagnostics.status !== "completed" && diagnostics.status !== "failed") ||
    typeof diagnostics.startedAt !== "string" ||
    typeof diagnostics.completedAt !== "string" ||
    !isNonNegativeNumber(diagnostics.durationMs) ||
    !Array.isArray(diagnostics.modelSteps) ||
    !Array.isArray(diagnostics.toolCalls)
  ) {
    return;
  }
  const modelSteps = diagnostics.modelSteps.flatMap((step) =>
    isRecord(step) &&
    Number.isInteger(step.step) &&
    isNonNegativeNumber(step.durationMs)
      ? [{ step: Number(step.step), durationMs: step.durationMs }]
      : [],
  );
  const toolCalls = diagnostics.toolCalls.flatMap((tool) =>
    isRecord(tool) &&
    typeof tool.callId === "string" &&
    typeof tool.name === "string" &&
    isNonNegativeNumber(tool.durationMs) &&
    typeof tool.isError === "boolean"
      ? [
          {
            callId: tool.callId,
            name: tool.name,
            durationMs: tool.durationMs,
            isError: tool.isError,
            ...(typeof tool.errorCode === "string"
              ? { errorCode: tool.errorCode }
              : {}),
          },
        ]
      : [],
  );
  return {
    status: diagnostics.status,
    startedAt: diagnostics.startedAt,
    completedAt: diagnostics.completedAt,
    durationMs: diagnostics.durationMs,
    ...(typeof diagnostics.model === "string"
      ? { model: diagnostics.model }
      : {}),
    modelSteps,
    toolCalls,
  };
}

function collectProcessEvents(
  value: unknown,
  threadId: string,
  messageId: string,
  sanitizer: DiagnosticTextSanitizer,
  timeline: OrderedTimelineEvent[],
  errors: HostDiagnosticError[],
  nextOrder: () => number,
): void {
  if (!isRecord(value)) return;
  const activities = [
    ...(Array.isArray(value.activities) ? value.activities : []),
    ...(Array.isArray(value.progress)
      ? value.progress.flatMap((progress) =>
          isRecord(progress) && Array.isArray(progress.activities)
            ? progress.activities
            : [],
        )
      : []),
  ];
  const seen = new Set<string>();
  for (const activity of activities) {
    if (!isRecord(activity) || !isRecord(activity.process)) continue;
    const process = activity.process;
    if (
      typeof process.sessionId !== "string" ||
      typeof process.startedAt !== "string" ||
      typeof process.status !== "string"
    ) {
      continue;
    }
    const key = `${process.sessionId}:${process.startedAt}:${process.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const failed =
      process.status === "failed" || process.status === "terminated";
    const errorCode = failed
      ? typeof process.exitCode === "number"
        ? `PROCESS_EXIT_${process.exitCode}`
        : typeof process.signal === "string" && process.signal
          ? `PROCESS_SIGNAL_${process.signal}`
          : "PROCESS_FAILED"
      : undefined;
    const completedAt = stringValue(process.completedAt);
    const durationMs = completedAt
      ? Math.max(0, Date.parse(completedAt) - Date.parse(process.startedAt))
      : undefined;
    const name = sanitizer.text(
      stringValue(activity.name) ?? stringValue(process.command) ?? "process",
    ).value;
    timeline.push({
      sortAt: process.startedAt,
      order: nextOrder(),
      event: {
        threadId,
        messageId,
        kind: "process",
        name,
        status:
          process.status === "running"
            ? "running"
            : process.status === "terminated"
              ? "terminated"
              : failed
                ? "failed"
                : "completed",
        startedAt: process.startedAt,
        ...(completedAt ? { completedAt } : {}),
        ...(durationMs !== undefined && Number.isFinite(durationMs)
          ? { durationMs }
          : {}),
        ...(errorCode ? { errorCode } : {}),
      },
    });
    if (errorCode) {
      errors.push({
        threadId,
        messageId,
        source: "process",
        code: errorCode,
        message: name,
        occurredAt: completedAt ?? process.startedAt,
      });
    }
  }
}

function pathAliases(project: DiagnosticBundleProject): readonly {
  value: string;
  replacement: string;
}[] {
  const aliases = new Map<string, string>([[project.basePath, "<project>"]]);
  for (const conversation of project.conversations) {
    if (conversation.workspace?.path) {
      aliases.set(
        conversation.workspace.path,
        `<workspace:${conversation.id}>`,
      );
    }
    if (
      conversation.workspace?.mode === "worktree" &&
      conversation.workspace.repositoryRoot
    ) {
      aliases.set(conversation.workspace.repositoryRoot, "<repository>");
    }
  }
  return [...aliases]
    .sort(([left], [right]) => right.length - left.length)
    .map(([value, replacement]) => ({ value, replacement }));
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  return Buffer.from(value).subarray(0, maxBytes).toString("utf8");
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return String(error).slice(0, 240);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
