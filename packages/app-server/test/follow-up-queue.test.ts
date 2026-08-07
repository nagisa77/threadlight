import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import { FileConversationStore } from "../src/conversation-store.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("running turn follow-ups", () => {
  it("promotes a queued follow-up with an attachment into a scripted run at the next safe boundary", async () => {
    const generationStarted = Promise.withResolvers<void>();
    const finishGeneration = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    let staleToolExecutions = 0;
    const attachmentDirectory = mkdtempSync(
      join(tmpdir(), "threadlight-follow-up-attachment-"),
    );
    temporaryDirectories.push(attachmentDirectory);
    const attachmentPath = join(attachmentDirectory, "brief.txt");
    writeFileSync(attachmentPath, "new constraints\n");
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          generationStarted.resolve();
          await finishGeneration.promise;
          return {
            text: "I will edit it.",
            toolCalls: [
              { id: "stale-write", name: "write", arguments: {} },
            ],
            state: { opaque: "response-1" },
          };
        }
        if (requests.length === 2) {
          return {
            text: "I need the attachment.",
            toolCalls: [
              {
                id: "attach-follow-up",
                name: "attach_to_model_context",
                arguments: { attachmentId: "attachment-1" },
              },
            ],
          };
        }
        return { text: "Explained without editing.", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Follow the latest instruction",
        tools: [
          defineTool({
            name: "write",
            description: "Write a file",
            parameters: { type: "object" },
            async execute() {
              staleToolExecutions += 1;
            },
          }),
        ],
      }),
      attachmentProvider: {
        async uploadAttachment(attachment) {
          return {
            ...attachment,
            providerReference: {
              protocol: "scripted",
              fileId: "follow-up-file",
            },
          };
        },
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
    const threadId = resultFor<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Edit the file" },
    });
    await generationStarted.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/follow-up",
      params: {
        threadId,
        input: "Do not edit it; explain the change",
        delivery: "queued",
        attachments: [
          {
            id: "attachment-1",
            name: "brief.txt",
            mimeType: "text/plain",
            size: 16,
            kind: "file",
            path: attachmentPath,
          },
        ],
      },
    });
    const queued = resultFor<{
      item: { id: string; delivery: string; attachments: readonly unknown[] };
    }>(messages, 4).item;
    expect(queued).toMatchObject({
      delivery: "queued",
      attachments: [{ name: "brief.txt" }],
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "turn/queue/inject",
      params: { threadId, itemId: queued.id },
    });
    expect(resultFor<{ item: { delivery: string } }>(messages, 5).item)
      .toMatchObject({ delivery: "inject" });

    finishGeneration.resolve();
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "thread/resume",
      params: { threadId },
    });

    expect(staleToolExecutions).toBe(0);
    expect(requests[1]?.state).toEqual({ opaque: "response-1" });
    expect(requests[1]?.input).toContain(
      "Do not edit it; explain the change",
    );
    expect(requests[1]?.input).toContain("brief.txt");
    expect(requests[1]?.tools.map(({ name }) => name)).toContain(
      "attach_to_model_context",
    );
    expect(requests[1]?.toolResults?.[0]).toMatchObject({
      callId: "stale-write",
      isError: true,
    });
    expect(requests[2]?.attachments).toEqual([
      expect.objectContaining({
        id: "attachment-1",
        providerReference: {
          protocol: "scripted",
          fileId: "follow-up-file",
        },
      }),
    ]);
    expect(resultFor<{
      messages: readonly { role: string; text: string }[];
      queuedTurns: readonly unknown[];
    }>(messages, 6)).toMatchObject({
      messages: [
        { role: "user", text: "Edit the file" },
        {
          role: "user",
          text: "Do not edit it; explain the change",
          followUpDelivery: "inject",
          attachments: [{ name: "brief.txt" }],
        },
        { role: "assistant", text: "Explained without editing." },
      ],
      queuedTurns: [],
    });
    expect(
      notifications(messages, "turn/follow-up/consumed"),
    ).toHaveLength(1);
  });

  it("preserves completed model output before consuming an injected instruction", async () => {
    const generationStarted = Promise.withResolvers<void>();
    const finishGeneration = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const messages: JsonRpcOutgoing[] = [];
    let requests = 0;
    const provider: ModelProvider = {
      async generate() {
        requests += 1;
        if (requests === 1) {
          generationStarted.resolve();
          await finishGeneration.promise;
          return { text: "上一段模型输出", toolCalls: [] };
        }
        return { text: "已执行追加命令", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Follow injected instructions",
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
    const threadId = resultFor<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "执行第一个命令" },
    });
    await generationStarted.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/follow-up",
      params: {
        threadId,
        input: "继续执行另一个命令",
        delivery: "inject",
      },
    });

    finishGeneration.resolve();
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });

    expect(
      resultFor<{
        messages: readonly { role: string; text: string }[];
      }>(messages, 5).messages,
    ).toMatchObject([
      { role: "user", text: "执行第一个命令" },
      { role: "assistant", text: "上一段模型输出" },
      { role: "user", text: "继续执行另一个命令" },
      { role: "assistant", text: "已执行追加命令" },
    ]);
    expect(
      notifications(messages, "turn/follow-up/consumed")[0],
    ).toMatchObject({
      params: {
        precedingAssistantMessage: {
          role: "assistant",
          text: "上一段模型输出",
        },
        message: {
          role: "user",
          text: "继续执行另一个命令",
        },
      },
    });
    await server.dispose();
  });

  it("starts an attachment-only queued follow-up after the active answer completes", async () => {
    const firstGenerationStarted = Promise.withResolvers<void>();
    const finishFirstGeneration = Promise.withResolvers<void>();
    const queuedTurnCompleted = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const attachmentDirectory = mkdtempSync(
      join(tmpdir(), "threadlight-queued-attachment-"),
    );
    temporaryDirectories.push(attachmentDirectory);
    const attachmentPath = join(attachmentDirectory, "diagram.png");
    writeFileSync(attachmentPath, "image");
    let completions = 0;
    const server = new AppServer({
      loop: new AgentLoop({
        async generate(request) {
          requests.push(request);
          if (requests.length === 1) {
            firstGenerationStarted.resolve();
            await finishFirstGeneration.promise;
          }
          return { text: "Done", toolCalls: [] };
        },
      }),
      agent: defineAgent({ name: "scripted", instructions: "Inspect inputs" }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completions += 1;
          if (completions === 2) queuedTurnCompleted.resolve();
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = resultFor<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Finish this answer" },
    });
    await firstGenerationStarted.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/follow-up",
      params: {
        threadId,
        input: "",
        delivery: "queued",
        attachments: [
          {
            id: "attachment-queued",
            name: "diagram.png",
            mimeType: "image/png",
            size: 5,
            kind: "image",
            path: attachmentPath,
          },
        ],
      },
    });

    finishFirstGeneration.resolve();
    await queuedTurnCompleted.promise;
    expect(requests[1]?.input).toContain("diagram.png");
    expect(requests[1]?.tools.map(({ name }) => name)).toContain(
      "attach_to_model_context",
    );
    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });
    expect(resultFor<{
      messages: readonly {
        role: string;
        followUpDelivery?: string;
        attachments?: readonly { name: string }[];
      }[];
    }>(messages, 5).messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          followUpDelivery: "queued",
          attachments: [expect.objectContaining({ name: "diagram.png" })],
        }),
      ]),
    );
    await server.dispose();
  });

  it("delivers multiple injected instructions one model response at a time", async () => {
    const generationStarted = Promise.withResolvers<void>();
    const finishGeneration = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          generationStarted.resolve();
          await finishGeneration.promise;
          return { text: "Hi! How can I help?", toolCalls: [] };
        }
        if (request.input?.includes("hey")) {
          return { text: "Answered hey", toolCalls: [] };
        }
        return { text: "Answered wait", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Answer every instruction separately",
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
    const threadId = resultFor<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "hi" },
    });
    await generationStarted.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/follow-up",
      params: { threadId, input: "hey", delivery: "inject" },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "turn/follow-up",
      params: { threadId, input: "wait", delivery: "inject" },
    });

    finishGeneration.resolve();
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "thread/resume",
      params: { threadId },
    });

    expect(requests).toHaveLength(3);
    expect(requests[1]?.input).toContain("hey");
    expect(requests[1]?.input).not.toContain("wait");
    expect(requests[2]?.input).toContain("wait");
    expect(
      notifications(messages, "turn/follow-up/consumed").map(
        (notification) => notification.params.message.text,
      ),
    ).toEqual(["hey", "wait"]);
    expect(
      resultFor<{
        messages: readonly { role: string; text: string }[];
      }>(messages, 6).messages,
    ).toMatchObject([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hi! How can I help?" },
      { role: "user", text: "hey" },
      { role: "assistant", text: "Answered hey" },
      { role: "user", text: "wait" },
      { role: "assistant", text: "Answered wait" },
    ]);
    await server.dispose();
  });

  it("reorders, cancels, persists, and automatically starts queued messages", async () => {
    const firstGenerationStarted = Promise.withResolvers<void>();
    const finishFirstGeneration = Promise.withResolvers<void>();
    const threeTurnsCompleted = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    let completions = 0;
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          firstGenerationStarted.resolve();
          await finishFirstGeneration.promise;
        }
        return {
          text: requests.length === 1 ? "First complete" : "Queued complete",
          toolCalls: [],
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "scripted", instructions: "Reply" }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completions += 1;
          if (completions === 3) threeTurnsCompleted.resolve();
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = resultFor<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "First" },
    });
    await firstGenerationStarted.promise;

    for (const [id, input] of [
      [4, "A"],
      [5, "B"],
      [6, "C"],
    ] as const) {
      await server.receive({
        jsonrpc: "2.0",
        id,
        method: "turn/follow-up",
        params: { threadId, input, delivery: "queued" },
      });
    }
    const itemA = resultFor<{ item: { id: string } }>(messages, 4).item;
    const itemB = resultFor<{ item: { id: string } }>(messages, 5).item;
    const itemC = resultFor<{ item: { id: string } }>(messages, 6).item;
    await server.receive({
      jsonrpc: "2.0",
      id: 7,
      method: "turn/queue/reorder",
      params: {
        threadId,
        itemId: itemC.id,
        beforeItemId: itemA.id,
      },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 8,
      method: "turn/queue/cancel",
      params: { threadId, itemId: itemB.id },
    });
    expect(
      resultFor<{ queuedTurns: readonly { input: string }[] }>(messages, 8)
        .queuedTurns.map(({ input }) => input),
    ).toEqual(["C", "A"]);

    finishFirstGeneration.resolve();
    await threeTurnsCompleted.promise;
    expect(requests.map(({ input }) => input)).toEqual(["First", "C", "A"]);

    await server.receive({
      jsonrpc: "2.0",
      id: 9,
      method: "thread/resume",
      params: { threadId },
    });
    expect(resultFor<{
      messages: readonly { role: string; text: string }[];
      queuedTurns: readonly unknown[];
    }>(messages, 9)).toMatchObject({
      messages: [
        { role: "user", text: "First" },
        { role: "assistant", text: "First complete" },
        { role: "user", text: "C" },
        { role: "assistant", text: "Queued complete" },
        { role: "user", text: "A" },
        { role: "assistant", text: "Queued complete" },
      ],
      queuedTurns: [],
    });
  });

  it("continues a persisted queue after the app-server restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-queue-"));
    temporaryDirectories.push(directory);
    const store = new FileConversationStore(directory);
    const firstGenerationStarted = Promise.withResolvers<void>();
    const firstServerMessages: JsonRpcOutgoing[] = [];
    const firstServer = new AppServer({
      loop: new AgentLoop({
        async generate() {
          firstGenerationStarted.resolve();
          await new Promise(() => undefined);
          return { text: "unreachable", toolCalls: [] };
        },
      }),
      agent: defineAgent({ name: "scripted", instructions: "Reply" }),
      conversationStore: store,
      send: (message) => firstServerMessages.push(message),
    });
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
    });
    const threadId = resultFor<{ threadId: string }>(
      firstServerMessages,
      2,
    ).threadId;
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Original run" },
    });
    await firstGenerationStarted.promise;
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/follow-up",
      params: {
        threadId,
        input: "Continue after restart",
        delivery: "queued",
      },
    });

    const resumedRequests: ModelRequest[] = [];
    const resumedMessages: JsonRpcOutgoing[] = [];
    const resumedCompleted = Promise.withResolvers<void>();
    const resumedServer = new AppServer({
      loop: new AgentLoop({
        async generate(request) {
          resumedRequests.push(request);
          return { text: "Recovered queue complete", toolCalls: [] };
        },
      }),
      agent: defineAgent({ name: "scripted", instructions: "Reply" }),
      conversationStore: store,
      send(message) {
        resumedMessages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          resumedCompleted.resolve();
        }
      },
    });
    await resumedServer.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "initialize",
    });
    await resumedServer.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "thread/resume",
      params: { threadId },
    });
    expect(
      resultFor<{ queuedTurns: readonly { input: string }[] }>(
        resumedMessages,
        6,
      ).queuedTurns,
    ).toMatchObject([{ input: "Continue after restart" }]);
    await resumedCompleted.promise;

    expect(resumedRequests[0]?.input).toBe("Continue after restart");
    expect(store.load(threadId)).toMatchObject({
      queuedTurns: [],
      messages: [
        { role: "user", text: "Original run" },
        { role: "user", text: "Continue after restart" },
        { role: "assistant", text: "Recovered queue complete" },
      ],
    });
  });
});

function resultFor<Result>(
  messages: readonly JsonRpcOutgoing[],
  id: number,
): Result {
  const response = messages.find(
    (message) => "id" in message && message.id === id,
  );
  if (!response || !("result" in response)) {
    throw new Error(`Missing successful response ${id}`);
  }
  return response.result as Result;
}

function notifications(
  messages: readonly JsonRpcOutgoing[],
  method: string,
): readonly JsonRpcOutgoing[] {
  return messages.filter(
    (message) => "method" in message && message.method === method,
  );
}
