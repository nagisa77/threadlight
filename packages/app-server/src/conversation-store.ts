import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type { ConversationMessageData } from "@threadlight/protocol";

export interface StoredConversation {
  version: 1;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  messages: readonly ConversationMessageData[];
  modelState?: unknown;
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
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isConversationMessage)
  );
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
    (message.error === undefined || typeof message.error === "boolean") &&
    (message.mode === undefined ||
      message.mode === "default" ||
      message.mode === "plan") &&
    (message.plan === undefined || isAgentPlan(message.plan)) &&
    (message.progress === undefined ||
      (Array.isArray(message.progress) &&
        message.progress.every(isConversationProgress))) &&
    (message.activities === undefined || Array.isArray(message.activities))
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
