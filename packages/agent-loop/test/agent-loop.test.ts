import { describe, expect, it } from "vitest";

import { AgentLoop } from "../src/agent-loop.js";
import { defineAgent, defineTool } from "../src/types.js";
import type {
  AgentEvent,
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
  it("forwards the selected model through every scripted model turn", async () => {
    const provider = new ScriptedProvider();
    const loop = new AgentLoop(provider);

    await loop.run(
      defineAgent({
        name: "test",
        instructions: "Use the tool",
        model: "gpt-5.6-terra",
        tools: [
          defineTool({
            name: "double",
            description: "Double a number",
            parameters: { type: "object" },
            async execute() {
              return 42;
            },
          }),
        ],
      }),
      "Double 21",
    );

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.map((request) => request.model)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-terra",
    ]);
  });

  it("forwards text deltas before the model turn completes", async () => {
    let finishGeneration!: () => void;
    const generationPending = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    const provider: ModelProvider = {
      async generate(_request, options) {
        options?.onEvent?.({ type: "output_text.delta", delta: "Hello" });
        await generationPending;
        options?.onEvent?.({ type: "output_text.delta", delta: " world" });
        return { text: "Hello world", toolCalls: [] };
      },
    };
    const events: AgentEvent[] = [];
    const resultPending = new AgentLoop(provider).run(
      defineAgent({ name: "test", instructions: "Reply" }),
      "Hello",
      { onEvent: (event) => events.push(event) },
    );

    expect(events).toMatchObject([
      { type: "run.started" },
      { type: "model.started", step: 1 },
      { type: "model.output_text.delta", step: 1, delta: "Hello" },
    ]);
    expect(events.some((event) => event.type === "model.completed")).toBe(false);

    finishGeneration();
    await expect(resultPending).resolves.toMatchObject({ output: "Hello world" });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "model.started",
      "model.output_text.delta",
      "model.output_text.delta",
      "model.completed",
      "message.completed",
      "run.completed",
    ]);
  });

  it("executes a tool and feeds its result back to the model", async () => {
    const provider = new ScriptedProvider();
    const loop = new AgentLoop(provider);
    const events: AgentEvent[] = [];
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
      { onEvent: (event) => events.push(event) },
    );

    expect(result.output).toBe("The answer is 42");
    expect(result.steps).toBe(2);
    expect(provider.requests[1]?.toolResults?.[0]?.output).toBe("42");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "model.started",
      "model.completed",
      "tool.started",
      "tool.completed",
      "model.started",
      "model.completed",
      "message.completed",
      "run.completed",
    ]);
    expect(
      events.filter((event) => event.type === "model.completed"),
    ).toMatchObject([
      {
        type: "model.completed",
        step: 1,
        text: "",
        toolCalls: [
          { id: "call_1", name: "double", arguments: { value: 21 } },
        ],
      },
      {
        type: "model.completed",
        step: 2,
        text: "The answer is 42",
        toolCalls: [],
      },
    ]);
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

  it("emits commentary before executing every tool in a multi-tool turn", async () => {
    let generation = 0;
    const provider: ModelProvider = {
      async generate(request) {
        generation += 1;
        if (generation === 1) {
          return {
            text: "I’ll inspect both values first.",
            toolCalls: [
              { id: "call_1", name: "echo", arguments: { value: "one" } },
              { id: "call_2", name: "echo", arguments: { value: "two" } },
            ],
          };
        }
        return {
          text: request.toolResults?.map((result) => result.output).join(", ") ?? "",
          toolCalls: [],
        };
      },
    };
    const events: AgentEvent[] = [];
    const loop = new AgentLoop(provider);

    const result = await loop.run(
      defineAgent({
        name: "test",
        instructions: "Explain tool calls",
        tools: [
          defineTool({
            name: "echo",
            description: "Echo a value",
            parameters: { type: "object" },
            async execute(arguments_) {
              return (arguments_ as { value: string }).value;
            },
          }),
        ],
      }),
      "Inspect values",
      { onEvent: (event) => events.push(event) },
    );

    expect(result.output).toBe("one, two");
    expect(events.slice(2, 7)).toMatchObject([
      {
        type: "model.completed",
        text: "I’ll inspect both values first.",
        toolCalls: [{ id: "call_1" }, { id: "call_2" }],
      },
      { type: "tool.started", call: { id: "call_1" } },
      { type: "tool.completed", result: { callId: "call_1" } },
      { type: "tool.started", call: { id: "call_2" } },
      { type: "tool.completed", result: { callId: "call_2" } },
    ]);
  });
});
