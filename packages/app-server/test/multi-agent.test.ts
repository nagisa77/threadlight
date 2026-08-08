import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import type {
  AgentTreeData,
  ConversationMessageData,
  JsonRpcOutgoing,
} from "@threadlight/protocol";

import { AppServer } from "../src/app-server.js";
import { MemoryConversationStore } from "../src/conversation-store.js";

describe("AppServer multi-agent runtime", () => {
  it("streams an inspectable tree, steers a scripted child, and persists its final result", async () => {
    const childStarted = Promise.withResolvers<void>();
    const releaseChild = Promise.withResolvers<void>();
    const turnCompleted = Promise.withResolvers<void>();
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    let rootTurns = 0;
    let childTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childTurns += 1;
          if (childTurns === 1) {
            childStarted.resolve();
            await releaseChild.promise;
            return {
              text: "Initial child result",
              toolCalls: [],
              state: { child: 1 },
            };
          }
          expect(request.state).toEqual({ child: 1 });
          expect(request.input).toContain("Focus on protocol tests");
          return {
            text: "Protocol tests need an active-turn tree snapshot.",
            toolCalls: [],
            state: { child: 2 },
          };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "I’ll delegate protocol inspection.",
            toolCalls: [
              {
                id: "spawn-explorer",
                name: "spawn_agent",
                arguments: {
                  role: "explorer",
                  task: "Inspect protocol persistence",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Waiting for inspection.",
            toolCalls: [
              { id: "wait-explorer", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "active-turn tree snapshot",
        );
        return { text: "Integrated the explorer result.", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
      }),
      conversationStore: store,
      multiAgent: {
        profiles: [
          {
            name: "explorer",
            description: "Inspect without writes",
            instructions: "Inspect and return evidence",
            toolAccess: "read-only",
          },
        ],
      },
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          turnCompleted.resolve();
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Implement multi-agent" },
    });
    await childStarted.promise;

    const liveTree = latestTree(messages);
    const child = liveTree.agents.find(
      ({ parentId }) => parentId === liveTree.rootId,
    );
    expect(child).toMatchObject({ role: "explorer", status: "running" });
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "agent/steer",
      params: {
        threadId,
        agentId: child!.id,
        input: "Focus on protocol tests",
      },
    });
    expect(result<{ accepted: boolean }>(messages, 4)).toEqual({
      accepted: true,
    });
    releaseChild.resolve();
    await turnCompleted.promise;

    const stored = await store.load(threadId);
    const assistant = stored?.messages.at(-1) as ConversationMessageData;
    expect(assistant.text).toBe("Integrated the explorer result.");
    expect(assistant.agentTree?.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "explorer",
          status: "completed",
          output: "Protocol tests need an active-turn tree snapshot.",
        }),
      ]),
    );
    expect(
      messages.some(
        (message) =>
          "method" in message && message.method === "agent/tree-updated",
      ),
    ).toBe(true);

    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });
    expect(
      result<{ messages: readonly ConversationMessageData[] }>(
        messages,
        5,
      ).messages.at(-1)?.agentTree,
    ).toEqual(assistant.agentTree);
    await server.dispose();
  });
});

function result<T>(messages: readonly JsonRpcOutgoing[], id: number): T {
  const message = messages.find(
    (candidate) => "id" in candidate && candidate.id === id,
  );
  if (!message || !("result" in message)) throw new Error(`Missing RPC ${id}`);
  return message.result as T;
}

function latestTree(messages: readonly JsonRpcOutgoing[]): AgentTreeData {
  const notification = [...messages]
    .reverse()
    .find(
      (message) =>
        "method" in message && message.method === "agent/tree-updated",
    );
  if (!notification || !("params" in notification)) {
    throw new Error("Missing agent tree notification");
  }
  return (notification.params as { tree: AgentTreeData }).tree;
}
