import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { AppServer } from "@threadlight/app-server";
import type { JsonRpcOutgoing } from "@threadlight/protocol";
import { describe, expect, it } from "vitest";

import { classifyAutomationResult } from "../src/main/automation-scheduler.js";

describe("automation scripted provider flow", () => {
  it("runs an offline scheduled turn and projects its alert marker", async () => {
    const provider: ModelProvider = {
      generate: async () => ({
        text:
          "Dependency audit found one high severity advisory.\nAUTOMATION_STATUS: attention",
        toolCalls: [],
      }),
    };
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<{
      output: string;
      threadId: string;
    }>();
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted-automation",
        instructions: "Run the scheduled check without modifying files.",
      }),
      send(message) {
        messages.push(message);
        if (
          "method" in message &&
          message.method === "turn/completed"
        ) {
          completed.resolve(message.params);
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
      params: {
        threadId,
        input: "Run the dependency automation",
      },
    });

    const result = await completed.promise;
    expect(classifyAutomationResult({ output: result.output })).toEqual({
      status: "attention",
      summary: "Dependency audit found one high severity advisory.",
    });
  });
});
