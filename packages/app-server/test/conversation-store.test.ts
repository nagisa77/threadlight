import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileConversationStore } from "../src/conversation-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("FileConversationStore", () => {
  it("stores messages and opaque model state in the project conversation folder", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-conversations-"));
    directories.push(root);
    const directory = join(root, ".threadlight", "conversations");
    const store = new FileConversationStore(directory);
    const conversation = {
      version: 1 as const,
      threadId: "thread-1",
      createdAt: "2026-07-21T08:00:00.000Z",
      updatedAt: "2026-07-21T08:01:00.000Z",
      messages: [
        { id: "message-1", role: "user" as const, text: "Hello" },
        { id: "message-2", role: "assistant" as const, text: "Hi" },
      ],
      modelState: { providerWireState: [{ callId: "opaque-call" }] },
    };

    store.create(conversation);

    expect(existsSync(join(directory, "thread-1.json"))).toBe(true);
    expect(store.load("thread-1")).toEqual(conversation);
    expect(store.delete("thread-1")).toBe(true);
    expect(existsSync(join(directory, "thread-1.json"))).toBe(false);
    expect(store.delete("thread-1")).toBe(false);
    expect(() => store.load("../outside")).toThrow("Invalid conversation id");
    expect(() => store.delete("../outside")).toThrow("Invalid conversation id");
  });
});
