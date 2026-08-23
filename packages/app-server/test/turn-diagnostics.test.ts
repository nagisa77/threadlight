import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  ToolExecutionError,
  defineAgent,
  defineTool,
  type ModelProvider,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing, TurnDiagnosticsData } from "../src/protocol.js";

describe("turn diagnostics", () => {
  it("exposes provider-confirmed live metrics from a scripted running turn", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const toolStarted = Promise.withResolvers<void>();
    const releaseTool = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    let generation = 0;
    const provider: ModelProvider = {
      async generate(_request, options) {
        generation += 1;
        if (generation === 1) {
          options?.onEvent?.({ type: "output_text.delta", delta: "检查" });
          return {
            text: "检查",
            toolCalls: [{ id: "hold-1", name: "hold", arguments: {} }],
            usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
          };
        }
        return {
          text: "done",
          toolCalls: [],
          usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted-live-metrics",
        instructions: "Reply",
        tools: [
          defineTool({
            name: "hold",
            description: "Keep the turn running",
            parameters: { type: "object" },
            async execute() {
              toolStarted.resolve();
              await releaseTool.promise;
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
    await toolStarted.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    const resumed = messages.find(
      (message) => "id" in message && message.id === 4,
    );
    releaseTool.resolve();
    await completed.promise;

    expect(resumed).toMatchObject({
      result: {
        activeTurn: {
          metrics: {
            usage: {
              inputTokens: 120,
              outputTokens: 24,
              totalTokens: 144,
            },
            completedModelSteps: 1,
            streamedBytes: new TextEncoder().encode("检查").byteLength,
          },
        },
      },
    });
  });

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
              toolCalls: [{ id: "check-1", name: "check", arguments: {} }],
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
      (message) => "method" in message && message.method === "turn/completed",
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
        messages: [{ role: "user" }, { role: "assistant" }],
      },
    });
    expect(
      (resumed as { result?: { messages?: unknown[] } }).result?.messages?.[1],
    ).not.toHaveProperty("diagnostics");
  });

  it("separates root, child, and total metrics for a scripted multi-agent turn", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    let rootTurns = 0;
    let childTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childTurns += 1;
          return childTurns === 1
            ? {
                text: "inspecting",
                toolCalls: [
                  { id: "child-check", name: "check", arguments: {} },
                ],
                usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
              }
            : {
                text: "child complete",
                toolCalls: [],
                usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
              };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "delegating",
            toolCalls: [
              {
                id: "spawn-explorer",
                name: "spawn_agent",
                arguments: { role: "explorer", task: "Inspect the workspace" },
              },
            ],
            usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          };
        }
        if (rootTurns === 2) {
          return {
            text: "collecting",
            toolCalls: [
              { id: "wait-explorer", name: "wait_for_agents", arguments: {} },
            ],
            usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
          };
        }
        return {
          text: "done",
          toolCalls: [],
          usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
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
            mutability: "read",
            async execute() {
              return "ok";
            },
          }),
        ],
      }),
      multiAgent: {
        profiles: [
          {
            name: "explorer",
            description: "Inspect",
            instructions: "Inspect read-only",
            toolAccess: "read-only",
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
      params: { threadId, input: "Inspect" },
    });
    await completed.promise;

    const notification = messages.find(
      (message) => "method" in message && message.method === "turn/completed",
    );
    expect(notification).toMatchObject({
      params: {
        diagnostics: {
          usage: { inputTokens: 16, outputTokens: 6, totalTokens: 22 },
          toolCalls: [
            { callId: "spawn-explorer" },
            { callId: "wait-explorer" },
          ],
          metrics: {
            root: {
              usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
              modelSteps: [
                { agentRole: "root" },
                { agentRole: "root" },
                { agentRole: "root" },
              ],
              toolCalls: [
                { callId: "spawn-explorer", agentRole: "root" },
                { callId: "wait-explorer", agentRole: "root" },
              ],
            },
            children: {
              usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
              modelSteps: [
                { agentRole: "explorer", usage: { totalTokens: 3 } },
                { agentRole: "explorer", usage: { totalTokens: 3 } },
              ],
              toolCalls: [{ callId: "child-check", agentRole: "explorer" }],
            },
            total: {
              usage: { inputTokens: 16, outputTokens: 6, totalTokens: 22 },
              modelSteps: expect.arrayContaining([
                expect.objectContaining({ agentRole: "root" }),
                expect.objectContaining({ agentRole: "explorer" }),
              ]),
              toolCalls: expect.arrayContaining([
                expect.objectContaining({
                  callId: "spawn-explorer",
                  agentRole: "root",
                }),
                expect.objectContaining({
                  callId: "child-check",
                  agentRole: "explorer",
                }),
              ]),
            },
          },
        },
      },
    });
    const diagnostics = (
      notification as { params: { diagnostics: TurnDiagnosticsData } }
    ).params.diagnostics;
    expect(diagnostics.modelSteps).toHaveLength(3);
    expect(diagnostics.toolCalls).toHaveLength(2);
    expect(diagnostics.metrics.total.modelSteps).toHaveLength(5);
    expect(diagnostics.metrics.total.toolCalls).toHaveLength(3);
  });

  it("persists scripted tool error codes for badcase exports", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    let generation = 0;
    const provider: ModelProvider = {
      async generate() {
        generation += 1;
        return generation === 1
          ? {
              text: "checking",
              toolCalls: [{ id: "check-1", name: "check", arguments: {} }],
            }
          : { text: "handled", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Reply",
        tools: [
          defineTool({
            name: "check",
            description: "Check",
            parameters: { type: "object" },
            async execute() {
              throw new ToolExecutionError("The check failed", {
                code: "scripted_check_failed",
                retryable: false,
              });
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

    const notification = messages.find(
      (message) => "method" in message && message.method === "turn/completed",
    );
    expect(notification).toMatchObject({
      params: {
        diagnostics: {
          toolCalls: [
            {
              callId: "check-1",
              isError: true,
              errorCode: "scripted_check_failed",
            },
          ],
        },
      },
    });
  });
});
