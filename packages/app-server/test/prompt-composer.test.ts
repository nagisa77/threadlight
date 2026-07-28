import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";
import { afterEach, describe, expect, it } from "vitest";

import { AppServer } from "../src/app-server.js";
import { FileConversationStore } from "../src/conversation-store.js";
import {
  composePrompt,
  validatePromptSnapshot,
} from "../src/prompt-composer.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";
import { createWorkspaceAgentFactory } from "../src/workspace-agent.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Prompt Composer", () => {
  it("creates stable versioned hashes and detects tampering", () => {
    const blocks = [
      {
        id: "host.base",
        version: 1,
        authority: "host" as const,
        source: "test",
        content: "Follow the host rules.",
      },
      {
        id: "project.context",
        version: 2,
        authority: "project" as const,
        source: "/workspace",
        content: "Use the project rules.",
      },
    ];
    const first = composePrompt(blocks);
    const second = composePrompt(blocks);
    const changed = composePrompt([
      blocks[0]!,
      { ...blocks[1]!, version: 3 },
    ]);

    expect(first).toEqual(second);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.blocks.every((block) => /^[a-f0-9]{64}$/.test(block.hash)))
      .toBe(true);
    expect(changed.hash).not.toBe(first.hash);
    expect(() =>
      composePrompt([blocks[0]!, blocks[0]!]),
    ).toThrow("Duplicate prompt block");
    expect(() =>
      validatePromptSnapshot({ ...first, instructions: "tampered" }),
    ).toThrow("hash does not match");
  });

  it("persists the original prompt and runtime snapshot across a restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-prompt-snapshot-"));
    directories.push(root);
    writeFileSync(join(root, "AGENTS.md"), "Use the original project policy.");
    const store = new FileConversationStore(join(root, ".threadlight", "conversations"));
    const firstRequests: ModelRequest[] = [];
    const firstMessages: JsonRpcOutgoing[] = [];
    const firstServer = new AppServer({
      loop: new AgentLoop(recordingProvider(firstRequests)),
      agentFactory: createWorkspaceAgentFactory({
        workspaceRoot: root,
        baseInstructions: "Use the original host prompt.",
      }),
      threadRuntimeFactory: () => ({
        promptBlocks: [
          {
            id: "runtime.test",
            version: 1,
            authority: "runtime",
            source: "test",
            content: "Use the original runtime prompt.",
          },
        ],
        snapshot: { marker: "original-runtime" },
      }),
      conversationStore: store,
      send: (message) => firstMessages.push(message),
    });

    await firstServer.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await firstServer.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(firstMessages, 2).threadId;
    await runTurn(firstServer, firstMessages, threadId, 3, "First turn");

    const stored = store.load(threadId);
    expect(stored?.agentSnapshot?.prompt.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.agentSnapshot?.runtime).toEqual({
      marker: "original-runtime",
    });

    writeFileSync(join(root, "AGENTS.md"), "Use the changed project policy.");
    const resumedRequests: ModelRequest[] = [];
    const resumedMessages: JsonRpcOutgoing[] = [];
    let restoredRuntime: unknown;
    const resumedServer = new AppServer({
      loop: new AgentLoop(recordingProvider(resumedRequests)),
      agentFactory: createWorkspaceAgentFactory({
        workspaceRoot: root,
        baseInstructions: "Use the changed host prompt.",
      }),
      threadRuntimeFactory(snapshot) {
        restoredRuntime = snapshot;
        return {
          promptBlocks: [
            {
              id: "runtime.test",
              version: 2,
              authority: "runtime",
              source: "test",
              content: "Use the changed runtime prompt.",
            },
          ],
          snapshot,
        };
      },
      conversationStore: store,
      send: (message) => resumedMessages.push(message),
    });

    await resumedServer.receive({ jsonrpc: "2.0", id: 4, method: "initialize" });
    await resumedServer.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });
    await runTurn(resumedServer, resumedMessages, threadId, 6, "Second turn");

    expect(restoredRuntime).toEqual({ marker: "original-runtime" });
    expect(resumedRequests[0]?.instructions).toContain(
      "Use the original host prompt.",
    );
    expect(resumedRequests[0]?.instructions).toContain(
      "Use the original project policy.",
    );
    expect(resumedRequests[0]?.instructions).toContain(
      "Use the original runtime prompt.",
    );
    expect(resumedRequests[0]?.instructions).not.toContain("changed");
  });
});

function recordingProvider(requests: ModelRequest[]): ModelProvider {
  return {
    async generate(request) {
      requests.push(request);
      return { text: "ok", toolCalls: [] };
    },
  };
}

async function runTurn(
  server: AppServer,
  messages: JsonRpcOutgoing[],
  threadId: string,
  id: number,
  input: string,
): Promise<void> {
  const completed = waitForCompletion(messages, threadId);
  await server.receive({
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: { threadId, input },
  });
  await completed;
}

function waitForCompletion(
  messages: JsonRpcOutgoing[],
  threadId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      if (
        messages.some(
          (message) =>
            "method" in message &&
            message.method === "turn/completed" &&
            (message.params as { threadId?: string }).threadId === threadId,
        )
      ) {
        resolve();
      } else {
        setTimeout(poll, 0);
      }
    };
    poll();
  });
}

function result<Result>(
  messages: readonly JsonRpcOutgoing[],
  id: number,
): Result {
  const message = messages.find(
    (candidate) => "id" in candidate && candidate.id === id,
  );
  if (!message || !("result" in message)) throw new Error(`Missing result ${id}`);
  return message.result as Result;
}
