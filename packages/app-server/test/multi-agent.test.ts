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

  it("continues a completed child thread after the parent turn and app server restart", async () => {
    const store = new MemoryConversationStore();
    const initialMessages: JsonRpcOutgoing[] = [];
    const initialCompleted = Promise.withResolvers<void>();
    let initialRootTurns = 0;
    const initialProvider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          expect(request.input).toBe("Create the first program");
          return {
            text: "Created the first program",
            toolCalls: [],
            state: { workerRound: 1 },
          };
        }
        initialRootTurns += 1;
        if (initialRootTurns === 1) {
          return {
            text: "Starting the worker.",
            toolCalls: [
              {
                id: "spawn-worker",
                name: "spawn_agent",
                arguments: {
                  role: "worker",
                  task: "Create the first program",
                },
              },
            ],
          };
        }
        if (initialRootTurns === 2) {
          return {
            text: "Waiting for the worker.",
            toolCalls: [
              { id: "wait-worker", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "Created the first program",
        );
        return { text: "The first program is ready.", toolCalls: [] };
      },
    };
    const profiles = [
      {
        name: "worker",
        description: "Implement programs",
        instructions: "Implement and verify the requested program",
        toolAccess: "all" as const,
      },
    ];
    const initialServer = new AppServer({
      loop: new AgentLoop(initialProvider),
      agent: defineAgent({ name: "threadlight", instructions: "Complete work" }),
      conversationStore: store,
      multiAgent: { profiles },
      send(message) {
        initialMessages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          initialCompleted.resolve();
        }
      },
    });

    await initialServer.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    await initialServer.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
    });
    const threadId = result<{ threadId: string }>(initialMessages, 2).threadId;
    await initialServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Create a program" },
    });
    await initialCompleted.promise;

    const initialConversation = await store.load(threadId);
    const initialRun = initialConversation?.agentRuns?.[0];
    const initialChild = initialRun?.agents.find(
      ({ agent }) => agent.id !== initialRun.rootId,
    );
    expect(initialChild).toMatchObject({
      profileName: "worker",
      modelState: { workerRound: 1 },
      agent: {
        status: "completed",
        output: "Created the first program",
      },
    });
    const agentThreadId = initialChild!.agent.agentThreadId!;
    const previousTaskId = initialChild!.agent.id;
    await initialServer.dispose();

    const resumedMessages: JsonRpcOutgoing[] = [];
    const resumedCompleted = Promise.withResolvers<void>();
    let resumedRootTurns = 0;
    const resumedProvider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          expect(request.input).toBe("Create another program");
          expect(request.state).toEqual({ workerRound: 1 });
          expect(request.history).toEqual([
            { role: "user", text: "Create the first program" },
            { role: "assistant", text: "Created the first program" },
          ]);
          return {
            text: "Created another program",
            toolCalls: [],
            state: { workerRound: 2 },
          };
        }
        resumedRootTurns += 1;
        if (resumedRootTurns === 1) {
          return {
            text: "Continuing the persisted worker.",
            toolCalls: [
              {
                id: "follow-up-worker",
                name: "follow_up_agent",
                arguments: {
                  agentId: agentThreadId,
                  input: "Create another program",
                },
              },
            ],
          };
        }
        if (resumedRootTurns === 2) {
          const continued = JSON.parse(request.toolResults![0]!.output) as {
            id: string;
            agentThreadId: string;
            followUpOf: string;
          };
          expect(continued.id).not.toBe(previousTaskId);
          expect(continued.agentThreadId).toBe(agentThreadId);
          expect(continued.followUpOf).toBe(previousTaskId);
          return {
            text: "Waiting for the continued worker.",
            toolCalls: [
              {
                id: "wait-continued-worker",
                name: "wait_for_agents",
                arguments: { agentIds: [agentThreadId] },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "Created another program",
        );
        return { text: "The second program is ready.", toolCalls: [] };
      },
    };
    const resumedServer = new AppServer({
      loop: new AgentLoop(resumedProvider),
      agent: defineAgent({ name: "threadlight", instructions: "Complete work" }),
      conversationStore: store,
      multiAgent: { profiles },
      send(message) {
        resumedMessages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          resumedCompleted.resolve();
        }
      },
    });

    await resumedServer.receive({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
    });
    await resumedServer.receive({
      jsonrpc: "2.0",
      id: 11,
      method: "thread/resume",
      params: { threadId },
    });
    await resumedServer.receive({
      jsonrpc: "2.0",
      id: 12,
      method: "turn/start",
      params: { threadId, input: "Ask the worker to continue" },
    });
    await resumedCompleted.promise;

    const resumedConversation = await store.load(threadId);
    expect(resumedConversation?.agentRuns).toHaveLength(2);
    const continuedRun = resumedConversation?.agentRuns?.[1];
    const continuedChild = continuedRun?.agents.find(
      ({ agent }) => agent.id !== continuedRun.rootId,
    );
    expect(continuedChild).toMatchObject({
      modelState: { workerRound: 2 },
      agent: {
        agentThreadId,
        followUpOf: previousTaskId,
        status: "completed",
        output: "Created another program",
      },
    });
    await resumedServer.dispose();
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
