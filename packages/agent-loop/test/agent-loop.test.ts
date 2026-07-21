import { describe, expect, it } from "vitest";

import { AgentLoop } from "../src/agent-loop.js";
import { defineAgent, defineTool } from "../src/types.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelTurn,
} from "../src/types.js";

class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  async generate(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(request);

    if (this.requests.length === 1) {
      return {
        text: "",
        toolCalls: [
          { id: "call_1", name: "double", arguments: { value: 21 } },
        ],
        state: [{ turn: 1 }],
      };
    }

    return {
      text: `The answer is ${request.toolResults?.[0]?.output}`,
      toolCalls: [],
      state: [{ turn: 2 }],
    };
  }
}

describe("AgentLoop", () => {
  it("executes a tool and feeds its result back to the model", async () => {
    const provider = new ScriptedProvider();
    const loop = new AgentLoop(provider);
    const tool = defineTool({
      name: "double",
      description: "Double a number",
      parameters: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
      async execute(arguments_) {
        const { value } = arguments_ as { value: number };
        return value * 2;
      },
    });

    const result = await loop.run(
      defineAgent({
        name: "test",
        instructions: "Use the tool",
        tools: [tool],
      }),
      "Double 21",
    );

    expect(result.output).toBe("The answer is 42");
    expect(result.steps).toBe(2);
    expect(provider.requests[1]?.toolResults?.[0]?.output).toBe("42");
  });

  it("waits for approval before protected tools", async () => {
    const provider = new ScriptedProvider();
    const loop = new AgentLoop(provider);
    let approvals = 0;

    const result = await loop.run(
      defineAgent({
        name: "test",
        instructions: "Use the tool",
        tools: [
          defineTool({
            name: "double",
            description: "Double a number",
            parameters: { type: "object" },
            needsApproval: true,
            async execute() {
              return 42;
            },
          }),
        ],
      }),
      "Double 21",
      {
        async approve() {
          approvals += 1;
          return true;
        },
      },
    );

    expect(result.output).toBe("The answer is 42");
    expect(approvals).toBe(1);
  });
});
