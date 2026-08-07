import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type {
  ConversationAccessMode,
  ConversationMessageData,
  QueuedTurnData,
} from "@threadlight/protocol";

import {
  validatePromptSnapshot,
  type PromptSnapshot,
} from "./prompt-composer.js";

export interface StoredAgentSnapshot {
  version: 1;
  prompt: PromptSnapshot;
  runtime?: unknown;
}

export interface StoredConversation {
  version: 1;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  titleGeneratedAt?: string;
  titleStatus?: "pending" | "completed";
  accessMode?: ConversationAccessMode;
  /** Provider selected for this conversation (routing hint). */
  provider?: string;
  /** Model selected for this conversation. */
  model?: string;
  messages: readonly ConversationMessageData[];
  queuedTurns?: readonly QueuedTurnData[];
  modelState?: unknown;
  agentSnapshot?: StoredAgentSnapshot;
}

export interface ConversationStore {
  create(conversation: StoredConversation): void | Promise<void>;
  load(
    threadId: string,
  ): StoredConversation | undefined | Promise<StoredConversation | undefined>;
  save(conversation: StoredConversation): void | Promise<void>;
  delete(threadId: string): boolean | Promise<boolean>;
}

export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();

  create(conversation: StoredConversation): void {
    this.conversations.set(conversation.threadId, clone(conversation));
  }

  load(threadId: string): StoredConversation | undefined {
    const conversation = this.conversations.get(threadId);
    return conversation ? clone(conversation) : undefined;
  }

  save(conversation: StoredConversation): void {
    this.conversations.set(conversation.threadId, clone(conversation));
  }

  delete(threadId: string): boolean {
    return this.conversations.delete(threadId);
  }
}

export class FileConversationStore implements ConversationStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  create(conversation: StoredConversation): void {
    this.write(conversation);
  }

  load(threadId: string): StoredConversation | undefined {
    const path = this.pathFor(threadId);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }

    const value = JSON.parse(source) as unknown;
    if (!isStoredConversation(value) || value.threadId !== threadId) {
      throw new Error(`Conversation ${threadId} has an unsupported format`);
    }
    return value;
  }

  save(conversation: StoredConversation): void {
    this.write(conversation);
  }

  delete(threadId: string): boolean {
    const path = this.pathFor(threadId);
    try {
      rmSync(path);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  private write(conversation: StoredConversation): void {
    const path = this.pathFor(conversation.threadId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(conversation, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporaryPath, path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private pathFor(threadId: string): string {
    if (
      !threadId ||
      basename(threadId) !== threadId ||
      !/^[\w-]+$/.test(threadId)
    ) {
      throw new Error("Invalid conversation id");
    }
    return join(this.directory, `${threadId}.json`);
  }
}

function clone(conversation: StoredConversation): StoredConversation {
  return structuredClone(conversation);
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const conversation = value as Record<string, unknown>;
  return (
    conversation.version === 1 &&
    typeof conversation.threadId === "string" &&
    typeof conversation.createdAt === "string" &&
    typeof conversation.updatedAt === "string" &&
    (conversation.title === undefined ||
      typeof conversation.title === "string") &&
    (conversation.titleGeneratedAt === undefined ||
      typeof conversation.titleGeneratedAt === "string") &&
    (conversation.titleStatus === undefined ||
      conversation.titleStatus === "pending" ||
      conversation.titleStatus === "completed") &&
    (conversation.accessMode === undefined ||
      conversation.accessMode === "approval" ||
      conversation.accessMode === "full") &&
    (conversation.provider === undefined ||
      typeof conversation.provider === "string") &&
    (conversation.model === undefined ||
      typeof conversation.model === "string") &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isConversationMessage) &&
    (conversation.queuedTurns === undefined ||
      (Array.isArray(conversation.queuedTurns) &&
        conversation.queuedTurns.every(isQueuedTurn))) &&
    (conversation.agentSnapshot === undefined ||
      isStoredAgentSnapshot(conversation.agentSnapshot))
  );
}

function isQueuedTurn(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const attachmentsValid =
    item.attachments === undefined ||
    (Array.isArray(item.attachments) && item.attachments.every(isAttachment));
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.input === "string" &&
    (item.input.trim().length > 0 ||
      (Array.isArray(item.attachments) && item.attachments.length > 0)) &&
    (item.delivery === "inject" || item.delivery === "queued") &&
    attachmentsValid &&
    typeof item.createdAt === "string"
  );
}

function isStoredAgentSnapshot(value: unknown): value is StoredAgentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1) return false;
  try {
    validatePromptSnapshot(snapshot.prompt);
    return true;
  } catch {
    return false;
  }
}

function isConversationMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    (message.attachments === undefined ||
      (Array.isArray(message.attachments) &&
        message.attachments.every(isAttachment))) &&
    (message.followUpDelivery === undefined ||
      message.followUpDelivery === "inject" ||
      message.followUpDelivery === "queued") &&
    (message.capabilityRefs === undefined ||
      (Array.isArray(message.capabilityRefs) &&
        message.capabilityRefs.every(
          (ref) => typeof ref === "string" && ref.length > 0,
        ))) &&
    (message.capabilities === undefined ||
      (Array.isArray(message.capabilities) &&
        message.capabilities.every(isMessageCapability))) &&
    (message.error === undefined || typeof message.error === "boolean") &&
    (message.mode === undefined ||
      message.mode === "default" ||
      message.mode === "plan") &&
    (message.plan === undefined || isAgentPlan(message.plan)) &&
    (message.diagnostics === undefined ||
      isTurnDiagnostics(message.diagnostics)) &&
    (message.sources === undefined ||
      (Array.isArray(message.sources) &&
        message.sources.every(isMessageSource))) &&
    (message.citations === undefined ||
      (Array.isArray(message.citations) &&
        message.citations.every(isMessageCitation))) &&
    (message.progress === undefined ||
      (Array.isArray(message.progress) &&
        message.progress.every(isConversationProgress))) &&
    (message.activities === undefined || Array.isArray(message.activities))
  );
}

function isMessageSource(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === "string" &&
    typeof source.title === "string" &&
    typeof source.url === "string" &&
    /^https?:\/\//.test(source.url) &&
    typeof source.domain === "string" &&
    (source.description === undefined ||
      typeof source.description === "string")
  );
}

function isMessageCitation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const citation = value as Record<string, unknown>;
  return (
    typeof citation.id === "string" &&
    Array.isArray(citation.sourceIds) &&
    citation.sourceIds.length > 0 &&
    citation.sourceIds.every((id) => typeof id === "string") &&
    typeof citation.excerpt === "string"
  );
}

function isTurnDiagnostics(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const diagnostics = value as Record<string, unknown>;
  return (
    (diagnostics.status === "completed" ||
      diagnostics.status === "failed") &&
    typeof diagnostics.startedAt === "string" &&
    typeof diagnostics.completedAt === "string" &&
    isNonNegativeNumber(diagnostics.durationMs) &&
    (diagnostics.model === undefined ||
      typeof diagnostics.model === "string") &&
    isTokenUsage(diagnostics.usage) &&
    Array.isArray(diagnostics.modelSteps) &&
    diagnostics.modelSteps.every((step) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        return false;
      }
      const candidate = step as Record<string, unknown>;
      return (
        Number.isInteger(candidate.step) &&
        Number(candidate.step) > 0 &&
        isNonNegativeNumber(candidate.durationMs) &&
        isTokenUsage(candidate.usage)
      );
    }) &&
    Array.isArray(diagnostics.toolCalls) &&
    diagnostics.toolCalls.every((tool) => {
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
        return false;
      }
      const candidate = tool as Record<string, unknown>;
      return (
        typeof candidate.callId === "string" &&
        typeof candidate.name === "string" &&
        isNonNegativeNumber(candidate.durationMs) &&
        typeof candidate.isError === "boolean"
      );
    })
  );
}

function isTokenUsage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return (
    isNonNegativeNumber(usage.inputTokens) &&
    isNonNegativeNumber(usage.outputTokens) &&
    isNonNegativeNumber(usage.totalTokens)
  );
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMessageCapability(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const capability = value as Record<string, unknown>;
  return (
    typeof capability.id === "string" &&
    capability.id.length > 0 &&
    (capability.kind === "skill" || capability.kind === "tool") &&
    typeof capability.name === "string" &&
    capability.name.length > 0 &&
    (capability.source === undefined ||
      typeof capability.source === "string") &&
    (capability.icon === undefined || typeof capability.icon === "string")
  );
}

function isAgentPlan(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    (plan.source === "user" || plan.source === "model") &&
    (plan.explanation === undefined ||
      typeof plan.explanation === "string") &&
    (plan.documentPath === undefined ||
      (typeof plan.documentPath === "string" &&
        /^\.threadlight\/plans\/[A-Za-z0-9_-]+\.md$/.test(
          plan.documentPath,
        ))) &&
    (plan.documentVersion === undefined ||
      (typeof plan.documentVersion === "string" &&
        /^[a-f0-9]{16}$/.test(plan.documentVersion))) &&
    Array.isArray(plan.items) &&
    plan.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.step === "string" &&
        (candidate.details === undefined ||
          typeof candidate.details === "string") &&
        (candidate.acceptanceCriteria === undefined ||
          (Array.isArray(candidate.acceptanceCriteria) &&
            candidate.acceptanceCriteria.every(
              (criterion) => typeof criterion === "string",
            ))) &&
        (candidate.completionEvidence === undefined ||
          (Array.isArray(candidate.completionEvidence) &&
            candidate.completionEvidence.every(
              (evidence) => typeof evidence === "string",
            ))) &&
        (candidate.status === "pending" ||
          candidate.status === "in_progress" ||
          candidate.status === "completed")
      );
    })
  );
}

function isAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    (attachment.kind === "image" || attachment.kind === "file") &&
    typeof attachment.path === "string"
  );
}

function isConversationProgress(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  return (
    typeof progress.text === "string" && Array.isArray(progress.activities)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
