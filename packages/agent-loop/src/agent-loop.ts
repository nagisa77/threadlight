import { randomUUID } from "node:crypto";

import type {
  Agent,
  AgentEvent,
  ModelProvider,
  RunOptions,
  RunResult,
  TokenUsage,
  Tool,
  ToolCall,
  ToolResult,
} from "./types.js";
import { toolErrorMetadata } from "./tool-error.js";

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export class AgentLoop {
  constructor(private readonly provider: ModelProvider) {}

  async run(
    agent: Agent,
    input: string,
    options: RunOptions = {},
  ): Promise<RunResult> {
    const runId = randomUUID();
    const emit = (event: AgentEvent) => options.onEvent?.(event);
    const startedAt = currentTime(options);

    emit({ type: "run.started", runId });

    try {
      return await this.execute(
        agent,
        input,
        runId,
        startedAt,
        options,
        emit,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "run.failed",
        runId,
        error: message,
        durationMs: elapsed(startedAt, options),
      });
      throw error;
    }
  }

  private async execute(
    agent: Agent,
    input: string,
    runId: string,
    startedAt: number,
    options: RunOptions,
    emit: (event: AgentEvent) => void,
  ): Promise<RunResult> {
    const tools = agent.tools ?? [];
    const maxSteps = agent.maxSteps ?? 100;
    const usage = { ...EMPTY_USAGE };
    let state = options.modelState;
    let toolResults: ToolResult[] = [];
    let continuationInput: string | undefined;

    for (let step = 1; step <= maxSteps; step += 1) {
      options.signal?.throwIfAborted();
      const boundaryInput = options.takeAdditionalInput
        ? await options.takeAdditionalInput()
        : undefined;
      const controllerContext = { runId, step, tools };
      const directive = options.controller?.beforeModel
        ? await options.controller.beforeModel(controllerContext)
        : {};
      const outputVisibility = directive.outputVisibility ?? "user";
      emit({ type: "model.started", runId, step });
      const advertisedTools = directive.tools ?? tools;
      const instructions = directive.instructions
        ? `${agent.instructions}\n\n${directive.instructions}`
        : agent.instructions;
      const modelInput =
        step === 1
          ? mergeAdditionalInput(input, boundaryInput)
          : mergeAdditionalInput(continuationInput, boundaryInput);
      continuationInput = undefined;

      const modelStartedAt = currentTime(options);
      const turn = await this.provider.generate(
        {
          model: agent.model,
          instructions,
          input: modelInput,
          attachments: directive.attachments,
          state,
          toolResults,
          tools: advertisedTools,
          signal: options.signal,
        },
        {
          onEvent: (event) => {
            if (event.type === "output_text.delta") {
              emit({
                type: "model.output_text.delta",
                runId,
                step,
                delta: event.delta,
                outputVisibility,
              });
            }
          },
        },
      );

      emit({
        type: "model.completed",
        runId,
        step,
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: turn.usage,
        durationMs: elapsed(modelStartedAt, options),
        outputVisibility,
      });

      state = turn.state;
      addUsage(usage, turn.usage);

      const additionalInput = options.takeAdditionalInput
        ? await options.takeAdditionalInput()
        : undefined;
      if (additionalInput) {
        continuationInput = mergeAdditionalInput(
          continuationInput,
          additionalInput,
        );
        toolResults = turn.toolCalls.map((call) =>
          skippedToolResult(call, tools),
        );
        continue;
      }

      if (turn.toolCalls.length === 0) {
        const completionError = options.controller?.validateCompletion
          ? await options.controller.validateCompletion(
              turn,
              controllerContext,
            )
          : undefined;
        if (completionError) {
          continuationInput = completionError;
          toolResults = [];
          continue;
        }
        const controlledOutput = options.controller?.resolveCompletionOutput
          ? await options.controller.resolveCompletionOutput(
              turn,
              controllerContext,
            )
          : undefined;
        const output = controlledOutput ?? turn.text;
        emit({ type: "message.completed", runId, text: output });
        const durationMs = elapsed(startedAt, options);
        emit({ type: "run.completed", runId, steps: step, durationMs });

        return {
          runId,
          output,
          steps: step,
          durationMs,
          modelState: state,
          usage,
        };
      }

      toolResults = [];
      for (const [index, call] of turn.toolCalls.entries()) {
        options.signal?.throwIfAborted();
        toolResults.push(
          await this.executeTool(
            call,
            tools,
            runId,
            step,
            options,
            emit,
          ),
        );
        const additionalInput = options.takeAdditionalInput
          ? await options.takeAdditionalInput()
          : undefined;
        if (additionalInput) {
          continuationInput = mergeAdditionalInput(
            continuationInput,
            additionalInput,
          );
          toolResults.push(
            ...turn.toolCalls
              .slice(index + 1)
              .map((pendingCall) => skippedToolResult(pendingCall, tools)),
          );
          break;
        }
      }
    }

    throw new Error(`Agent exceeded maxSteps (${maxSteps})`);
  }

  private async executeTool(
    call: ToolCall,
    tools: readonly Tool[],
    runId: string,
    step: number,
    options: RunOptions,
    emit: (event: AgentEvent) => void,
  ): Promise<ToolResult> {
    const tool = tools.find((candidate) => candidate.name === call.name);
    const controllerContext = { runId, step, tools };
    const decision = options.controller?.beforeToolCall
      ? await options.controller.beforeToolCall(
          call,
          tool,
          controllerContext,
        )
      : undefined;
    if (decision && !decision.allowed) {
      return {
        callId: call.id,
        name: call.name,
        output: decision.message ?? `Tool call rejected: ${call.name}`,
        ...(tool?.kind ? { kind: tool.kind } : {}),
        isError: true,
      };
    }
    if (!tool) {
      return {
        callId: call.id,
        name: call.name,
        output: `Unknown tool: ${call.name}`,
        isError: true,
      };
    }

    emit({ type: "tool.started", runId, call });
    const toolStartedAt = currentTime(options);

    let result: ToolResult;
    try {
      const output = await tool.execute(call.arguments, {
        runId,
        ...(options.toolScopeId ? { scopeId: options.toolScopeId } : {}),
        signal: options.signal ?? new AbortController().signal,
      });
      result = {
        callId: call.id,
        name: call.name,
        output: serialize(output),
        ...(tool.kind ? { kind: tool.kind } : {}),
      };
    } catch (error) {
      const metadata = toolErrorMetadata(error);
      result = {
        callId: call.id,
        name: call.name,
        output: error instanceof Error ? error.message : String(error),
        ...(tool.kind ? { kind: tool.kind } : {}),
        isError: true,
        ...(metadata ? { error: metadata } : {}),
      };
    }

    emit({
      type: "tool.completed",
      runId,
      result,
      durationMs: elapsed(toolStartedAt, options),
    });
    if (options.controller?.afterToolCall) {
      await options.controller.afterToolCall(
        call,
        result,
        controllerContext,
      );
    }
    return result;
  }
}

function currentTime(options: RunOptions): number {
  return options.now?.() ?? performance.now();
}

function elapsed(startedAt: number, options: RunOptions): number {
  return Math.max(0, Math.round((currentTime(options) - startedAt) * 10) / 10);
}

function mergeAdditionalInput(
  current: string | undefined,
  additional: string | undefined,
): string | undefined {
  const next = additional?.trim();
  if (!next) return current;
  const block =
    `[Additional user instruction received while the run was active]\n${next}`;
  return current ? `${current}\n\n${block}` : block;
}

function skippedToolResult(
  call: ToolCall,
  tools: readonly Tool[],
): ToolResult {
  const kind = tools.find(({ name }) => name === call.name)?.kind;
  return {
    callId: call.id,
    name: call.name,
    output:
      "Skipped because the user added a newer instruction. Re-evaluate the task before calling tools again.",
    ...(kind ? { kind } : {}),
    isError: true,
  };
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}

function addUsage(
  total: TokenUsage,
  next: Partial<TokenUsage> | undefined,
): void {
  total.inputTokens += next?.inputTokens ?? 0;
  total.outputTokens += next?.outputTokens ?? 0;
  total.totalTokens += next?.totalTokens ?? 0;
}
