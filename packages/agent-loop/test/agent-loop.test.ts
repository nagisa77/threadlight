import { describe, expect, it, vi } from "vitest";

import { AgentLoop } from "../src/agent-loop.js";
import { defineAgent, defineTool } from "../src/types.js";
import type {
  AgentEvent,
  BeforeModelRequestContext,
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
        toolCalls: [{ id: "call_1", name: "double", arguments: { value: 21 } }],
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
  it("prepares every model request and can replace opaque tool linkage with visible history", async () => {
    const requests: ModelRequest[] = [];
    const checkpoints: Array<{
      phase: string;
      contextHistory?: readonly { role: string; text: string }[];
    }> = [];
    const beforeModelRequest = vi.fn(
      async (context: BeforeModelRequestContext) => {
        if (context.step !== 2) return;
        return {
          history: context.fallbackHistory,
          clearModelState: true as const,
          consumePendingContext: true as const,
          usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
          compaction: {
            generation: 1,
            tokensBefore: 120,
            tokensAfter: 30,
            messagesCompacted: 1,
            durationMs: 4,
          },
        };
      },
    );
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "Checking",
            toolCalls: [
              { id: "call-read", name: "read", arguments: { path: "a" } },
            ],
            state: { opaque: "call-read" },
            usage: { inputTokens: 90, outputTokens: 5, totalTokens: 95 },
          };
        }
        return {
          text: "Done",
          toolCalls: [],
          state: { compacted: true },
          usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
        };
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "compactable",
        instructions: "Inspect",
        tools: [
          defineTool({
            name: "read",
            description: "Read a file",
            parameters: { type: "object" },
            async execute() {
              return "file contents";
            },
          }),
        ],
      }),
      "Start",
      {
        beforeModelRequest,
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
      },
    );

    expect(beforeModelRequest).toHaveBeenCalledTimes(2);
    expect(requests[1]).toMatchObject({
      state: undefined,
      input: undefined,
      toolResults: [],
    });
    expect(requests[1]?.history).toEqual([
      { role: "user", text: "Start" },
      {
        role: "assistant",
        text: "Checking",
        toolCalls: [
          { id: "call-read", name: "read", arguments: { path: "a" } },
        ],
      },
      {
        role: "user",
        text: "",
        toolResults: [
          { callId: "call-read", name: "read", output: "file contents" },
        ],
      },
    ]);
    expect(checkpoints).toContainEqual(
      expect.objectContaining({
        phase: "context_compacted",
        modelState: undefined,
        contextHistory: expect.any(Array),
      }),
    );
    expect(result.usage).toEqual({
      inputTokens: 127,
      outputTokens: 13,
      totalTokens: 140,
    });
    expect(result.contextHistory?.at(-1)?.text).toBe("Done");
    expect(result.contextTokens).toBe(35);
  });

  it("defaults the agent step limit to 5000", async () => {
    let requests = 0;
    const provider: ModelProvider = {
      async generate() {
        requests += 1;
        return { text: "", toolCalls: [] };
      },
    };

    await expect(
      new AgentLoop(provider).run(
        defineAgent({ name: "default-step-limit", instructions: "Continue" }),
        "Run until the default step limit",
      ),
    ).rejects.toThrow("Agent exceeded maxSteps (5000)");
    expect(requests).toBe(5_000);
  });

  it("forwards provider-neutral retry progress from a scripted provider", async () => {
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      async generate(_request, options) {
        options?.onEvent?.({
          type: "retry",
          retryAttempt: 1,
          maxRetries: 1,
          reason: "connection_lost",
          discardPartialOutput: true,
        });
        return { text: "Recovered", toolCalls: [] };
      },
    };

    await new AgentLoop(provider).run(
      defineAgent({ name: "retry-progress", instructions: "Respond" }),
      "Build",
      { onEvent: (event) => events.push(event) },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model.retrying",
        step: 1,
        retryAttempt: 1,
        maxRetries: 1,
        reason: "connection_lost",
        discardPartialOutput: true,
      }),
    );
  });

  it("retries a model turn that has neither content nor tool calls", async () => {
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return requests.length === 1
          ? { text: "", toolCalls: [], state: { step: 1 } }
          : { text: "Recovered response", toolCalls: [], state: { step: 2 } };
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({ name: "empty-retry", instructions: "Respond" }),
      "Install globally",
    );

    expect(result.output).toBe("Recovered response");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      state: { step: 1 },
      input: expect.stringContaining("neither visible content nor a tool call"),
    });
  });

  it("returns invalid tool arguments to the model without approval or execution", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn();
    const beforeToolCall = vi.fn();
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I’ll create the file.",
            toolCalls: [
              {
                id: "call-invalid",
                name: "exec_command",
                arguments: {},
                argumentError:
                  "Model returned invalid JSON arguments for tool exec_command. Retry the tool call with one valid JSON object matching its schema.",
              },
            ],
          } as ModelTurn;
        }
        expect(request.toolResults).toEqual([
          {
            callId: "call-invalid",
            name: "exec_command",
            output:
              "Model returned invalid JSON arguments for tool exec_command. Retry the tool call with one valid JSON object matching its schema.",
            isError: true,
          },
        ]);
        return { text: "Recovered after retrying safely.", toolCalls: [] };
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "invalid-arguments",
        instructions: "Use tools",
        tools: [
          defineTool({
            name: "exec_command",
            description: "Execute a command",
            parameters: { type: "object" },
            execute,
          }),
        ],
      }),
      "Create a presentation",
      {
        controller: { beforeToolCall },
        onEvent: (event) => events.push(event),
      },
    );

    expect(result.output).toBe("Recovered after retrying safely.");
    expect(execute).not.toHaveBeenCalled();
    expect(beforeToolCall).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        result: expect.objectContaining({
          callId: "call-invalid",
          isError: true,
        }),
      }),
    );
  });

  it("records provider-neutral model, tool, and run durations", async () => {
    let tick = 0;
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        return request.toolResults?.length
          ? { text: "done", toolCalls: [] }
          : {
              text: "checking",
              toolCalls: [{ id: "call-1", name: "check", arguments: {} }],
            };
      },
    };
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "timed",
        instructions: "Measure this run",
        tools: [
          defineTool({
            name: "check",
            description: "Check",
            parameters: { type: "object" },
            async execute() {
              return "ok";
            },
          }),
        ],
      }),
      "Run",
      {
        now: () => (tick += 5),
        onEvent: (event) => events.push(event),
      },
    );

    expect(result.durationMs).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "model.completed")).toEqual([
      expect.objectContaining({ durationMs: 5 }),
      expect.objectContaining({ durationMs: 5 }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        durationMs: 5,
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      durationMs: result.durationMs,
    });
  });

  it("lets a provider-neutral controller narrow tools and continue after rejecting completion", async () => {
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return requests.length === 1
          ? { text: "Too early", toolCalls: [] }
          : { text: "Accepted", toolCalls: [] };
      },
    };
    let completionChecks = 0;
    const readTool = defineTool({
      name: "read",
      mutability: "read",
      description: "Read",
      parameters: { type: "object" },
      async execute() {
        return "read";
      },
    });
    const hiddenTool = defineTool({
      name: "write",
      mutability: "write",
      description: "Write",
      parameters: { type: "object" },
      async execute() {
        return "written";
      },
    });

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "controlled",
        instructions: "Base instructions",
        tools: [readTool, hiddenTool],
      }),
      "Start",
      {
        controller: {
          beforeModel() {
            return {
              instructions: "Controller state",
              tools: [readTool],
            };
          },
          validateCompletion() {
            completionChecks += 1;
            return completionChecks === 1
              ? "Completion rejected; continue."
              : undefined;
          },
        },
      },
    );

    expect(result.output).toBe("Accepted");
    expect(requests[0]?.instructions).toBe(
      "Base instructions\n\nController state",
    );
    expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(requests[1]?.input).toBe("Completion rejected; continue.");
  });

  it("fails fast when a model repeatedly ignores completion requirements", async () => {
    const requests: ModelRequest[] = [];
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return {
          text: `<tool_call name="wait_for_agents" call_id="plain-text-${requests.length}">\n{}\n</tool_call>`,
          toolCalls: [],
        };
      },
    };

    await expect(
      new AgentLoop(provider).run(
        defineAgent({ name: "guarded", instructions: "Use tools" }),
        "Finish after collecting subagents",
        {
          controller: {
            validateCompletion: () =>
              "Subagents are still active. Call wait_for_agents before finishing.",
          },
          onEvent: (event) => events.push(event),
        },
      ),
    ).rejects.toThrow(
      "could not satisfy completion requirements after 3 attempts",
    );

    expect(requests).toHaveLength(3);
    expect(requests[1]?.input).toContain("Subagents are still active");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "run.failed" }),
    );
  });

  it("lets runtime control choose canonical output without changing provider state", async () => {
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      async generate() {
        return {
          text: "Choose one of the directions above.",
          toolCalls: [],
          state: [{ providerText: "Choose one of the directions above." }],
        };
      },
    };
    const canonical = "Choose one:\n1. Alpha\n2. Beta";

    const result = await new AgentLoop(provider).run(
      defineAgent({ name: "controlled", instructions: "Reply" }),
      "Continue",
      {
        controller: {
          resolveCompletionOutput: () => canonical,
        },
        onEvent: (event) => events.push(event),
      },
    );

    expect(result.output).toBe(canonical);
    expect(result.modelState).toEqual([
      { providerText: "Choose one of the directions above." },
    ]);
    expect(events).toContainEqual({
      type: "message.completed",
      runId: result.runId,
      text: canonical,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model.completed",
        text: "Choose one of the directions above.",
      }),
    );
  });

  it("forwards controller-provided attachments without owning attachment policy", async () => {
    const requests: ModelRequest[] = [];
    const attachment = {
      id: "attachment-1",
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image" as const,
      path: "/workspace/diagram.png",
      providerReference: { protocol: "scripted", fileId: "file-1" },
    };
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        return { text: "done", toolCalls: [] };
      },
    };

    await new AgentLoop(provider).run(
      defineAgent({ name: "test", instructions: "Reply" }),
      "Inspect the image",
      {
        controller: {
          beforeModel: () => ({ attachments: [attachment] }),
        },
      },
    );

    expect(requests[0]?.attachments).toEqual([attachment]);
  });

  it("lets a scripted model recover after a computer tool failure", async () => {
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I’ll continue in the shared app.",
            toolCalls: [
              {
                id: "computer-call-1",
                name: "computer",
                arguments: {
                  actions: [{ type: "keypress", keys: ["CMD", "L"] }],
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          expect(request.toolResults).toEqual([
            {
              callId: "computer-call-1",
              name: "computer",
              output: "No content is shared",
              kind: "computer",
              isError: true,
            },
          ]);
          return {
            text: "The share ended, so I’ll restore it.",
            toolCalls: [
              {
                id: "share-call-1",
                name: "computer_share",
                arguments: { action: "list" },
              },
            ],
          };
        }
        return { text: "Recovered and continued.", toolCalls: [] };
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Recover from computer errors",
        tools: [
          defineTool({
            name: "computer",
            kind: "computer",
            description: "Control the computer",
            parameters: { type: "object" },
            async execute() {
              throw new Error("No content is shared");
            },
          }),
          defineTool({
            name: "computer_share",
            description: "Select shared content",
            parameters: { type: "object" },
            async execute() {
              return { targets: ["Safari"] };
            },
          }),
        ],
      }),
      "Continue researching",
    );

    expect(result.output).toBe("Recovered and continued.");
    expect(requests).toHaveLength(3);
  });

  it("passes the provider-neutral task scope to tools", async () => {
    const provider = new ScriptedProvider();
    let receivedScopeId: string | undefined;

    await new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Use the tool",
        tools: [
          defineTool({
            name: "double",
            description: "Double a number",
            parameters: { type: "object" },
            async execute(_arguments, context) {
              receivedScopeId = context.scopeId;
              return 42;
            },
          }),
        ],
      }),
      "Double 21",
      { toolScopeId: "thread-1" },
    );

    expect(receivedScopeId).toBe("thread-1");
  });

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
    expect(events.some((event) => event.type === "model.completed")).toBe(
      false,
    );

    finishGeneration();
    await expect(resultPending).resolves.toMatchObject({
      output: "Hello world",
    });
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

  it("measures TTFT from model start to the first non-empty text delta", async () => {
    let clock = 0;
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      async generate(_request, options) {
        clock = 325;
        options?.onEvent?.({ type: "output_text.delta", delta: "Hello" });
        clock = 500;
        options?.onEvent?.({ type: "output_text.delta", delta: " world" });
        return { text: "Hello world", toolCalls: [] };
      },
    };

    await new AgentLoop(provider).run(
      defineAgent({ name: "ttft", instructions: "Reply" }),
      "Hello",
      { now: () => clock, onEvent: (event) => events.push(event) },
    );

    expect(
      events.filter((event) => event.type === "model.output_text.delta"),
    ).toEqual([
      expect.objectContaining({ delta: "Hello", ttftMs: 325 }),
      expect.not.objectContaining({ ttftMs: expect.anything() }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model.completed",
        step: 1,
        ttftMs: 325,
      }),
    );
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
        toolCalls: [{ id: "call_1", name: "double", arguments: { value: 21 } }],
      },
      {
        type: "model.completed",
        step: 2,
        text: "The answer is 42",
        toolCalls: [],
      },
    ]);
  });

  it("injects scripted user input at a safe boundary without losing model state or tool linkage", async () => {
    const firstGeneration = Promise.withResolvers<void>();
    const requests: ModelRequest[] = [];
    let executions = 0;
    let additionalInput: string | undefined;
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          await firstGeneration.promise;
          return {
            text: "I will make the stale edit.",
            toolCalls: [{ id: "stale-call", name: "write", arguments: {} }],
            state: { responseId: "opaque-1" },
          };
        }
        return { text: "Used the newer instruction.", toolCalls: [] };
      },
    };
    const resultPending = new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Follow the latest instruction",
        tools: [
          defineTool({
            name: "write",
            description: "Write",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
            },
          }),
        ],
      }),
      "Make the old edit",
      {
        takeAdditionalInput() {
          const value = additionalInput;
          additionalInput = undefined;
          return value;
        },
      },
    );

    additionalInput = "Do not edit; explain instead";
    firstGeneration.resolve();
    await expect(resultPending).resolves.toMatchObject({
      output: "Used the newer instruction.",
    });

    expect(executions).toBe(0);
    expect(requests[1]?.state).toEqual({ responseId: "opaque-1" });
    expect(requests[1]?.input).toContain("Do not edit; explain instead");
    expect(requests[1]?.toolResults).toEqual([
      expect.objectContaining({
        callId: "stale-call",
        name: "write",
        isError: true,
      }),
    ]);
  });

  it("executes tool calls directly", async () => {
    const provider = new ScriptedProvider();
    const loop = new AgentLoop(provider);
    let executions = 0;

    const result = await loop.run(
      defineAgent({
        name: "test",
        instructions: "Use the tool",
        tools: [
          defineTool({
            name: "double",
            description: "Double a number",
            parameters: { type: "object" },
            async execute() {
              executions += 1;
              return 42;
            },
          }),
        ],
      }),
      "Double 21",
    );

    expect(result.output).toBe("The answer is 42");
    expect(executions).toBe(1);
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
          text:
            request.toolResults?.map((result) => result.output).join(", ") ??
            "",
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
