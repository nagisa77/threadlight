import { mkdtempSync, rmSync } from "node:fs";
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

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistent conversations", () => {
  it("persists commentary before every tool in a multi-tool batch", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-progress-"));
    directories.push(root);
    const store = new FileConversationStore(
      join(root, ".threadlight", "conversations"),
    );
    let generation = 0;
    const provider: ModelProvider = {
      async generate() {
        generation += 1;
        return generation === 1
          ? {
              text: "I’ll inspect both files first.",
              toolCalls: [
                { id: "call-1", name: "inspect", arguments: { file: "a" } },
                { id: "call-2", name: "inspect", arguments: { file: "b" } },
              ],
            }
          : { text: "Both files are ready.", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const completed = notification(messages, "turn/completed");
    const appServer = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Explain tool calls",
        tools: [
          defineTool({
            name: "inspect",
            description: "Inspect a file",
            parameters: { type: "object" },
            async execute(arguments_) {
              return `inspected ${(arguments_ as { file: string }).file}`;
            },
          }),
        ],
      }),
      conversationStore: store,
      send(message) {
        messages.push(message);
        completed.receive(message);
      },
    });

    await appServer.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await appServer.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await appServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Inspect both files" },
    });
    await completed.promise;

    expect(store.load(threadId)?.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Both files are ready.",
      progress: [
        {
          text: "I’ll inspect both files first.",
          activities: [
            { id: "call-1", name: "inspect", status: "completed" },
            { id: "call-2", name: "inspect", status: "completed" },
          ],
        },
      ],
    });
  });

  it("persists managed command output and a user-terminated state", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-managed-process-"));
    directories.push(root);
    const store = new FileConversationStore(
      join(root, ".threadlight", "conversations"),
    );
    const running = {
      sessionId: "session-1",
      command: "long-running-command",
      cwd: root,
      status: "running" as const,
      exitCode: null,
      signal: null,
      stdout: "partial output\n",
      stderr: "",
      truncated: false,
      startedAt: "2026-07-22T08:00:00.000Z",
    };
    const terminated = {
      ...running,
      status: "terminated" as const,
      signal: "SIGTERM",
      completedAt: "2026-07-22T08:00:01.000Z",
    };
    let generation = 0;
    const provider: ModelProvider = {
      async generate() {
        generation += 1;
        return generation === 1
          ? {
              text: "I’ll start the command.",
              toolCalls: [
                {
                  id: "call-exec",
                  name: "exec_command",
                  arguments: { command: running.command },
                },
              ],
            }
          : { text: "The command is running.", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const completed = notification(messages, "turn/completed");
    const appServer = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Manage the process",
        tools: [
          defineTool({
            name: "exec_command",
            description: "Start a command",
            parameters: { type: "object" },
            async execute() {
              return { ...running, timedOut: true };
            },
          }),
        ],
      }),
      conversationStore: store,
      processes: {
        status: () => running,
        read: () => running,
        wait: () => running,
        kill: () => terminated,
      },
      send(message) {
        messages.push(message);
        completed.receive(message);
      },
    });

    await appServer.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await appServer.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await appServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Start it" },
    });
    await completed.promise;
    expect(store.load(threadId)?.messages.at(-1)).toMatchObject({
      progress: [
        {
          activities: [
            {
              name: "exec_command",
              status: "running",
              process: { sessionId: "session-1", stdout: "partial output\n" },
            },
          ],
        },
      ],
    });

    await appServer.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "process/kill",
      params: { sessionId: "session-1" },
    });
    expect(store.load(threadId)?.messages.at(-1)).toMatchObject({
      progress: [
        {
          activities: [
            {
              status: "terminated",
              process: { status: "terminated", signal: "SIGTERM" },
            },
          ],
        },
      ],
    });
  });

  it("resumes messages and provider-neutral opaque state after a server restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-resume-"));
    directories.push(root);
    const store = new FileConversationStore(
      join(root, ".threadlight", "conversations"),
    );
    const firstMessages: JsonRpcOutgoing[] = [];
    const firstProvider: ModelProvider = {
      async generate(request) {
        expect(request.state).toBeUndefined();
        return {
          text: "First answer",
          toolCalls: [],
          state: { opaque: ["response-1"] },
        };
      },
    };
    const firstCompleted = notification(firstMessages, "turn/completed");
    const firstServer = server(firstProvider, store, (message) => {
      firstMessages.push(message);
      firstCompleted.receive(message);
    });

    await firstServer.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await firstServer.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(firstMessages, 2).threadId;
    expect(store.load(threadId)).toBeUndefined();
    await firstServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "First question" },
    });
    await firstCompleted.promise;

    let resumedRequest: ModelRequest | undefined;
    const secondMessages: JsonRpcOutgoing[] = [];
    const secondProvider: ModelProvider = {
      async generate(request) {
        resumedRequest = request;
        return { text: "Second answer", toolCalls: [], state: request.state };
      },
    };
    const secondCompleted = notification(secondMessages, "turn/completed");
    const secondServer = server(secondProvider, store, (message) => {
      secondMessages.push(message);
      secondCompleted.receive(message);
    });

    await secondServer.receive({ jsonrpc: "2.0", id: 4, method: "initialize" });
    await secondServer.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });
    expect(result<{ messages: Array<{ text: string }> }>(secondMessages, 5).messages)
      .toMatchObject([{ text: "First question" }, { text: "First answer" }]);

    await secondServer.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "turn/start",
      params: { threadId, input: "Second question" },
    });
    await secondCompleted.promise;

    expect(resumedRequest?.state).toEqual({ opaque: ["response-1"] });
    expect(resumedRequest?.input).toBe("Second question");
    expect(store.load(threadId)?.messages.map((message) => message.text)).toEqual([
      "First question",
      "First answer",
      "Second question",
      "Second answer",
    ]);
  });

  it("keeps a blank session ephemeral until the first user input", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-ephemeral-"));
    directories.push(root);
    const store = new FileConversationStore(
      join(root, ".threadlight", "conversations"),
    );
    const messages: JsonRpcOutgoing[] = [];
    const provider: ModelProvider = {
      async generate() {
        return { text: "Ready", toolCalls: [] };
      },
    };
    const completed = notification(messages, "turn/completed");
    const appServer = server(provider, store, (message) => {
      messages.push(message);
      completed.receive(message);
    });

    await appServer.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await appServer.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    expect(store.load(threadId)).toBeUndefined();

    await appServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Create the task" },
    });
    await completed.promise;

    expect(store.load(threadId)?.messages.map((message) => message.text)).toEqual([
      "Create the task",
      "Ready",
    ]);
  });

  it("deletes a task and refuses to resume it", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-delete-"));
    directories.push(root);
    const store = new FileConversationStore(
      join(root, ".threadlight", "conversations"),
    );
    const messages: JsonRpcOutgoing[] = [];
    const provider: ModelProvider = {
      async generate() {
        return { text: "scripted response", toolCalls: [] };
      },
    };
    const appServer = server(provider, store, (message) => messages.push(message));

    await appServer.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await appServer.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;

    await appServer.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "thread/delete",
      params: { threadId },
    });
    expect(result<{ deleted: boolean }>(messages, 3)).toEqual({ deleted: true });
    expect(store.load(threadId)).toBeUndefined();

    await appServer.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });
    expect(messages.find((message) => "id" in message && message.id === 4))
      .toMatchObject({ error: { code: -32001 } });
  });
});

function server(
  provider: ModelProvider,
  store: FileConversationStore,
  send: (message: JsonRpcOutgoing) => void,
) {
  return new AppServer({
    loop: new AgentLoop(provider),
    agent: defineAgent({ name: "scripted", instructions: "Reply" }),
    conversationStore: store,
    send,
  });
}

function result<T>(messages: JsonRpcOutgoing[], id: number): T {
  const message = messages.find((candidate) => "id" in candidate && candidate.id === id);
  if (!message || !("result" in message)) throw new Error(`Missing response ${id}`);
  return message.result as T;
}

function notification(messages: JsonRpcOutgoing[], method: string) {
  let resolve!: (message: JsonRpcOutgoing) => void;
  const promise = new Promise<JsonRpcOutgoing>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    receive(message: JsonRpcOutgoing) {
      if ("method" in message && message.method === method) resolve(message);
    },
  };
}
