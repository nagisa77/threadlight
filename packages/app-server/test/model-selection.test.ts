import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  type ModelRequest,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { createRoutingModelProvider } from "@threadlight/model-providers";

import { AppServer } from "../src/app-server.js";
import { MemoryConversationStore } from "../src/conversation-store.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";
import { MemorySuggestionStore } from "../src/suggestion-store.js";

function scriptedProvider(
  onGenerate: (request: ModelRequest) => void,
): ModelProvider {
  return {
    async generate(request) {
      onGenerate(request);
      return { text: `answered:${request.model ?? "default"}`, toolCalls: [] };
    },
  };
}

function completedTurn(messages: JsonRpcOutgoing[]): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (
        messages.some(
          (message) =>
            "method" in message && message.method === "turn/completed",
        )
      ) {
        resolve();
      }
    };
    const interval = setInterval(check, 5);
    check();
    messages.push = new Proxy(messages.push, {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        check();
        return result;
      },
    });
  });
}

describe("per-conversation model selection", () => {
  it("routes a turn to the selected provider and persists the selection", async () => {
    const openaiRequests: ModelRequest[] = [];
    const deepseekRequests: ModelRequest[] = [];
    const router = createRoutingModelProvider({
      providers: {
        openai: scriptedProvider((request) => openaiRequests.push(request)),
        deepseek: scriptedProvider((request) => deepseekRequests.push(request)),
      },
      defaultProvider: "openai",
    });
    const conversationStore = new MemoryConversationStore();
    const messages: JsonRpcOutgoing[] = [];
    const completed = completedTurn(messages);
    const server = new AppServer({
      loop: new AgentLoop(router),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the requested work",
        tools: [],
      }),
      conversationStore,
      suggestionStore: new MemorySuggestionStore(),
      send: (message) => messages.push(message),
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
        input: "用 DeepSeek 帮我改这段代码",
        provider: "deepseek",
        model: "deepseek-v4-flash",
      },
    });
    await completed;

    expect(openaiRequests).toHaveLength(0);
    expect(deepseekRequests).toHaveLength(1);
    expect(deepseekRequests[0]).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });

    const stored = await conversationStore.load(threadId);
    expect(stored).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
    });
    await server.dispose();
  });

  it("restores the persisted provider/model on resume and uses it for later turns", async () => {
    const requests: ModelRequest[] = [];
    const router = createRoutingModelProvider({
      providers: {
        openai: scriptedProvider((request) => requests.push(request)),
        deepseek: scriptedProvider((request) => requests.push(request)),
      },
      defaultProvider: "openai",
    });
    const conversationStore = new MemoryConversationStore();

    async function startTurnWithSelection(): Promise<string> {
      const messages: JsonRpcOutgoing[] = [];
      const completed = completedTurn(messages);
      const server = new AppServer({
        loop: new AgentLoop(router),
        agent: defineAgent({
          name: "worker",
          instructions: "Complete the requested work",
          tools: [],
        }),
        conversationStore,
        suggestionStore: new MemorySuggestionStore(),
        send: (message) => messages.push(message),
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
          input: "选 Kimi 模型",
          provider: "kimi",
          model: "kimi-k2.6",
        },
      });
      await completed;
      await server.dispose();
      return threadId;
    }

    const threadId = await startTurnWithSelection();

    // A fresh runtime (like after a settings restart) resumes the thread and
    // reports the persisted selection.
    const resumedMessages: JsonRpcOutgoing[] = [];
    const resumed = new AppServer({
      loop: new AgentLoop(router),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the requested work",
        tools: [],
      }),
      conversationStore,
      suggestionStore: new MemorySuggestionStore(),
      send: (message) => resumedMessages.push(message),
    });
    await resumed.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await resumed.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/resume",
      params: { threadId },
    });
    const resumedResult = resumedMessages.find(
      (message) => "id" in message && message.id === 2,
    )?.result as {
      provider?: string;
      model?: string;
    };
    expect(resumedResult).toMatchObject({
      provider: "kimi",
      model: "kimi-k2.6",
    });

    // A later turn without an explicit selection keeps routing to Kimi.
    const continued = completedTurn(resumedMessages);
    await resumed.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "继续" },
    });
    await continued;
    const lastRequest = requests.at(-1);
    expect(lastRequest).toMatchObject({
      provider: "kimi",
      model: "kimi-k2.6",
    });
    await resumed.dispose();
  });

  it("starts a turn on a fresh runtime without an explicit resume", async () => {
    const conversationStore = new MemoryConversationStore();
    const openaiRequests: ModelRequest[] = [];
    const router = createRoutingModelProvider({
      providers: {
        openai: scriptedProvider((request) => openaiRequests.push(request)),
      },
      defaultProvider: "openai",
    });

    // The original runtime: start the thread and complete a turn so the
    // conversation is persisted to the shared store.
    const firstMessages: JsonRpcOutgoing[] = [];
    const firstCompleted = completedTurn(firstMessages);
    const firstServer = new AppServer({
      loop: new AgentLoop(router),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the requested work",
        tools: [],
      }),
      conversationStore,
      suggestionStore: new MemorySuggestionStore(),
      send: (message) => firstMessages.push(message),
    });
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 100,
      method: "initialize",
    });
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "thread/start",
    });
    const threadId = (
      firstMessages.find((message) => "id" in message && message.id === 1)
        ?.result as { threadId: string }
    ).threadId;
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "turn/start",
      params: { threadId, input: "第一轮" },
    });
    await firstCompleted;
    await firstServer.dispose();

    // The "restart": a brand-new AppServer with the same store. No resume is
    // issued, yet startTurn must lazily restore the thread instead of -32001.
    const openaiRequestsAfterRestart: ModelRequest[] = [];
    const router2 = createRoutingModelProvider({
      providers: {
        openai: scriptedProvider((request) =>
          openaiRequestsAfterRestart.push(request),
        ),
      },
      defaultProvider: "openai",
    });
    const messages2: JsonRpcOutgoing[] = [];
    const completed2 = completedTurn(messages2);
    const restarted = new AppServer({
      loop: new AgentLoop(router2),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the requested work",
        tools: [],
      }),
      conversationStore,
      suggestionStore: new MemorySuggestionStore(),
      send: (message) => messages2.push(message),
    });
    await restarted.receive({ jsonrpc: "2.0", id: 100, method: "initialize" });
    await restarted.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "重启后的第一轮" },
    });
    await completed2;
    expect(openaiRequestsAfterRestart).toHaveLength(1);
    expect(openaiRequestsAfterRestart[0].input).toBe("重启后的第一轮");

    // capability/list also lazy-loads instead of -32001.
    const capabilities = (await restarted.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "capability/list",
      params: { threadId },
    })) as unknown;
    expect(capabilities).toBeUndefined(); // receive resolves nothing; errors are replies
    const capabilityMessage = messages2.find(
      (message) => "id" in message && message.id === 4,
    );
    expect(capabilityMessage).toBeDefined();
    expect("error" in (capabilityMessage as { error?: unknown })).toBe(false);
    await restarted.dispose();
  });
});
