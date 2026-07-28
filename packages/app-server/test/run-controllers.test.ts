import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  ToolExecutionError,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import { UserActionRunController } from "../src/run-controllers.js";

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
});
