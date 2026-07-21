import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
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
  });
});
