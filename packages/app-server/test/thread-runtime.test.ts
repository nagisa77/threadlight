import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";
import {
  defaultTurnRuntimeModules,
  type TurnRuntimeModule,
} from "../src/turn-runtime-modules.js";

describe("thread runtimes", () => {
  it("runs scripted turns concurrently while preserving each thread state", async () => {
    const bothStarted = Promise.withResolvers<void>();
    const releases = new Map<string, () => void>();
    let activeGenerations = 0;
    const provider: ModelProvider = {
      async generate(request) {
        activeGenerations += 1;
        if (activeGenerations === 2) bothStarted.resolve();
        await new Promise<void>((resolve) => {
          releases.set(request.input, resolve);
        });
        activeGenerations -= 1;
        return { text: `completed: ${request.input}`, toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agentFactory: () =>
        defineAgent({ name: "test", instructions: "Reply independently" }),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    await server.receive({ jsonrpc: "2.0", id: 3, method: "thread/start" });
    const firstThread = result<{ threadId: string }>(messages, 2).threadId;
    const secondThread = result<{ threadId: string }>(messages, 3).threadId;

    await Promise.all([
      server.receive({
        jsonrpc: "2.0",
        id: 4,
        method: "turn/start",
        params: { threadId: firstThread, input: "first task" },
      }),
      server.receive({
        jsonrpc: "2.0",
        id: 5,
        method: "turn/start",
        params: { threadId: secondThread, input: "second task" },
      }),
    ]);
    await bothStarted.promise;

    expect(activeGenerations).toBe(2);
    expect(completedOutput(messages, firstThread)).toBeUndefined();
    expect(completedOutput(messages, secondThread)).toBeUndefined();

    const firstCompleted = notification(messages, firstThread);
    const secondCompleted = notification(messages, secondThread);
    releases.get("first task")?.();
    releases.get("second task")?.();
    await Promise.all([firstCompleted, secondCompleted]);

    expect(completedOutput(messages, firstThread)).toBe(
      "completed: first task",
    );
    expect(completedOutput(messages, secondThread)).toBe(
      "completed: second task",
    );
    await server.dispose();
  });

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

  it("loads a custom turn module without changing AppServer wiring", async () => {
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return { text: "module-ready", toolCalls: [] };
      },
    };
    const dispose = vi.fn();
    const customModule: TurnRuntimeModule = {
      id: "test.custom-turn-module",
      setup(_context, registrar) {
        registrar.addPromptBlocks([
          {
            id: "turn.custom-module",
            version: 1,
            authority: "turn",
            source: "test",
            content: "Custom module prompt.",
          },
        ]);
        registrar.addTools([
          defineTool({
            name: "custom_module_tool",
            description: "A tool contributed by a custom turn module",
            parameters: { type: "object", properties: {} },
            async execute() {
              return "ok";
            },
          }),
        ]);
        registrar.addController({
          beforeModel() {
            return { instructions: "Custom controller instruction." };
          },
        });
        return dispose;
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "test", instructions: "Base instruction." }),
      turnRuntimeModules: [...defaultTurnRuntimeModules(), customModule],
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    const completed = notification(messages, threadId);
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Run the module" },
    });
    await completed;

    expect(requests[0]?.instructions).toContain("Custom module prompt.");
    expect(requests[0]?.instructions).toContain(
      "Custom controller instruction.",
    );
    expect(requests[0]?.tools.map(({ name }) => name)).toContain(
      "custom_module_tool",
    );
    expect(completedOutput(messages, threadId)).toBe("module-ready");
    expect(dispose).toHaveBeenCalledOnce();
    await server.dispose();
  });
});

function result<Result>(
  messages: readonly JsonRpcOutgoing[],
  id: number,
): Result {
  const message = messages.find(
    (candidate) => "id" in candidate && candidate.id === id,
  );
  if (!message || !("result" in message))
    throw new Error(`Missing result ${id}`);
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
