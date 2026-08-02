import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import {
  classifyToolCall,
  ExecutionPolicyRunController,
} from "../src/execution-policy-controller.js";
import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("execution safety policy", () => {
  it("classifies read-only, write, external, and destructive shell commands", () => {
    expect(
      classifyToolCall({
        id: "read",
        name: "exec_command",
        arguments: { command: "git status --short && rg TODO packages" },
      }),
    ).toMatchObject({ risk: "read", external: false });
    expect(
      classifyToolCall({
        id: "write",
        name: "exec_command",
        arguments: { command: "git commit -m test" },
      }),
    ).toMatchObject({
      risk: "write",
      permissionKey: "exec_command:git:commit",
    });
    expect(
      classifyToolCall({
        id: "external",
        name: "exec_command",
        arguments: { command: "git push origin feature" },
      }),
    ).toMatchObject({ risk: "write", external: true });
    expect(
      classifyToolCall({
        id: "destroy",
        name: "exec_command",
        arguments: { command: "git reset --hard HEAD~1" },
      }),
    ).toMatchObject({ risk: "destructive" });
  });

  it("uses an offline scripted provider and waits for write approval", async () => {
    const requests: ModelRequest[] = [];
    const approvals: string[] = [];
    let executions = 0;
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return requests.length === 1
          ? {
              text: "I will update the file.",
              toolCalls: [
                {
                  id: "write-1",
                  name: "write_file",
                  arguments: { path: "README.md" },
                },
              ],
              state: { turn: 1 },
            }
          : {
              text: "Updated.",
              toolCalls: [],
              state: { turn: 2 },
            };
      },
    };
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "scripted",
        instructions: "Update a file",
        tools: [
          defineTool({
            name: "write_file",
            mutability: "write",
            description: "Write a file",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
              return { ok: true };
            },
          }),
        ],
      }),
      "Update README",
      {
        controller: new ExecutionPolicyRunController("thread-1", {
          async request(request) {
            approvals.push(request.permissionKey);
            return "allow";
          },
        }),
      },
    );

    expect(approvals).toEqual(["tool:write_file"]);
    expect(executions).toBe(1);
    expect(result.output).toBe("Updated.");
    expect(result.modelState).toEqual({ turn: 2 });
    expect(requests[1]?.toolResults?.[0]).toMatchObject({
      callId: "write-1",
      name: "write_file",
    });
  });

  it("never asks for or executes destructive operations", async () => {
    let approvals = 0;
    let executions = 0;
    let step = 0;
    const provider: ModelProvider = {
      async generate() {
        step += 1;
        return step === 1
          ? {
              text: "",
              toolCalls: [
                {
                  id: "destroy-1",
                  name: "danger",
                  arguments: {},
                },
              ],
            }
          : { text: "The operation was blocked.", toolCalls: [] };
      },
    };
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "scripted",
        instructions: "Test policy",
        tools: [
          defineTool({
            name: "danger",
            mutability: "write",
            impact: { destructive: true },
            description: "Destroy data",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
            },
          }),
        ],
      }),
      "Do it",
      {
        controller: new ExecutionPolicyRunController("thread-1", {
          async request() {
            approvals += 1;
            return "allow";
          },
        }),
      },
    );

    expect(result.output).toBe("The operation was blocked.");
    expect(approvals).toBe(0);
    expect(executions).toBe(0);
  });

  it("pauses an AppServer turn and resumes through the approval protocol", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    let executions = 0;
    let modelStep = 0;
    let server!: AppServer;
    server = new AppServer({
      loop: new AgentLoop({
        async generate() {
          modelStep += 1;
          return modelStep === 1
            ? {
                text: "",
                toolCalls: [
                  {
                    id: "write-protocol-1",
                    name: "write_file",
                    arguments: { path: "README.md" },
                  },
                ],
              }
            : { text: "Done.", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "scripted",
        instructions: "Use the tool",
        tools: [
          defineTool({
            name: "write_file",
            mutability: "write",
            description: "Write a file",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
              return "ok";
            },
          }),
        ],
      }),
      send(message) {
        messages.push(message);
        if (
          "method" in message &&
          message.method === "execution/approval-required"
        ) {
          queueMicrotask(() => {
            void server.receive({
              jsonrpc: "2.0",
              method: "execution/approval/respond",
              params: {
                requestId: message.params.requestId,
                decision: "allow",
              },
            });
          });
        }
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });

    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: { executionApprovals: true } },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
    });
    const threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Write the file" },
    });
    await completed.promise;

    expect(executions).toBe(1);
    expect(
      messages.filter(
        (message) =>
          "method" in message &&
          message.method === "execution/approval-required",
      ),
    ).toHaveLength(1);
    await server.dispose();
  });

  it("replays a pending approval when a display client resumes the task", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const firstApproval = Promise.withResolvers<string>();
    const replayedApproval = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    let approvalNotifications = 0;
    let modelStep = 0;
    const server = new AppServer({
      loop: new AgentLoop({
        async generate() {
          modelStep += 1;
          return modelStep === 1
            ? {
                text: "",
                toolCalls: [
                  {
                    id: "write-after-refresh",
                    name: "write_file",
                    arguments: { path: "README.md" },
                  },
                ],
              }
            : { text: "Done.", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "scripted",
        instructions: "Use the tool",
        tools: [
          defineTool({
            name: "write_file",
            mutability: "write",
            description: "Write a file",
            parameters: { type: "object" },
            async execute() {
              return "ok";
            },
          }),
        ],
      }),
      send(message) {
        messages.push(message);
        if (
          "method" in message &&
          message.method === "execution/approval-required"
        ) {
          approvalNotifications += 1;
          firstApproval.resolve(message.params.requestId);
          if (approvalNotifications === 2) replayedApproval.resolve();
        }
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });

    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: { executionApprovals: true } },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
    });
    const threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Write the file" },
    });
    const requestId = await firstApproval.promise;

    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });
    await replayedApproval.promise;
    expect(approvalNotifications).toBe(2);

    await server.receive({
      jsonrpc: "2.0",
      method: "execution/approval/respond",
      params: { requestId, decision: "allow", threadId },
    });
    await completed.promise;
    await server.dispose();
  });

  it("uses an offline scripted provider and bypasses safe execution for a full-access conversation", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    let executions = 0;
    let modelStep = 0;
    const server = new AppServer({
      loop: new AgentLoop({
        async generate() {
          modelStep += 1;
          return modelStep === 1
            ? {
                text: "",
                toolCalls: [
                  {
                    id: "destructive-full-1",
                    name: "danger",
                    arguments: {},
                  },
                ],
              }
            : { text: "Done.", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "scripted",
        instructions: "Use the tool",
        tools: [
          defineTool({
            name: "danger",
            mutability: "write",
            impact: { destructive: true },
            description: "Run an unrestricted operation",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
              return "ok";
            },
          }),
        ],
      }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });

    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: { executionApprovals: true } },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "thread/start",
    });
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
        input: "Run the unrestricted operation",
        accessMode: "full",
      },
    });
    await completed.promise;

    expect(executions).toBe(1);
    expect(
      messages.some(
        (message) =>
          "method" in message &&
          message.method === "execution/approval-required",
      ),
    ).toBe(false);
    await server.dispose();
  });
});
