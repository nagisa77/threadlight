import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("thread runtimes", () => {
  it("isolates runtime tools per thread and disposes them automatically", async () => {
    const provider: ModelProvider = {
      async generate(request) {
        if (!request.toolResults?.length) {
          return {
            text: "",
            toolCalls: [
              {
                id: `runtime-${Math.random()}`,
                name: "thread_runtime_id",
                arguments: {},
              },
            ],
          };
        }
        return {
          text: request.toolResults[0]?.output ?? "missing runtime",
          toolCalls: [],
        };
      },
    };
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    let runtimeNumber = 0;
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "test", instructions: "Use the runtime" }),
      threadRuntimeFactory() {
        runtimeNumber += 1;
        const value = `thread-runtime-${runtimeNumber}`;
        const dispose = vi.fn(async () => undefined);
        disposers.push(dispose);
        return {
          tools: [
            defineTool({
              name: "thread_runtime_id",
              description: "Return the private runtime id",
              parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
              async execute() {
                return value;
              },
            }),
          ],
          dispose,
        };
      },
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    await server.receive({ jsonrpc: "2.0", id: 3, method: "thread/start" });
    const firstThread = result<{ threadId: string }>(messages, 2).threadId;
    const secondThread = result<{ threadId: string }>(messages, 3).threadId;

    const firstCompleted = notification(messages, firstThread);
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/start",
      params: { threadId: firstThread, input: "Identify the runtime" },
    });
    await firstCompleted;
    const secondCompleted = notification(messages, secondThread);
    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "turn/start",
      params: { threadId: secondThread, input: "Identify the runtime" },
    });
    await secondCompleted;

    expect(completedOutput(messages, firstThread)).toBe("thread-runtime-1");
    expect(completedOutput(messages, secondThread)).toBe("thread-runtime-2");

    await server.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "thread/delete",
      params: { threadId: firstThread },
    });
    expect(disposers[0]).toHaveBeenCalledOnce();
    expect(disposers[1]).not.toHaveBeenCalled();

    await server.dispose();
    expect(disposers[1]).toHaveBeenCalledOnce();
  });
});

function result<Result>(
  messages: readonly JsonRpcOutgoing[],
  id: number,
): Result {
  const message = messages.find(
    (candidate) => "id" in candidate && candidate.id === id,
  );
  if (!message || !("result" in message)) throw new Error(`Missing result ${id}`);
  return message.result as Result;
}

function notification(
  messages: JsonRpcOutgoing[],
  threadId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      if (
        messages.some(
          (message) =>
            "method" in message &&
            message.method === "turn/completed" &&
            (message.params as { threadId?: string }).threadId === threadId,
        )
      ) {
        resolve();
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

function completedOutput(
  messages: readonly JsonRpcOutgoing[],
  threadId: string,
): string | undefined {
  const message = messages.find(
    (candidate) =>
      "method" in candidate &&
      candidate.method === "turn/completed" &&
      (candidate.params as { threadId?: string }).threadId === threadId,
  );
  return (message?.params as { output?: string } | undefined)?.output;
}
