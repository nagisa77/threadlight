import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import { CONTINUE_INTERRUPTED_TURN_INPUT } from "../src/app-server-turn-queue.js";
import { MemoryConversationStore } from "../src/conversation-store.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("turn continuation", () => {
  it("continues a user-interrupted task with an offline scripted provider", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const firstStarted = Promise.withResolvers<void>();
    const interrupted = Promise.withResolvers<void>();
    const continued = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    const conversationStore = new MemoryConversationStore();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          firstStarted.resolve();
          await new Promise<never>((_resolve, reject) => {
            const abort = () =>
              reject(
                request.signal?.reason ?? new Error("Scripted interruption"),
              );
            request.signal?.addEventListener("abort", abort, { once: true });
            if (request.signal?.aborted) abort();
          });
        }
        return {
          text: "Continued without repeating completed work",
          toolCalls: [],
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "worker", instructions: "Complete the task" }),
      conversationStore,
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/failed") {
          interrupted.resolve();
        }
        if ("method" in message && message.method === "turn/completed") {
          continued.resolve();
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
      params: { threadId, input: "Implement resumable interrupted tasks" },
    });
    await firstStarted.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/interrupt",
      params: { threadId },
    });
    await interrupted.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      (await conversationStore.load(threadId))?.messages.at(-1),
    ).toMatchObject({
      role: "assistant",
      error: true,
      interrupted: true,
    });

    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });
    expect(
      messages.find((message) => "id" in message && message.id === 5),
    ).toMatchObject({
      result: {
        continuationAvailable: true,
        messages: [
          expect.objectContaining({
            role: "user",
            text: "Implement resumable interrupted tasks",
          }),
        ],
      },
    });

    await server.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "turn/start",
      params: { threadId, input: "", continuation: true },
    });
    await continued.promise;

    expect(requests.map(({ input }) => input)).toEqual([
      "Implement resumable interrupted tasks",
      CONTINUE_INTERRUPTED_TURN_INPUT,
    ]);
    const stored = (await conversationStore.load(threadId))?.messages ?? [];
    expect(stored).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "继续" }),
      ]),
    );
    expect(stored.at(-1)).toMatchObject({
      role: "assistant",
      text: "Continued without repeating completed work",
    });
    expect(
      messages.find((message) => "id" in message && message.id === 6),
    ).toMatchObject({ result: { turnId: expect.any(String) } });
    await server.dispose();
  });
});
