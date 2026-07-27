import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("AppServer", () => {
  it("cleans up a scripted model run before completing when the model forgets to clear sharing", async () => {
    let generation = 0;
    const shareActions: unknown[] = [];
    const order: string[] = [];
    const turnCleanup = vi.fn(async () => {
      order.push("cleanup");
    });
    const provider: ModelProvider = {
      async generate() {
        generation += 1;
        if (generation === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "share-set",
                name: "computer_share",
                arguments: { action: "set" },
              },
            ],
          };
        }
        return { text: "done", toolCalls: [] };
      },
    };
    const completed = Promise.withResolvers<void>();
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "test",
        instructions: "Use sharing",
        tools: [
          defineTool({
            name: "computer_share",
            description: "Configure sharing",
            parameters: { type: "object" },
            async execute(arguments_) {
              shareActions.push(arguments_);
              return "shared";
            },
          }),
        ],
      }),
      turnCleanup,
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          order.push("completed");
          completed.resolve();
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
      params: { threadId, input: "Inspect Safari" },
    });
    await completed.promise;

    expect(shareActions).toEqual([{ action: "set" }]);
    expect(turnCleanup).toHaveBeenCalledOnce();
    expect(turnCleanup).toHaveBeenCalledWith({
      threadId,
      turnId: expect.any(String),
      runId: expect.any(String),
    });
    expect(order).toEqual(["cleanup", "completed"]);
  });

  it("rejects attachment metadata that points outside the configured upload root", async () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-server-upload-"));
    const attachmentRoot = join(directory, "uploads");
    const outsidePath = join(directory, "outside.txt");
    mkdirSync(attachmentRoot);
    writeFileSync(outsidePath, "private");
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop({
        async generate() {
          return { text: "done", toolCalls: [] };
        },
      }),
      agent: defineAgent({ name: "test", instructions: "Reply" }),
      attachmentRoot,
      send: (message) => messages.push(message),
    });

    try {
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
        params: {
          threadId,
          input: "Inspect this",
          attachments: [{
            id: "attachment-1",
            name: "outside.txt",
            mimeType: "text/plain",
            size: 7,
            kind: "file",
            path: outsidePath,
          }],
        },
      });

      expect(messages.at(-1)).toMatchObject({
        id: 3,
        error: {
          code: -32602,
          message: expect.stringContaining("active project"),
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lets the scripted model decide to upload an attachment during the turn", async () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-server-local-"));
    const attachmentPath = join(directory, "diagram.png");
    writeFileSync(attachmentPath, Uint8Array.from([1, 2, 3, 4, 5]));
    const requests: ModelRequest[] = [];
    let uploads = 0;
    let completeTurn: ((message: JsonRpcOutgoing) => void) | undefined;
    const completed = new Promise<JsonRpcOutgoing>((resolve) => {
      completeTurn = resolve;
    });
    const provider: ModelProvider = {
      async uploadAttachment(attachment) {
        uploads += 1;
        return {
          ...attachment,
          providerReference: { protocol: "scripted", fileId: "file-1" },
        };
      },
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I will inspect the image.",
            toolCalls: [
              {
                id: "upload-1",
                name: "attach_to_model_context",
                arguments: { attachmentId: "attachment-1" },
              },
            ],
          };
        }
        return { text: "done", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
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
    const attachment = {
      id: "attachment-1",
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image",
      path: attachmentPath,
    };

    try {
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
        params: { threadId, input: "", attachments: [attachment] },
      });

      await expect(completed).resolves.toMatchObject({
        method: "turn/completed",
        params: { threadId, output: "done" },
      });
      expect(uploads).toBe(1);
      expect(requests[0]?.attachments).toBeUndefined();
      expect(requests[0]?.input).toContain("diagram.png");
      expect(requests[0]?.input).toContain(attachmentPath);
      expect(requests[1]?.attachments).toEqual([
        {
          ...attachment,
          providerReference: { protocol: "scripted", fileId: "file-1" },
        },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("forwards model deltas before the completed turn", async () => {
    let finishGeneration!: () => void;
    const generationPending = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    const provider: ModelProvider = {
      async generate(_request, options) {
        options?.onEvent?.({ type: "output_text.delta", delta: "Hello" });
        await generationPending;
        return { text: "Hello from Threadlight", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    let receiveDelta!: (message: JsonRpcOutgoing) => void;
    const deltaReceived = new Promise<JsonRpcOutgoing>((resolve) => {
      receiveDelta = resolve;
    });
    let completeTurn!: (message: JsonRpcOutgoing) => void;
    const completed = new Promise<JsonRpcOutgoing>((resolve) => {
      completeTurn = resolve;
    });
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "test", instructions: "Reply" }),
      send(message) {
        messages.push(message);
        if (
          "method" in message &&
          message.method === "agent/event" &&
          (message.params as { event?: { type?: string } }).event?.type ===
            "model.output_text.delta"
        ) {
          receiveDelta(message);
        }
        if ("method" in message && message.method === "turn/completed") {
          completeTurn(message);
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

    await expect(deltaReceived).resolves.toMatchObject({
      method: "agent/event",
      params: {
        threadId,
        event: {
          type: "model.output_text.delta",
          step: 1,
          delta: "Hello",
        },
      },
    });
    expect(
      messages.some(
        (message) => "method" in message && message.method === "turn/completed",
      ),
    ).toBe(false);

    finishGeneration();
    await expect(completed).resolves.toMatchObject({
      method: "turn/completed",
      params: { output: "Hello from Threadlight" },
    });
  });

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

  it("keeps computer screenshots for the model but redacts them from UI events", async () => {
    const screenshot = `data:image/png;base64,${"A".repeat(4_000)}`;
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "computer-call-1",
                name: "computer",
                arguments: {
                  actions: [{ type: "screenshot" }],
                  pendingSafetyChecks: [],
                },
              },
            ],
          };
        }
        return { text: "done", toolCalls: [] };
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
        instructions: "Use computer",
        tools: [
          defineTool({
            name: "computer",
            kind: "computer",
            description: "Control the computer",
            parameters: { type: "object" },
            async execute() {
              return {
                type: "computer_screenshot",
                imageUrl: screenshot,
                detail: "original",
                acknowledgedSafetyChecks: [],
              };
            },
          }),
        ],
      }),
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
      params: { threadId, input: "Inspect the screen" },
    });
    await completed;

    expect(requests[1]?.toolResults?.[0]?.output).toContain(screenshot);
    const completedTool = messages.find(
      (message) =>
        "method" in message &&
        message.method === "agent/event" &&
        (message.params as { event?: { type?: string } }).event?.type ===
          "tool.completed",
    );
    expect(completedTool).toMatchObject({
      method: "agent/event",
      params: {
        event: {
          result: {
            name: "computer",
            output: '{"type":"computer_screenshot","status":"captured"}',
          },
        },
      },
    });
    expect(JSON.stringify(completedTool)).not.toContain(screenshot);

    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });
    const resumed = messages.find(
      (message) => "id" in message && message.id === 4,
    );
    const storedMessages = (
      resumed?.result as {
        messages?: Array<{
          role?: string;
          progress?: Array<{
            activities?: Array<{ detail?: string }>;
          }>;
        }>;
      }
    )?.messages;
    const computerDetail = storedMessages
      ?.findLast((message) => message.role === "assistant")
      ?.progress?.[0]?.activities?.[0]?.detail;
    expect(computerDetail).toBe(
      [
        "操作 1 · screenshot",
        "结果 · 已捕获更新后的屏幕截图",
      ].join("\n"),
    );
  });

  it("stores detailed computer failures without retaining typed content", async () => {
    let generation = 0;
    const provider: ModelProvider = {
      async generate() {
        generation += 1;
        if (generation === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "computer-call-1",
                name: "computer",
                arguments: {
                  actions: [
                    { type: "click", x: 120, y: 80, button: "left" },
                    { type: "type", text: "private message" },
                  ],
                  pendingSafetyChecks: [],
                },
              },
            ],
          };
        }
        return { text: "done", toolCalls: [] };
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
        instructions: "Use computer",
        tools: [
          defineTool({
            name: "computer",
            kind: "computer",
            description: "Control the computer",
            parameters: { type: "object" },
            async execute() {
              throw new Error(
                "action 2/2 type input=virtual pid=42 failed: " +
                  "focused={role=AXWindow}, active={role=AXButton}",
              );
            },
          }),
        ],
      }),
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
      params: { threadId, input: "Send a message" },
    });
    await completed;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    const resumed = messages.find(
      (message) => "id" in message && message.id === 4,
    );
    const serialized = JSON.stringify(resumed);
    expect(serialized).toContain(
      "操作 2 · type · 15 个字符（内容未记录）",
    );
    expect(serialized).toContain(
      "错误 · action 2/2 type input=virtual pid=42 failed",
    );
    expect(serialized).not.toContain("private message");
  });

  it("executes tools directly in the active turn", async () => {
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
            description: "Test direct execution",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
              return "executed";
            },
          }),
        ],
      }),
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
      params: { output: "Tool result: executed" },
    });
    expect(executions).toBe(1);
  });

  it("refuses to delete a task while its turn is running", async () => {
    let finishGeneration!: () => void;
    const generationPending = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    const provider: ModelProvider = {
      async generate() {
        await generationPending;
        return { text: "done", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "test", instructions: "Reply" }),
      send: (message) => messages.push(message),
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
      params: { threadId, input: "Wait" },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/delete",
      params: { threadId },
    });

    expect(messages.find((message) => "id" in message && message.id === 4))
      .toMatchObject({ error: { code: -32003 } });
    finishGeneration();
  });

  it("terminates a managed process through the app-server protocol", async () => {
    const snapshot = {
      sessionId: "session-1",
      command: "long-running-command",
      cwd: "/workspace",
      status: "terminated" as const,
      exitCode: null,
      signal: "SIGTERM",
      stdout: "partial output\n",
      stderr: "",
      truncated: false,
      startedAt: "2026-07-22T08:00:00.000Z",
      completedAt: "2026-07-22T08:00:01.000Z",
    };
    const killed: string[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop({
        async generate() {
          return { text: "done", toolCalls: [] };
        },
      }),
      agent: defineAgent({ name: "test", instructions: "Reply" }),
      processes: {
        status: () => snapshot,
        read: () => snapshot,
        wait: () => snapshot,
        kill(sessionId) {
          killed.push(sessionId);
          return snapshot;
        },
      },
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "process/kill",
      params: { sessionId: "session-1" },
    });

    expect(killed).toEqual(["session-1"]);
    expect(messages.find((message) => "id" in message && message.id === 2))
      .toMatchObject({ result: snapshot });
  });
});
