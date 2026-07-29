import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("turn diagnostics", () => {
  it("persists scripted token, model-step, and tool timing snapshots", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    let generation = 0;
    const provider: ModelProvider = {
      async generate() {
        generation += 1;
        return generation === 1
          ? {
              text: "checking",
              toolCalls: [
                { id: "check-1", name: "check", arguments: {} },
              ],
              usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
            }
          : {
              text: "done",
              toolCalls: [],
              usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      modelName: "scripted-model",
      agent: defineAgent({
        name: "scripted",
        instructions: "Reply",
        tools: [
          defineTool({
            name: "check",
            description: "Check",
            parameters: { type: "object" },
            async execute() {
              return "ok";
            },
          }),
        ],
      }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });
    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Check" },
    });
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    const completedNotification = messages.find(
      (message) =>
        "method" in message && message.method === "turn/completed",
    );
    expect(completedNotification).toMatchObject({
      params: {
        diagnostics: {
          status: "completed",
          model: "scripted-model",
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
          modelSteps: [
            { step: 1, usage: { totalTokens: 7 } },
            { step: 2, usage: { totalTokens: 5 } },
          ],
          toolCalls: [{ callId: "check-1", name: "check", isError: false }],
        },
      },
    });
    const resumed = messages.find(
      (message) => "id" in message && message.id === 4,
    );
    expect(resumed).toMatchObject({
      result: {
        messages: [
          { role: "user" },
          {
            role: "assistant",
            diagnostics: {
              durationMs: expect.any(Number),
              modelSteps: [
                { durationMs: expect.any(Number) },
                { durationMs: expect.any(Number) },
              ],
              toolCalls: [{ durationMs: expect.any(Number) }],
            },
          },
        ],
      },
    });
  });
});
