import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("AppServer", () => {
  it("runs a turn and streams completion notifications", async () => {
    const provider: ModelProvider = {
      async generate() {
        return { text: "Hello from Threadlight", toolCalls: [] };
      },
    };

    const messages: JsonRpcOutgoing[] = [];
    let completeTurn: ((message: JsonRpcOutgoing) => void) | undefined;
    const completed = new Promise<JsonRpcOutgoing>((resolve) => {
      completeTurn = resolve;
    });

    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "test", instructions: "Reply" }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completeTurn?.(message);
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });

    const threadResponse = messages.find(
      (message) => "id" in message && message.id === 2,
    );
    const threadId = (threadResponse?.result as { threadId: string }).threadId;

    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Hello" },
    });

    const notification = await completed;
    expect(notification).toMatchObject({
      method: "turn/completed",
      params: { threadId, output: "Hello from Threadlight" },
    });

    const modelCompleted = messages.find(
      (message) =>
        "method" in message &&
        message.method === "agent/event" &&
        (message.params as { event?: { type?: string } }).event?.type ===
          "model.completed",
    );
    expect(modelCompleted).toMatchObject({
      method: "agent/event",
      params: {
        threadId,
        event: {
          type: "model.completed",
          step: 1,
          text: "Hello from Threadlight",
          toolCalls: [],
        },
      },
    });
  });

  it("automatically approves protected tools when configured", async () => {
    let generation = 0;
    let executions = 0;
    const provider: ModelProvider = {
      async generate(request) {
        generation += 1;
        if (generation === 1) {
          return {
            text: "",
            toolCalls: [
              { id: "call_1", name: "protected_tool", arguments: {} },
            ],
          };
        }
        return {
          text: `Tool result: ${request.toolResults?.[0]?.output}`,
          toolCalls: [],
        };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    let completeTurn: ((message: JsonRpcOutgoing) => void) | undefined;
    const completed = new Promise<JsonRpcOutgoing>((resolve) => {
      completeTurn = resolve;
    });
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "test",
        instructions: "Use the protected tool",
        tools: [
          defineTool({
            name: "protected_tool",
            description: "Test protected execution",
            parameters: { type: "object" },
            needsApproval: true,
            async execute() {
              executions += 1;
              return "approved";
            },
          }),
        ],
      }),
      autoApproveAll: true,
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completeTurn?.(message);
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadResponse = messages.find(
      (message) => "id" in message && message.id === 2,
    );
    const threadId = (threadResponse?.result as { threadId: string }).threadId;

    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Run it" },
    });

    await expect(completed).resolves.toMatchObject({
      method: "turn/completed",
      params: { output: "Tool result: approved" },
    });
    expect(executions).toBe(1);
  });
});
