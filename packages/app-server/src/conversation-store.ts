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
    (message.error === undefined || typeof message.error === "boolean") &&
    (message.activities === undefined || Array.isArray(message.activities))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
