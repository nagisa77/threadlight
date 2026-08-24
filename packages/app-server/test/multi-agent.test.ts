import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  modelConversationMessageText,
  type ModelProvider,
} from "@threadlight/agent-loop";
import type {
  AgentThreadData,
  ConversationMessageData,
  JsonRpcOutgoing,
} from "@threadlight/protocol";

import { AppServer } from "../src/app-server.js";
import { MemoryConversationStore } from "../src/conversation-store.js";
import { latestTree, result } from "./multi-agent-test-support.js";

describe("AppServer multi-agent runtime", () => {
  it("compacts each child independently before its model calls and persists the fallback", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    const completed = Promise.withResolvers<void>();
    const childRequests: Parameters<ModelProvider["generate"]>[0][] = [];
    const summaryInputs: string[] = [];
    let rootTurns = 0;
    let childTurns = 0;
    const largeEvidence = "large tool evidence ".repeat(800);
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("durable rolling summary")) {
          summaryInputs.push(request.input ?? "");
          return {
            text: request.input?.includes("Inspect large context")
              ? "CHILD-SUMMARY"
              : "ROOT-SUMMARY",
            toolCalls: [],
            usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
          };
        }
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childRequests.push(request);
          childTurns += 1;
          if (childTurns < 3) {
            return {
              text: `Inspecting batch ${childTurns}`,
              toolCalls: [
                {
                  id: `inspect-${childTurns}`,
                  name: "inspect_large",
                  arguments: { batch: childTurns },
                },
              ],
              state: { child: childTurns },
              usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
            };
          }
          return {
            text: "Child completed after compaction.",
            toolCalls: [],
            state: { child: 3 },
            usage: { inputTokens: 900, outputTokens: 50, totalTokens: 950 },
          };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Delegating.",
            toolCalls: [
              {
                id: "spawn-compact-child",
                name: "spawn_agent",
                arguments: {
                  role: "explorer",
                  task: "Inspect large context",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Waiting.",
            toolCalls: [
              {
                id: "wait-compact-child",
                name: "wait_for_agents",
                arguments: {},
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "Child completed after compaction",
        );
        return { text: "Integrated compacted child.", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
        tools: [
          defineTool({
            name: "inspect_large",
            description: "Return a large read-only result",
            mutability: "read",
            parameters: { type: "object" },
            async execute() {
              return largeEvidence;
            },
          }),
        ],
      }),
      conversationStore: store,
      contextCompaction: {
        contextWindowTokens: 1_000,
        reserveTokens: 100,
        keepRecentTokens: 200,
      },
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
        if (
          "method" in message &&
          (message.method === "turn/completed" ||
            message.method === "turn/failed")
        ) {
          completed.resolve();
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
      params: { threadId, input: "Exercise child compaction" },
    });
    await completed.promise;

    expect(childRequests).toHaveLength(3);
    expect(childRequests[1]).toMatchObject({
      state: undefined,
      input: undefined,
      toolResults: [],
    });
    expect(
      childRequests[1]?.history?.map(modelConversationMessageText).join("\n"),
    ).toContain("large tool evidence");
    expect(childRequests[2]?.history?.[0]?.text).toContain("CHILD-SUMMARY");
    expect(
      summaryInputs.some((input) => input.includes("Inspect large context")),
    ).toBe(true);

    const conversation = await store.load(threadId);
    const run = conversation?.agentRuns?.[0];
    const child = run?.agents.find(({ agent }) => agent.id !== run.rootId);
    expect(child).toMatchObject({
      modelState: { child: 3 },
      contextTokens: 950,
      checkpointPhase: "model_completed",
    });
    expect(child?.contextHistory?.[0]?.text).toContain("CHILD-SUMMARY");
    expect(child?.agent.usage).toEqual({
      inputTokens: 920,
      outputTokens: 55,
      totalTokens: 975,
    });
    const childThreadId = child!.agent.agentThreadId!;
    await server.dispose();

    const resumedMessages: JsonRpcOutgoing[] = [];
    const resumedCompleted = Promise.withResolvers<void>();
    let resumedRootTurns = 0;
    const resumedServer = new AppServer({
      loop: new AgentLoop({
        async generate(request) {
          if (request.instructions.includes("durable rolling summary")) {
            return {
              text: "CHILD-SUMMARY RESUMED",
              toolCalls: [],
            };
          }
          if (request.instructions.includes("SUBAGENT ROLE")) {
            expect(request.input).toBeUndefined();
            expect(request.state).toBeUndefined();
            expect(request.history?.[0]?.text).toContain(
              "CHILD-SUMMARY RESUMED",
            );
            expect(
              request.history?.map(({ text }) => text).join("\n"),
            ).toContain("Continue compacted child");
            return {
              text: "Resumed compacted child.",
              toolCalls: [],
              state: { child: 4 },
            };
          }
          resumedRootTurns += 1;
          if (resumedRootTurns === 1) {
            return {
              text: "Continuing child.",
              toolCalls: [
                {
                  id: "follow-up-compacted-child",
                  name: "follow_up_agent",
                  arguments: {
                    agentId: childThreadId,
                    input: "Continue compacted child",
                  },
                },
              ],
            };
          }
          if (resumedRootTurns === 2) {
            return {
              text: "Waiting for child.",
              toolCalls: [
                {
                  id: "wait-resumed-compacted-child",
                  name: "wait_for_agents",
                  arguments: { agentIds: [childThreadId] },
                },
              ],
            };
          }
          expect(
            [
              request.toolResults?.[0]?.output,
              ...(request.history?.map(modelConversationMessageText) ?? []),
            ].join("\n"),
          ).toContain("Resumed compacted child");
          return { text: "Integrated resumed child.", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
      }),
      conversationStore: store,
      contextCompaction: {
        contextWindowTokens: 1_000,
        reserveTokens: 100,
        keepRecentTokens: 200,
      },
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
        resumedMessages.push(message);
        if (
          "method" in message &&
          (message.method === "turn/completed" ||
            message.method === "turn/failed")
        ) {
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
      params: { threadId, input: "Resume compacted work" },
    });
    await resumedCompleted.promise;
    const resumedCompletion = resumedMessages.find(
      (message) =>
        "method" in message &&
        (message.method === "turn/completed" ||
          message.method === "turn/failed"),
    );
    expect(resumedCompletion).toMatchObject({ method: "turn/completed" });
    expect(
      (resumedCompletion as { params: { output: string } }).params.output,
    ).toBe("Integrated resumed child.");
    await resumedServer.dispose();
  });

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
    const liveAgentNotifications = messages.filter(
      (message) =>
        "method" in message &&
        (message.method === "agent/tree-updated" ||
          message.method === "agent/event"),
    );
    expect(
      liveAgentNotifications.some(
        (message) =>
          "method" in message && message.method === "agent/tree-updated",
      ),
    ).toBe(true);
    for (const notification of liveAgentNotifications) {
      expect(
        (notification.params as { activeTurn?: unknown }).activeTurn,
      ).not.toHaveProperty("agentTree");
    }

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
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
      }),
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
      agent: defineAgent({
        name: "threadlight",
        instructions: "Complete work",
      }),
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

  it("persists an explicit close across parent turns and rejects later follow-up with agent_closed", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    let completed = Promise.withResolvers<void>();
    let rootTurns = 0;
    let agentThreadId = "";
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          return {
            text: "Persistent worker result",
            toolCalls: [],
            state: { workerRound: 1 },
          };
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting a persistent worker.",
            toolCalls: [
              {
                id: "spawn-persistent-worker",
                name: "spawn_agent",
                arguments: { role: "worker", task: "Create the first result" },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          const spawned = JSON.parse(request.toolResults![0]!.output) as {
            agentThreadId: string;
          };
          agentThreadId = spawned.agentThreadId;
          return {
            text: "Waiting for the worker.",
            toolCalls: [
              {
                id: "wait-persistent-worker",
                name: "wait_for_agents",
                arguments: { agentIds: [agentThreadId] },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          expect(request.toolResults?.[0]?.output).toContain(
            "Persistent worker result",
          );
          return { text: "The initial task is complete.", toolCalls: [] };
        }
        if (rootTurns === 4) {
          return {
            text: "Closing the persisted worker thread.",
            toolCalls: [
              {
                id: "close-persistent-worker",
                name: "close_agent",
                arguments: { agentId: agentThreadId },
              },
            ],
          };
        }
        if (rootTurns === 5) {
          expect(request.toolResults?.[0]?.isError).toBeUndefined();
          return { text: "The worker thread is closed.", toolCalls: [] };
        }
        if (rootTurns === 6) {
          return {
            text: "Checking that close survives the next turn.",
            toolCalls: [
              {
                id: "follow-up-closed-worker",
                name: "follow_up_agent",
                arguments: {
                  agentId: agentThreadId,
                  input: "Create another result",
                },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]).toMatchObject({
          isError: true,
          error: { code: "agent_closed", retryable: false },
        });
        return { text: "The explicit close is durable.", toolCalls: [] };
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
            name: "worker",
            description: "Implement programs",
            instructions: "Implement and verify the requested program",
            toolAccess: "all",
          },
        ],
      },
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 20, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 21, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 21).threadId;

    await server.receive({
      jsonrpc: "2.0",
      id: 22,
      method: "turn/start",
      params: { threadId, input: "Create a result" },
    });
    await completed.promise;

    completed = Promise.withResolvers<void>();
    await server.receive({
      jsonrpc: "2.0",
      id: 23,
      method: "turn/start",
      params: { threadId, input: "Close that worker" },
    });
    await completed.promise;
    const closedConversation = await store.load(threadId);
    expect(
      closedConversation?.agentRuns
        ?.flatMap(({ agents }) => agents)
        .filter(({ agent }) => agent.agentThreadId === agentThreadId),
    ).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ closedAt: expect.any(String) }),
      }),
    ]);

    completed = Promise.withResolvers<void>();
    await server.receive({
      jsonrpc: "2.0",
      id: 24,
      method: "turn/start",
      params: { threadId, input: "Continue that worker" },
    });
    await completed.promise;

    expect(rootTurns).toBe(7);
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

  it("restores root-only agent activity with the transport failure that stopped it", async () => {
    const store = new MemoryConversationStore();
    store.create({
      version: 1,
      threadId: "thread-root-only",
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:01.000Z",
      messages: [
        { id: "user-1", role: "user", text: "Diagnose the transport" },
      ],
      agentRuns: [
        {
          version: 1,
          turnId: "turn-root-only",
          rootId: "root-agent",
          maxConcurrent: 3,
          status: "active",
          createdAt: "2026-08-10T08:00:00.000Z",
          updatedAt: "2026-08-10T08:00:01.000Z",
          agents: [
            {
              pendingInput: [],
              collected: false,
              agent: {
                id: "root-agent",
                name: "threadlight",
                role: "root",
                task: "Diagnose the transport",
                status: "running",
                phase: "working",
                createdAt: "2026-08-10T08:00:00.000Z",
                startedAt: "2026-08-10T08:00:00.000Z",
                elapsedMs: 1_000,
                activities: [
                  { id: "tool-1", name: "exec_command", status: "running" },
                ],
                transcript: [
                  {
                    id: "model:1",
                    kind: "model",
                    step: 1,
                    status: "completed",
                    text: "Inspecting output backpressure.",
                    startedAt: "2026-08-10T08:00:00.000Z",
                    completedAt: "2026-08-10T08:00:00.500Z",
                    durationMs: 500,
                    usage: {
                      inputTokens: 4,
                      outputTokens: 2,
                      totalTokens: 6,
                    },
                  },
                  {
                    id: "tool-1",
                    kind: "tool",
                    name: "exec_command",
                    status: "running",
                    arguments: '{"cmd":"npm test"}',
                    startedAt: "2026-08-10T08:00:00.500Z",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop({
        async generate() {
          return { text: "unused", toolCalls: [] };
        },
      }),
      agent: defineAgent({ name: "threadlight", instructions: "Work" }),
      conversationStore: store,
      send: (message) => messages.push(message),
    });
    const transportError =
      "App-server output transport failed: JSON line output exceeded 67108864 buffered bytes";

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/resume",
      params: {
        threadId: "thread-root-only",
        runtimeError: transportError,
      },
    });

    const resumed = result<{
      messages: readonly ConversationMessageData[];
    }>(messages, 2);
    expect(resumed.messages.at(-1)).toMatchObject({
      id: "agent-interrupted:turn-root-only",
      error: true,
      text: expect.stringContaining(transportError),
      agentTree: {
        rootId: "root-agent",
        agents: [
          expect.objectContaining({
            id: "root-agent",
            status: "interrupted",
            transcript: expect.arrayContaining([
              expect.objectContaining({ id: "model:1" }),
              expect.objectContaining({ id: "tool-1" }),
            ]),
          }),
        ],
      },
    });
    await server.dispose();
  });
});
