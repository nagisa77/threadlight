import { describe, expect, it, vi } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import {
  DEFAULT_CONTEXT_RESERVE_TOKENS,
  DEFAULT_KEEP_RECENT_TOKENS,
} from "../src/context-compaction.js";
import { MemoryConversationStore } from "../src/conversation-store.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("rolling context compaction", () => {
  it("uses the Pi-compatible reserve and recent-context defaults", () => {
    expect(DEFAULT_CONTEXT_RESERVE_TOKENS).toBe(16_384);
    expect(DEFAULT_KEEP_RECENT_TOKENS).toBe(20_000);
  });

  it("checks again before later root model calls within the same turn", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    const normalRequests: ModelRequest[] = [];
    const summaryRequests: ModelRequest[] = [];
    let normalTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("durable rolling summary")) {
          summaryRequests.push(request);
          return {
            text: "ROOT-MIDRUN-SUMMARY",
            toolCalls: [],
            usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20 },
          };
        }
        normalRequests.push(request);
        normalTurns += 1;
        if (normalTurns <= 3) {
          return {
            text: `Reading batch ${normalTurns}`,
            toolCalls: [
              {
                id: `read-${normalTurns}`,
                name: "large_read",
                arguments: { batch: normalTurns },
              },
            ],
            state: { root: normalTurns },
            usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
          };
        }
        return {
          text: "Root completed after an in-turn compaction.",
          toolCalls: [],
          state: { root: 4 },
          usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "worker",
        instructions: "Read all batches and finish.",
        tools: [
          defineTool({
            name: "large_read",
            description: "Return a sizeable read-only batch",
            mutability: "read",
            parameters: { type: "object" },
            async execute() {
              return "root evidence ".repeat(200);
            },
          }),
        ],
      }),
      contextCompaction: {
        contextWindowTokens: 2_400,
        reserveTokens: 200,
        keepRecentTokens: 800,
      },
      conversationStore: store,
      send: (message) => messages.push(message),
    });

    const threadId = await start(server, messages);
    const completed = await runTurn(
      server,
      messages,
      threadId,
      10,
      "Read the large batches",
    );

    expect(normalRequests).toHaveLength(4);
    expect(summaryRequests).toHaveLength(1);
    expect(summaryRequests[0]?.input).toContain("root evidence");
    expect(normalRequests[3]).toMatchObject({
      state: undefined,
      input: undefined,
      toolResults: [],
    });
    expect(normalRequests[3]?.history?.[0]?.text).toContain(
      "ROOT-MIDRUN-SUMMARY",
    );
    expect(completed.params.message.contextCompaction).toMatchObject({
      status: "compacted",
      source: "automatic",
      generation: 1,
    });
    expect(completed.params.message.progress?.at(-1)).toMatchObject({
      text: "",
      activities: [],
      contextCompaction: {
        status: "compacted",
        source: "automatic",
        generation: 1,
      },
    });
    expect(
      (await store.load(threadId))?.messages.at(-1)?.progress?.at(-1),
    ).toMatchObject({ contextCompaction: { generation: 1 } });
    expect(completed.params.usage).toEqual({
      inputTokens: 95,
      outputTokens: 25,
      totalTokens: 120,
    });
    await server.dispose();
  });

  it("exposes @compact for existing tasks and compacts without ordinary model output", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (request.instructions.includes("durable rolling summary")) {
          expect(request.state).toBeUndefined();
          expect(request.tools).toEqual([]);
          expect(request.input).toContain("first request with old details");
          expect(request.input).not.toContain("second request stays recent");
          return {
            text: "The first request established OLD-DECISION.",
            toolCalls: [],
            usage: { inputTokens: 18, outputTokens: 8, totalTokens: 26 },
          };
        }
        return {
          text:
            requests.length === 1
              ? "first response with OLD-DECISION"
              : requests.length === 2
                ? "second response remains verbatim"
                : "continued after compaction",
          toolCalls: [],
          state: { response: requests.length },
          usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the task.",
      }),
      conversationStore: store,
      contextCompaction: {
        contextWindowTokens: 10_000,
        reserveTokens: 100,
        keepRecentTokens: 20,
      },
      send: (message) => messages.push(message),
    });

    const threadId = await start(server, messages);
    await runTurn(
      server,
      messages,
      threadId,
      10,
      "first request with old details",
    );
    await runTurn(
      server,
      messages,
      threadId,
      11,
      "second request stays recent",
    );

    await server.receive({
      jsonrpc: "2.0",
      id: 12,
      method: "capability/list",
      params: { threadId },
    });
    expect(
      result<{ capabilities: Array<{ id: string; kind: string }> }>(
        messages,
        12,
      ),
    ).toEqual({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "tool:compact", kind: "tool" }),
      ]),
    });

    const compacted = await runTurn(server, messages, threadId, 13, "", [
      "tool:compact",
    ]);
    expect(requests).toHaveLength(3);
    expect(compacted.params.message).toMatchObject({
      role: "assistant",
      text: "",
      contextCompaction: {
        status: "compacted",
        source: "manual",
        generation: 1,
        messagesCompacted: 2,
      },
    });

    const stored = await store.load(threadId);
    expect(stored?.modelState).toBeUndefined();
    expect(stored?.contextCompaction).toMatchObject({
      generation: 1,
      summary: "The first request established OLD-DECISION.",
      source: "manual",
      messagesCompacted: 2,
    });

    await runTurn(server, messages, threadId, 14, "continue now");
    const resumed = requests[3]!;
    expect(resumed.state).toBeUndefined();
    expect(resumed.history?.[0]?.text).toContain("OLD-DECISION");
    expect(resumed.history?.map(({ text }) => text).join("\n")).toContain(
      "second request stays recent",
    );
    expect(resumed.history?.map(({ text }) => text).join("\n")).not.toContain(
      "first request with old details",
    );
    expect(resumed.history?.some(({ text }) => text === "")).toBe(false);
    await server.dispose();
  });

  it("uses provider-observed context and resets oversized opaque state on manual compact", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return {
          text: "The task is complete and the durable result is recorded.",
          toolCalls: [],
          state: { opaqueConversation: ["system", "tools", "results"] },
          usage: {
            inputTokens: 23_781,
            outputTokens: 566,
            totalTokens: 24_347,
          },
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the task.",
      }),
      conversationStore: store,
      send: (message) => messages.push(message),
    });

    const threadId = await start(server, messages);
    await runTurn(server, messages, threadId, 15, "Build the requested app");
    expect((await store.load(threadId))?.modelState).toBeDefined();

    const compacted = await runTurn(server, messages, threadId, 16, "", [
      "tool:compact",
    ]);
    expect(requests).toHaveLength(1);
    expect(compacted.params.message.contextCompaction).toMatchObject({
      status: "compacted",
      source: "manual",
      generation: 1,
      tokensBefore: 24_347,
      messagesCompacted: 0,
    });
    expect(
      compacted.params.message.contextCompaction?.tokensAfter,
    ).toBeLessThan(24_347);
    expect((await store.load(threadId))?.modelState).toBeUndefined();
    await server.dispose();
  });

  it("automatically rolls the previous summary forward and retains the recent suffix verbatim", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const store = new MemoryConversationStore();
    let normalCalls = 0;
    let summaryCalls = 0;
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (request.instructions.includes("durable rolling summary")) {
          summaryCalls += 1;
          if (summaryCalls === 1) {
            expect(request.input).toContain("old turn alpha details");
            expect(request.input).not.toContain("middle turn beta details");
          } else {
            expect(request.input).toContain("SUMMARY-ONE");
            expect(request.input).toContain("middle turn beta details");
            expect(request.input).not.toContain("old turn alpha details");
          }
          return {
            text: summaryCalls === 1 ? "SUMMARY-ONE" : "SUMMARY-TWO",
            toolCalls: [],
            usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
          };
        }
        normalCalls += 1;
        return {
          text: `answer-${normalCalls} with retained detail`,
          toolCalls: [],
          state: { normal: normalCalls },
          usage:
            normalCalls === 1
              ? { inputTokens: 20, outputTokens: 5, totalTokens: 25 }
              : { inputTokens: 90, outputTokens: 5, totalTokens: 95 },
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the task.",
      }),
      conversationStore: store,
      contextCompaction: {
        contextWindowTokens: 100,
        reserveTokens: 20,
        keepRecentTokens: 20,
      },
      send: (message) => messages.push(message),
    });

    const threadId = await start(server, messages);
    await runTurn(server, messages, threadId, 20, "old turn alpha details");
    await runTurn(server, messages, threadId, 21, "middle turn beta details");
    const third = await runTurn(
      server,
      messages,
      threadId,
      22,
      "recent turn gamma details",
    );
    expect(third.params.message.contextCompaction).toMatchObject({
      status: "compacted",
      source: "automatic",
      generation: 1,
    });
    const thirdNormal = requests[3]!;
    expect(thirdNormal.state).toBeUndefined();
    expect(thirdNormal.history?.[0]?.text).toContain("SUMMARY-ONE");
    expect(thirdNormal.history?.map(({ text }) => text).join("\n")).toContain(
      "middle turn beta details",
    );
    expect(
      thirdNormal.history?.map(({ text }) => text).join("\n"),
    ).not.toContain("old turn alpha details");

    const fourth = await runTurn(
      server,
      messages,
      threadId,
      23,
      "new turn delta details",
    );
    expect(fourth.params.message.contextCompaction).toMatchObject({
      generation: 2,
      source: "automatic",
    });
    const fourthNormal = requests[5]!;
    expect(fourthNormal.history?.[0]?.text).toContain("SUMMARY-TWO");
    expect(fourthNormal.history?.map(({ text }) => text).join("\n")).toContain(
      "recent turn gamma details",
    );
    expect(
      fourthNormal.history?.map(({ text }) => text).join("\n"),
    ).not.toContain("middle turn beta details");
    expect((await store.load(threadId))?.contextCompaction).toMatchObject({
      generation: 2,
      summary: "SUMMARY-TWO",
    });
    await server.dispose();
  });
});

async function start(
  server: AppServer,
  messages: JsonRpcOutgoing[],
): Promise<string> {
  await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
  await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
  return result<{ threadId: string }>(messages, 2).threadId;
}

async function runTurn(
  server: AppServer,
  messages: JsonRpcOutgoing[],
  threadId: string,
  id: number,
  input: string,
  capabilityRefs?: readonly string[],
) {
  const previous = messages.filter(
    (message) => "method" in message && message.method === "turn/completed",
  ).length;
  await server.receive({
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: { threadId, input, ...(capabilityRefs ? { capabilityRefs } : {}) },
  });
  await vi.waitFor(() => {
    expect(
      messages.filter(
        (message) => "method" in message && message.method === "turn/completed",
      ),
    ).toHaveLength(previous + 1);
  });
  return messages.filter(
    (message) => "method" in message && message.method === "turn/completed",
  )[previous] as Extract<JsonRpcOutgoing, { method: "turn/completed" }>;
}

function result<Result>(messages: JsonRpcOutgoing[], id: number): Result {
  return messages.find((message) => "id" in message && message.id === id)
    ?.result as Result;
}
