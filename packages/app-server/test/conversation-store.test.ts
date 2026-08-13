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
        {
          id: "message-1",
          role: "user" as const,
          text: "Hello",
          mode: "plan" as const,
        },
        {
          id: "message-2",
          role: "assistant" as const,
          text: "Hi",
          plan: {
            source: "user" as const,
            items: [
              { step: "Inspect", status: "completed" as const },
              { step: "Implement", status: "in_progress" as const },
            ],
          },
        },
      ],
      modelState: { providerWireState: [{ callId: "opaque-call" }] },
      agentRuns: [
        {
          version: 1 as const,
          turnId: "turn-1",
          rootId: "root-agent",
          maxConcurrent: 3,
          status: "interrupted" as const,
          createdAt: "2026-07-21T08:00:30.000Z",
          updatedAt: "2026-07-21T08:00:45.000Z",
          agents: [
            {
              profileName: "explorer",
              pendingInput: ["Check the protocol"],
              collected: false,
              modelState: { providerCallId: "child-call" },
              checkpointStep: 1,
              checkpointPhase: "model_completed" as const,
              interruption: {
                previousStatus: "running" as const,
                interruptedAt: "2026-07-21T08:00:45.000Z",
                reason: "app_server_restart",
              },
              agent: {
                id: "child-agent",
                parentId: "root-agent",
                agentThreadId: "agent-thread-1",
                agentPath: "/root/explorer",
                followUpOf: "previous-agent-turn",
                closedAt: "2026-07-21T08:00:45.000Z",
                name: "explorer",
                role: "explorer",
                task: "Inspect persistence",
                status: "interrupted" as const,
                phase: "done" as const,
                createdAt: "2026-07-21T08:00:30.000Z",
                startedAt: "2026-07-21T08:00:31.000Z",
                completedAt: "2026-07-21T08:00:45.000Z",
                elapsedMs: 14_000,
                activities: [],
                messages: [
                  {
                    id: "message-from-reviewer",
                    fromAgentId: "reviewer-turn",
                    fromAgentThreadId: "reviewer-thread",
                    fromAgentName: "reviewer",
                    toAgentThreadId: "agent-thread-1",
                    text: "Check the recovery path too.",
                    createdAt: "2026-07-21T08:00:40.000Z",
                    delivery: "active" as const,
                  },
                ],
              },
            },
          ],
        },
      ],
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
