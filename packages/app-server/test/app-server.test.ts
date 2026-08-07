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
import { createUpdatePlanTool } from "@threadlight/builtin-tools";

import { AppServer } from "../src/app-server.js";
import type { AttachmentProvider } from "../src/attachment-runtime.js";
import { MemoryConversationStore } from "../src/conversation-store.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";
import { MemorySuggestionStore } from "../src/suggestion-store.js";

function richPlanStep(
  step: string,
  status: "pending" | "in_progress" | "completed",
) {
  return {
    step,
    details: `Execute ${step} using the inspected architecture and preserve existing behavior.`,
    acceptanceCriteria: [`${step} is implemented and verified.`],
    status,
  };
}

describe("AppServer", () => {
  it("generates and persists a model title from the first user message before the turn completes", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const titleReceived = Promise.withResolvers<void>();
    const firstTurnCompleted = Promise.withResolvers<void>();
    const secondTurnCompleted = Promise.withResolvers<void>();
    const conversationStore = new MemoryConversationStore();
    let titleRequests = 0;
    let completedTurns = 0;
    let titleNotificationIndex = -1;
    let firstCompletedIndex = -1;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("Create one concise title")) {
          titleRequests += 1;
          expect(request.tools).toEqual([]);
          expect(request.state).toBeUndefined();
          // The early trigger means the transcript contains only the first
          // user message, with no assistant reply yet.
          expect(request.input).toBe(
            "User: 新建任务时总显示运行时离线，请修复",
          );
          return { text: "标题：修复任务离线问题。", toolCalls: [] };
        }
        return { text: "已修复。", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "worker",
        instructions: "Complete the requested work",
        tools: [],
      }),
      conversationStore,
      generateConversationTitles: true,
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "thread/title") {
          titleNotificationIndex = messages.length - 1;
          titleReceived.resolve();
        }
        if ("method" in message && message.method === "turn/completed") {
          completedTurns += 1;
          if (completedTurns === 1) {
            firstCompletedIndex = messages.length - 1;
            firstTurnCompleted.resolve();
          }
          if (completedTurns === 2) secondTurnCompleted.resolve();
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
      params: {
        threadId,
        input: "新建任务时总显示运行时离线，请修复",
      },
    });
    // The title arrives while the first turn is still running.
    await titleReceived.promise;
    expect(firstCompletedIndex).toBe(-1);

    expect(
      messages.filter(
        (message) =>
          "method" in message && message.method === "thread/title",
      ),
    ).toEqual([
      {
        jsonrpc: "2.0",
        method: "thread/title",
        params: { threadId, title: "修复任务离线问题" },
      },
    ]);
    expect(await conversationStore.load(threadId)).toMatchObject({
      title: "修复任务离线问题",
      titleStatus: "completed",
      titleGeneratedAt: expect.any(String),
    });

    // Queue a follow-up while the first turn is still active. It starts
    // automatically once the first turn finishes, which mirrors how the
    // desktop client follows up without racing the active turn cleanup.
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/follow-up",
      params: { threadId, input: "再补一个测试", delivery: "queued" },
    });

    await firstTurnCompleted.promise;
    expect(titleNotificationIndex).toBeLessThan(firstCompletedIndex);
    await secondTurnCompleted.promise;

    expect(titleRequests).toBe(1);
    expect(
      messages.filter(
        (message) =>
          "method" in message && message.method === "thread/title",
      ),
    ).toHaveLength(1);
    await server.dispose();
  });

  it("starts user-selected Plan mode and persists scripted plan progress", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I’ll make a plan.",
            toolCalls: [
              {
                id: "plan-1",
                name: "update_plan",
                arguments: {
                  plan: [
                    richPlanStep("Inspect architecture", "in_progress"),
                    richPlanStep("Implement mode", "pending"),
                  ],
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          return {
            text: "The first step is verified.",
            toolCalls: [
              {
                id: "plan-2",
                name: "update_plan",
                arguments: {
                  plan: [
                    {
                      ...richPlanStep("Inspect architecture", "completed"),
                      completionEvidence: ["Architecture paths were inspected."],
                    },
                    richPlanStep("Implement mode", "in_progress"),
                  ],
                },
              },
            ],
          };
        }
        if (requests.length === 3) {
          return {
            text: "The implementation is verified.",
            toolCalls: [
              {
                id: "plan-3",
                name: "update_plan",
                arguments: {
                  plan: [
                    {
                      ...richPlanStep("Inspect architecture", "completed"),
                      completionEvidence: ["Architecture paths were inspected."],
                    },
                    {
                      ...richPlanStep("Implement mode", "completed"),
                      completionEvidence: ["The controlled mode was verified."],
                    },
                  ],
                },
              },
            ],
          };
        }
        return { text: "Plan completed", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "planner",
        instructions: "Work carefully",
        tools: [createUpdatePlanTool()],
      }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
        if ("method" in message && message.method === "turn/failed") {
          completed.reject(new Error(message.params.error));
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
      params: { threadId, input: "Add Plan mode", mode: "plan" },
    });
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    expect(requests[0]?.instructions).toContain(
      "user explicitly selected Plan mode",
    );
    expect(
      messages.find(
        (message) =>
          "method" in message && message.method === "turn/started",
      ),
    ).toMatchObject({
      params: { threadId, mode: "plan" },
    });
    expect(
      messages.find((message) => "id" in message && message.id === 4),
    ).toMatchObject({
      result: {
        messages: [
          { role: "user", mode: "plan" },
          {
            role: "assistant",
            plan: {
              source: "user",
              items: [
                {
                  ...richPlanStep("Inspect architecture", "completed"),
                  completionEvidence: ["Architecture paths were inspected."],
                },
                {
                  ...richPlanStep("Implement mode", "completed"),
                  completionEvidence: ["The controlled mode was verified."],
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("requires an informational Plan turn to create and complete a plan", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.tools.map((tool) => tool.name)).toContain(
            "request_plan_input",
          );
          return {
            text: "I’ll plan the analysis.",
            toolCalls: [
              {
                id: "plan-1",
                name: "update_plan",
                arguments: {
                  plan: [
                    richPlanStep("Analyze available capabilities", "in_progress"),
                  ],
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          expect(request.instructions).toContain(
            "Current step 1/1: Analyze available capabilities",
          );
          return {
            text: "The capability analysis is complete.",
            toolCalls: [
              {
                id: "plan-2",
                name: "update_plan",
                arguments: {
                  plan: [
                    {
                      ...richPlanStep(
                        "Analyze available capabilities",
                        "completed",
                      ),
                      completionEvidence: [
                        "The advertised capabilities were reviewed.",
                      ],
                    },
                  ],
                },
              },
            ],
          };
        }
        expect(request.instructions).toContain("PLAN CONTROL — COMPLETE");
        return {
          text: "I can inspect files and run commands.",
          toolCalls: [],
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "planner",
        instructions: "Work carefully",
        tools: [createUpdatePlanTool()],
      }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
        if ("method" in message && message.method === "turn/failed") {
          completed.reject(new Error(message.params.error));
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
      params: {
        threadId,
        input: "What tools do you have?",
        mode: "plan",
      },
    });
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    expect(requests).toHaveLength(3);
    expect(
      messages.find((message) => "id" in message && message.id === 4),
    ).toMatchObject({
      result: {
        messages: [
          { role: "user", mode: "plan" },
          {
            role: "assistant",
            text: "I can inspect files and run commands.",
            plan: {
              source: "user",
              items: [
                {
                  ...richPlanStep(
                    "Analyze available capabilities",
                    "completed",
                  ),
                  completionEvidence: [
                    "The advertised capabilities were reviewed.",
                  ],
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("persists the complete blocking question when the model abbreviates it", async () => {
    const question = [
      "Choose one direction:",
      "1. Calculate a password",
      "2. Improve the script",
      "3. Inspect firmware",
      "4. Describe another task",
    ].join("\n");
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "input-1",
                name: "request_plan_input",
                arguments: {
                  missing_information: "The task direction",
                  question,
                },
              },
            ],
          };
        }
        expect(request.tools).toEqual([]);
        return {
          text: "Choose one of the four directions above.",
          toolCalls: [],
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "planner",
        instructions: "Work carefully",
        tools: [createUpdatePlanTool()],
      }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
        if ("method" in message && message.method === "turn/failed") {
          completed.reject(new Error(message.params.error));
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
      params: {
        threadId,
        input: "Continue",
        mode: "plan",
      },
    });
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    expect(requests).toHaveLength(2);
    expect(
      messages.find((message) => "id" in message && message.id === 4),
    ).toMatchObject({
      result: {
        messages: [
          { role: "user", mode: "plan" },
          {
            role: "assistant",
            text: question,
          },
        ],
      },
    });
    const resumed = messages.find(
      (message) => "id" in message && message.id === 4,
    ) as { result?: { messages?: Array<{ plan?: unknown }> } };
    expect(resumed.result?.messages?.[1]?.plan).toBeUndefined();
  });

  it("lets the scripted model enter Plan mode without a user toggle", async () => {
    let generation = 0;
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    const server = new AppServer({
      loop: new AgentLoop({
        async generate(request) {
          requests.push(request);
          generation += 1;
          if (generation === 1) {
            expect(request.instructions).not.toContain("PLAN CONTROL");
            return {
                text: "This needs a plan.",
                toolCalls: [
                  {
                    id: "plan-1",
                    name: "update_plan",
                    arguments: {
                      plan: [
                        richPlanStep("Investigate", "in_progress"),
                        richPlanStep("Verify", "pending"),
                      ],
                    },
                  },
                ],
              };
          }
          if (generation === 2) {
            expect(request.instructions).toContain(
              "Current step 1/2: Investigate",
            );
            return {
              text: "Everything is done.",
              toolCalls: [
                {
                  id: "plan-2",
                  name: "update_plan",
                  arguments: {
                    plan: [
                      {
                        ...richPlanStep("Investigate", "completed"),
                        completionEvidence: ["Investigation was verified."],
                      },
                      {
                        ...richPlanStep("Verify", "completed"),
                        completionEvidence: [
                          "Verification was claimed without activation.",
                        ],
                      },
                    ],
                  },
                },
              ],
            };
          }
          if (generation === 3) {
            expect(request.toolResults?.[0]).toMatchObject({
              name: "update_plan",
              isError: true,
              output: expect.stringContaining(
                "pending step 2 cannot be skipped",
              ),
            });
            return {
              text: "I’ll advance one verified step.",
              toolCalls: [
                {
                  id: "plan-3",
                  name: "update_plan",
                  arguments: {
                    plan: [
                      {
                        ...richPlanStep("Investigate", "completed"),
                        completionEvidence: ["Investigation was verified."],
                      },
                      richPlanStep("Verify", "in_progress"),
                    ],
                  },
                },
              ],
            };
          }
          if (generation === 4) {
            expect(request.instructions).toContain(
              "Current step 2/2: Verify",
            );
            return {
              text: "Verification complete.",
              toolCalls: [
                {
                  id: "plan-4",
                  name: "update_plan",
                  arguments: {
                    plan: [
                      {
                        ...richPlanStep("Investigate", "completed"),
                        completionEvidence: ["Investigation was verified."],
                      },
                      {
                        ...richPlanStep("Verify", "completed"),
                        completionEvidence: ["Final behavior was verified."],
                      },
                    ],
                  },
                },
              ],
            };
          }
          expect(request.instructions).toContain("PLAN CONTROL — COMPLETE");
          return { text: "Done", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "planner",
        instructions: "Choose tools as needed",
        tools: [createUpdatePlanTool()],
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
    const threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Investigate this" },
    });
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    expect(
      messages.find((message) => "id" in message && message.id === 4),
    ).toMatchObject({
      result: {
        messages: [
          { role: "user" },
          {
            role: "assistant",
            plan: {
              source: "model",
              items: [
                {
                  ...richPlanStep("Investigate", "completed"),
                  completionEvidence: ["Investigation was verified."],
                },
                {
                  ...richPlanStep("Verify", "completed"),
                  completionEvidence: ["Final behavior was verified."],
                },
              ],
            },
          },
        ],
      },
    });
    expect(requests).toHaveLength(5);
  });

  it("generates cached opening questions for a draft without creating a thread", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return {
          text: [
            "```json",
            '["这个项目最值得先解决的架构风险是什么？","哪些测试缺口最可能导致回归？","下一步最有价值的功能改进是什么？"]',
            "```",
          ].join("\n"),
          toolCalls: [],
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Workspace context: a local TypeScript agent runtime",
        tools: [
          defineTool({
            name: "inspect_workspace",
            description: "Inspect files",
            parameters: { type: "object" },
            async execute() {
              throw new Error("Suggestions must not call tools");
            },
          }),
        ],
      }),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    for (const id of [2, 3]) {
      await server.receive({
        jsonrpc: "2.0",
        id,
        method: "thread/suggestions",
        params: { language: "zh-CN" },
      });
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      tools: [],
      input: expect.stringContaining("Simplified Chinese"),
      instructions: expect.stringContaining(
        "Workspace context: a local TypeScript agent runtime",
      ),
    });
    expect(
      messages.find((message) => "id" in message && message.id === 2),
    ).toMatchObject({
      result: {
        suggestions: [
          "这个项目最值得先解决的架构风险是什么？",
          "哪些测试缺口最可能导致回归？",
          "下一步最有价值的功能改进是什么？",
        ],
      },
    });
    expect(
      messages.find((message) => "id" in message && message.id === 3),
    ).toMatchObject({
      result: {
        suggestions: [
          "这个项目最值得先解决的架构风险是什么？",
          "哪些测试缺口最可能导致回归？",
          "下一步最有价值的功能改进是什么？",
        ],
      },
    });
  });

  it("generates structured PR copy with an offline scripted provider", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    const server = new AppServer({
      loop: new AgentLoop({
        async generate(request) {
          requests.push(request);
          if (request.instructions.includes("pull request metadata")) {
            return {
              text: JSON.stringify({
                title: "Refine delivery center",
                summary: [
                  "Generate detailed PR copy automatically",
                  "Support both ready and draft pull requests",
                ],
                changes: [
                  "Add a structured metadata generation request",
                  "Keep generated copy editable before publishing",
                ],
                testing: ["Ran the delivery center unit tests"],
              }),
              toolCalls: [],
            };
          }
          return { text: "Implemented and tested the delivery flow.", toolCalls: [] };
        },
      }),
      agent: defineAgent({
        name: "scripted",
        instructions: "Complete the requested work",
        tools: [],
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
    const threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Improve the delivery center" },
    });
    await completed.promise;
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "delivery/pull-request-description",
      params: {
        threadId,
        changes: [
          {
            path: "packages/ui/src/features/delivery-center.tsx",
            status: "modified",
            additions: 80,
            deletions: 20,
          },
        ],
      },
    });

    expect(requests.at(-1)).toMatchObject({
      tools: [],
      input: expect.stringContaining(
        "modified: packages/ui/src/features/delivery-center.tsx (+80 -20)",
      ),
    });
    expect(
      messages.find((message) => "id" in message && message.id === 4),
    ).toMatchObject({
      result: {
        title: "Refine delivery center",
        body: [
          "## Summary",
          "- Generate detailed PR copy automatically",
          "- Support both ready and draft pull requests",
          "",
          "## Changes",
          "- Add a structured metadata generation request",
          "- Keep generated copy editable before publishing",
          "",
          "## Testing",
          "- Ran the delivery center unit tests",
        ].join("\n"),
      },
    });
  });

  it("shares hourly suggestions across tasks and falls back to stale questions when refresh fails", async () => {
    let now = new Date("2026-07-31T08:00:00.000Z");
    let generation = 0;
    const requests: ModelRequest[] = [];
    const suggestionStore = new MemorySuggestionStore();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        generation += 1;
        if (generation === 3) {
          throw new Error("scripted refresh failure");
        }
        return {
          text: JSON.stringify([
            `Architecture question ${generation}?`,
            `Testing question ${generation}?`,
            `Feature question ${generation}?`,
          ]),
          toolCalls: [],
        };
      },
    };

    async function createServer() {
      const messages: JsonRpcOutgoing[] = [];
      const server = new AppServer({
        loop: new AgentLoop(provider),
        agent: defineAgent({
          name: "scripted",
          instructions: "Workspace context: the shared project",
          tools: [],
        }),
        suggestionStore,
        now: () => now,
        send: (message) => messages.push(message),
      });
      await server.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });
      return { server, messages };
    }

    async function requestSuggestions(
      server: AppServer,
      messages: JsonRpcOutgoing[],
      id: number,
    ) {
      await server.receive({
        jsonrpc: "2.0",
        id: `start-${id}`,
        method: "thread/start",
      });
      const threadId = (
        messages.find(
          (message) =>
            "id" in message && message.id === `start-${id}`,
        )?.result as { threadId: string }
      ).threadId;
      await server.receive({
        jsonrpc: "2.0",
        id,
        method: "thread/suggestions",
        params: { threadId, language: "en" },
      });
      return (
        messages.find(
          (message) => "id" in message && message.id === id,
        ) as { result: { suggestions: readonly string[] } }
      ).result.suggestions;
    }

    const first = await createServer();
    const initial = await requestSuggestions(
      first.server,
      first.messages,
      10,
    );
    expect(
      await requestSuggestions(first.server, first.messages, 11),
    ).toEqual(initial);

    now = new Date("2026-07-31T08:30:00.000Z");
    const reopened = await createServer();
    expect(
      await requestSuggestions(reopened.server, reopened.messages, 20),
    ).toEqual(initial);
    expect(requests).toHaveLength(1);

    now = new Date("2026-07-31T09:00:00.000Z");
    const refreshed = await requestSuggestions(
      reopened.server,
      reopened.messages,
      21,
    );
    expect(refreshed).toEqual([
      "Architecture question 2?",
      "Testing question 2?",
      "Feature question 2?",
    ]);
    expect(requests).toHaveLength(2);

    now = new Date("2026-07-31T10:00:00.000Z");
    expect(
      await requestSuggestions(reopened.server, reopened.messages, 22),
    ).toEqual(refreshed);
    now = new Date("2026-07-31T10:30:00.000Z");
    expect(
      await requestSuggestions(reopened.server, reopened.messages, 23),
    ).toEqual(refreshed);
    expect(requests).toHaveLength(3);
  });

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
    const provider: ModelProvider & AttachmentProvider = {
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
      attachmentProvider: provider,
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

  it("resumes a running turn from the host-owned live snapshot", async () => {
    let finishGeneration!: () => void;
    const generationPending = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    let receiveDelta!: () => void;
    const deltaReceived = new Promise<void>((resolve) => {
      receiveDelta = resolve;
    });
    const provider: ModelProvider = {
      async generate(_request, options) {
        options?.onEvent?.({
          type: "output_text.delta",
          delta: "正在检查",
        });
        receiveDelta();
        await generationPending;
        return { text: "正在检查，随后完成。", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    let completeTurn!: () => void;
    const completed = new Promise<void>((resolve) => {
      completeTurn = resolve;
    });
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "scripted", instructions: "Reply" }),
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completeTurn();
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
      params: { threadId, input: "检查项目" },
    });
    await deltaReceived;

    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "thread/resume",
      params: { threadId },
    });

    expect(
      messages.find((message) => "id" in message && message.id === 4),
    ).toMatchObject({
      result: {
        threadId,
        messages: [{ role: "user", text: "检查项目" }],
        activeTurn: {
          mode: "default",
          isThinking: false,
          streamingText: "正在检查",
          progress: [],
        },
      },
    });

    finishGeneration();
    await completed;
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
