import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { AppServer } from "@threadlight/app-server";
import {
  ThreadlightClient,
  type ClientTransport,
} from "@threadlight/client";
import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

class LoopbackTransport implements ClientTransport {
  private listener?: (message: JsonRpcOutgoing) => void;
  private receiver?: (message: JsonRpcRequest) => Promise<void>;

  connect(receiver: (message: JsonRpcRequest) => Promise<void>): void {
    this.receiver = receiver;
  }

  send(message: JsonRpcRequest): Promise<void> {
    if (!this.receiver) throw new Error("Transport is not connected");
    return this.receiver(message);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  receive(message: JsonRpcOutgoing): void {
    this.listener?.(message);
  }
}

describe("client and app-server integration", () => {
  it("runs a turn through the shared protocol", async () => {
    const provider: ModelProvider = {
      async generate(_request, options) {
        options?.onEvent?.({
          type: "output_text.delta",
          delta: "Hello from ",
        });
        options?.onEvent?.({
          type: "output_text.delta",
          delta: "Threadlight",
        });
        return { text: "Hello from Threadlight", toolCalls: [] };
      },
    };
    const transport = new LoopbackTransport();
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "test", instructions: "Reply" }),
      send: (message) => transport.receive(message),
    });
    transport.connect((message) => server.receive(message));

    const client = new ThreadlightClient(transport);
    const eventOrder: string[] = [];
    client.on("agent/event", ({ event }) => {
      if (event.type === "model.output_text.delta") {
        eventOrder.push(`delta:${event.delta}`);
      }
    });
    const completed = new Promise<string>((resolve) => {
      client.on("turn/completed", ({ output }) => {
        eventOrder.push("completed");
        resolve(output);
      });
    });

    await client.initialize();
    const { threadId } = await client.startThread();
    const { turnId } = await client.startTurn(threadId, "Hello");

    await expect(completed).resolves.toBe("Hello from Threadlight");
    expect(turnId).toEqual(expect.any(String));
    expect(eventOrder).toEqual([
      "delta:Hello from ",
      "delta:Threadlight",
      "completed",
    ]);
  });
});
