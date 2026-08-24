import { describe, expect, it, vi } from "vitest";

import {
  AgentLoop,
  defineAgent,
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
