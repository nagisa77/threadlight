import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
} from "@threadlight/agent-loop";
import type {
  AgentTreeData,
  AgentThreadData,
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
          agentThreadId: child!.id,
          status: "completed",
          output: "Protocol tests need an active-turn tree snapshot.",
        }),
      ]),
    );
    const persistedChild = stored?.agentRuns?.[0]?.agents.find(
      ({ agent }) => agent.id === child!.id,
    );
    expect(stored?.agentRuns?.[0]?.status).toBe("completed");
    expect(persistedChild).toMatchObject({
      pendingInput: [],
      modelState: { child: 2 },
    });
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

  it("persists child checkpoints and recovers unfinished agent threads as queryable interruptions", async () => {
    const toolStarted = Promise.withResolvers<void>();
    const releaseTool = Promise.withResolvers<void>();
    const originalSettled = Promise.withResolvers<void>();
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    let rootTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          return {
            text: "Inspecting persisted state.",
            toolCalls: [
              {
                id: "read-checkpoint",
                name: "read_checkpoint",
                arguments: {},
              },
            ],
            state: { continuation: "child-state" },
          };
        }
        rootTurns += 1;
        return rootTurns === 1
          ? {
              text: "Delegating inspection.",
              toolCalls: [
                {
                  id: "spawn-explorer",
                  name: "spawn_agent",
                  arguments: {
                    role: "explorer",
                    task: "Inspect crash recovery",
                  },
                },
              ],
            }
          : {
              text: "Waiting for the explorer.",
              toolCalls: [
                { id: "wait-explorer", name: "wait_for_agents", arguments: {} },
              ],
            };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
        tools: [
          defineTool({
            name: "read_checkpoint",
            description: "Block while crash recovery is inspected",
            mutability: "read",
            parameters: { type: "object" },
            async execute() {
              toolStarted.resolve();
              await releaseTool.promise;
              return "released";
            },
          }),
        ],
      }),
      conversationStore: store,
      multiAgent: {
        profiles: [
          {
            name: "explorer",
            description: "Inspect without writes",
            instructions: "Inspect crash recovery",
            toolAccess: "read-only",
          },
        ],
      },
      send(message) {
        messages.push(message);
        if (
          "method" in message &&
          (message.method === "turn/completed" ||
            message.method === "turn/failed")
        ) {
          originalSettled.resolve();
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
      params: { threadId, input: "Test crash recovery" },
    });
    const turnId = result<{ turnId: string }>(messages, 3).turnId;
    await toolStarted.promise;
    const child = latestTree(messages).agents.find(
      ({ parentId }) => parentId !== undefined,
    )!;

    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "agent/steer",
      params: {
        threadId,
        agentId: child.id,
        input: "Preserve this direction",
      },
    });
    expect(result<{ accepted: boolean }>(messages, 4).accepted).toBe(true);

    const checkpointed = await store.load(threadId);
    const storedChild = checkpointed?.agentRuns?.[0]?.agents.find(
      ({ agent }) => agent.id === child.id,
    );
    expect(checkpointed?.agentRuns?.[0]).toMatchObject({
      turnId,
      status: "active",
    });
    expect(storedChild).toMatchObject({
      pendingInput: ["Preserve this direction"],
      checkpointStep: 1,
      checkpointPhase: "tool_started",
      modelState: { continuation: "child-state" },
    });

    const restartedMessages: JsonRpcOutgoing[] = [];
    const restartedStore = new MemoryConversationStore();
    restartedStore.create(checkpointed!);
    const restarted = new AppServer({
      loop: new AgentLoop({
        async generate() {
          return { text: "unused", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
      }),
      conversationStore: restartedStore,
      send(message) {
        restartedMessages.push(message);
      },
    });
    await restarted.receive({ jsonrpc: "2.0", id: 10, method: "initialize" });
    await restarted.receive({
      jsonrpc: "2.0",
      id: 11,
      method: "thread/resume",
      params: { threadId },
    });
    const resumed = result<{
      messages: readonly ConversationMessageData[];
    }>(restartedMessages, 11);
    expect(resumed.messages.at(-1)).toMatchObject({
      id: `agent-interrupted:${turnId}`,
      role: "assistant",
      error: true,
    });
    expect(
      resumed.messages
        .at(-1)
        ?.agentTree?.agents.find(({ id }) => id === child.id),
    ).toMatchObject({ status: "interrupted", phase: "done" });

    await restarted.receive({
      jsonrpc: "2.0",
      id: 12,
      method: "agent/list",
      params: { threadId, turnId },
    });
    const listed = result<{ agents: readonly AgentThreadData[] }>(
      restartedMessages,
      12,
    ).agents;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: child.id,
      agentThreadId: child.id,
      hostThreadId: threadId,
      turnId,
      runStatus: "interrupted",
      pendingInput: ["Preserve this direction"],
      interruption: {
        previousStatus: "running",
        reason: "app_server_restart",
      },
      checkpoint: {
        step: 1,
        phase: "tool_started",
        hasModelState: true,
      },
      agent: { status: "interrupted" },
    });
    expect(listed[0]).not.toHaveProperty("modelState");

    await restarted.receive({
      jsonrpc: "2.0",
      id: 13,
      method: "agent/read",
      params: { threadId, agentId: child.id },
    });
    expect(
      result<{ agent: AgentThreadData }>(restartedMessages, 13).agent,
    ).toEqual(listed[0]);

    const recovered = await restartedStore.load(threadId);
    expect(recovered?.agentRuns?.[0]?.status).toBe("interrupted");
    expect(
      recovered?.agentRuns?.[0]?.agents.find(
        ({ agent }) => agent.id === child.id,
      )?.modelState,
    ).toEqual({ continuation: "child-state" });

    await server.dispose();
    releaseTool.resolve();
    await originalSettled.promise;
    await restarted.dispose();
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
