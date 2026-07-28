import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  ToolExecutionError,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import {
  ProjectMemoryReminderController,
  ResearchCoverageRunController,
  UserActionRunController,
} from "../src/run-controllers.js";

describe("app-server run controllers", () => {
  it("moves host user-action handling outside the agent loop", async () => {
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I’ll open the shared app.",
            toolCalls: [
              {
                id: "computer-share-1",
                name: "computer_share",
                arguments: { action: "list" },
              },
            ],
            state: [{ turn: 1 }],
          };
        }
        return {
          text: "请按照 Threadlight 的提示完成授权。",
          toolCalls: [],
          state: [{ turn: 2 }],
        };
      },
    };
    let delegatedCompletionChecks = 0;
    const controller = new UserActionRunController({
      validateCompletion() {
        delegatedCompletionChecks += 1;
        return "The delegated workflow is still incomplete.";
      },
    });

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Use computer tools",
        tools: [
          defineTool({
            name: "computer_share",
            description: "Share a window",
            parameters: { type: "object" },
            async execute() {
              throw new ToolExecutionError(
                "Screen Recording permission is required",
                {
                  code: "computer_permission_required",
                  retryable: false,
                  userAction: {
                    kind: "grant_permission",
                    data: { capability: "screen_recording" },
                  },
                },
              );
            },
          }),
          defineTool({
            name: "exec_command",
            description: "Run a fallback command",
            parameters: { type: "object" },
            async execute() {
              return "unused";
            },
          }),
        ],
      }),
      "Open Safari",
      { controller },
    );

    expect(result.output).toBe("请按照 Threadlight 的提示完成授权。");
    expect(result.modelState).toEqual([{ turn: 2 }]);
    expect(delegatedCompletionChecks).toBe(0);
    expect(requests[1]?.tools).toEqual([]);
    expect(requests[1]?.instructions).toContain(
      "Do not call or suggest any tools",
    );
    expect(requests[1]?.toolResults?.[0]).toMatchObject({
      isError: true,
      error: {
        code: "computer_permission_required",
        retryable: false,
        userAction: { kind: "grant_permission" },
      },
    });
  });

  it("prompts for a project-memory decision after durable changes", async () => {
    const requests: ModelRequest[] = [];
    let memoryWrites = 0;
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        switch (requests.length) {
          case 1:
            return {
              text: "",
              toolCalls: [
                {
                  id: "memory-read-1",
                  name: "project_memory",
                  arguments: {
                    action: "read",
                    content: null,
                    read_token: null,
                  },
                },
              ],
            };
          case 2:
            return {
              text: "",
              toolCalls: [
                {
                  id: "write-1",
                  name: "write_project",
                  arguments: {},
                },
              ],
            };
          case 3:
            return { text: "Finished.", toolCalls: [] };
          case 4:
            expect(request.input).toContain(
              "make an explicit project-memory decision",
            );
            return {
              text: "",
              toolCalls: [
                {
                  id: "memory-read-2",
                  name: "project_memory",
                  arguments: {
                    action: "read",
                    content: null,
                    read_token: null,
                  },
                },
              ],
            };
          case 5: {
            const read = JSON.parse(
              request.toolResults?.[0]?.output ?? "{}",
            ) as { read_token?: string };
            return {
              text: "",
              toolCalls: [
                {
                  id: "memory-write-1",
                  name: "project_memory",
                  arguments: {
                    action: "write",
                    content: "# Memory\n\n- Stable architecture fact.\n",
                    read_token: read.read_token,
                  },
                },
              ],
            };
          }
          default:
            return { text: "Finished with memory updated.", toolCalls: [] };
        }
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "memory-controlled",
        instructions: "Maintain durable memory.",
        tools: [
          defineTool({
            name: "project_memory",
            mutability: "write",
            description: "Read or write project memory",
            parameters: { type: "object" },
            async execute(arguments_) {
              const action = (arguments_ as { action?: string }).action;
              if (action === "read") {
                return { content: "# Memory\n", read_token: "mem_short_1" };
              }
              expect(
                (arguments_ as { read_token?: string }).read_token,
              ).toBe("mem_short_1");
              memoryWrites += 1;
              return { updated: true };
            },
          }),
          defineTool({
            name: "write_project",
            mutability: "write",
            description: "Make a durable project change",
            parameters: { type: "object" },
            async execute() {
              return "changed";
            },
          }),
        ],
      }),
      "Implement a durable architecture change",
      { controller: new ProjectMemoryReminderController() },
    );

    expect(result.output).toBe("Finished with memory updated.");
    expect(memoryWrites).toBe(1);
    expect(requests).toHaveLength(6);
  });

  it("rejects unqualified broad-research claims without discovery coverage", async () => {
    const requests: ModelRequest[] = [];
    const input = "全面搜索互联网资料和视频，并给我一份完整报告";
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain(
            "web_search is unavailable",
          );
          return {
            text: "我已经全面检索了互联网资料和视频。",
            toolCalls: [],
          };
        }
        expect(request.input).toContain("overstates research coverage");
        return {
          text: [
            "覆盖限制：当前运行时没有执行广泛的发现式搜索，因此这不是全面资料集。",
            "视频覆盖限制：未执行视频专项搜索。",
          ].join("\n"),
          toolCalls: [],
        };
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "research-controlled",
        instructions: "Research accurately.",
        tools: [],
      }),
      input,
      { controller: new ResearchCoverageRunController(input) },
    );

    expect(result.output).toContain("覆盖限制：");
    expect(requests).toHaveLength(2);
  });

  it("accepts broad coverage only after distinct searches include requested media", async () => {
    const requests: ModelRequest[] = [];
    const input = "全面搜索互联网资料和视频";
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "",
            toolCalls: [
              {
                id: "search-1",
                name: "web_search",
                arguments: { query: "topic primary sources" },
              },
              {
                id: "search-2",
                name: "web_search",
                arguments: { query: "topic video youtube" },
              },
            ],
          };
        }
        return {
          text: "已按多个检索方向完成资料与视频覆盖。",
          toolCalls: [],
        };
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "research-controlled",
        instructions: "Research accurately.",
        tools: [
          defineTool({
            name: "web_search",
            mutability: "read",
            description: "Search the web",
            parameters: { type: "object" },
            async execute(arguments_) {
              const query = (arguments_ as { query: string }).query;
              return {
                query,
                results: query.includes("video")
                  ? [{ url: "https://youtube.com/watch?v=test" }]
                  : [{ url: "https://example.com/source" }],
              };
            },
          }),
        ],
      }),
      input,
      { controller: new ResearchCoverageRunController(input) },
    );

    expect(result.output).toContain("视频覆盖");
    expect(requests).toHaveLength(2);
  });
});
