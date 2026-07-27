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
import {
  ATTACH_TO_MODEL_CONTEXT_TOOL,
  attachmentPrompt,
  createAttachmentContextTool,
  type AttachmentDelivery,
} from "./attachment-tool.js";

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

export const DEFAULT_MAX_PERSISTED_MODEL_STATE_BYTES = 5 * 1024 * 1024;

export interface AgentLoopOptions {
  maxPersistedModelStateBytes?: number;
}

export class AgentLoop {
  private readonly maxPersistedModelStateBytes: number;

  constructor(
    private readonly provider: ModelProvider,
    options: AgentLoopOptions = {},
  ) {
    const maxBytes =
      options.maxPersistedModelStateBytes ??
      DEFAULT_MAX_PERSISTED_MODEL_STATE_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error("maxPersistedModelStateBytes must be a positive integer");
    }
    this.maxPersistedModelStateBytes = maxBytes;
  }

  prepareModelStateForPersistence(state: unknown): unknown {
    if (state === undefined) return;
    const prepared =
      this.provider.prepareStateForPersistence?.(state, {
        maxBytes: this.maxPersistedModelStateBytes,
      }) ?? state;
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(prepared);
    } catch (error) {
      throw new Error(
        `Model state is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (serialized === undefined) {
      throw new Error("Model state is not JSON-serializable");
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > this.maxPersistedModelStateBytes) {
      throw new Error(
        `Model state is ${bytes} bytes and exceeds the ${this.maxPersistedModelStateBytes}-byte persistence limit`,
      );
    }
    return prepared;
  }

  async run(
    agent: Agent,
    input: string,
    options: RunOptions = {},
  ): Promise<RunResult> {
    const runId = randomUUID();
    const emit = (event: AgentEvent) => options.onEvent?.(event);

    emit({ type: "run.started", runId });

    try {
      return await this.execute(agent, input, runId, options, emit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "run.failed", runId, error: message });
      throw error;
    }
  }

  private async execute(
    agent: Agent,
    input: string,
    runId: string,
    options: RunOptions,
    emit: (event: AgentEvent) => void,
  ): Promise<RunResult> {
    const availableAttachments = options.attachments ?? [];
    const attachmentDelivery: AttachmentDelivery = { pending: [] };
    const attachmentTool = createAttachmentContextTool(
      this.provider,
      availableAttachments,
      attachmentDelivery,
    );
    const tools = [
      ...(agent.tools ?? []),
      ...(attachmentTool ? [attachmentTool] : []),
    ];
    if (
      attachmentTool &&
      (agent.tools ?? []).some(
        (tool) => tool.name === ATTACH_TO_MODEL_CONTEXT_TOOL,
      )
    ) {
      throw new Error(
        `${ATTACH_TO_MODEL_CONTEXT_TOOL} is reserved by the agent loop`,
      );
    }
    const maxSteps = agent.maxSteps ?? 100;
    const usage = { ...EMPTY_USAGE };
    let state = options.modelState;
    let toolResults: ToolResult[] = [];
    let continuationInput: string | undefined;

    for (let step = 1; step <= maxSteps; step += 1) {
      options.signal?.throwIfAborted();
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
          ? attachmentPrompt(input, availableAttachments)
          : continuationInput;
      continuationInput = undefined;

      const turn = await this.provider.generate(
        {
          model: agent.model,
          instructions,
          input: modelInput,
          attachments:
            attachmentDelivery.pending.length > 0
              ? attachmentDelivery.pending
              : undefined,
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
      attachmentDelivery.pending = [];

      emit({
        type: "model.completed",
        runId,
        step,
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: turn.usage,
        outputVisibility,
      });

      state = turn.state;
      addUsage(usage, turn.usage);

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
        emit({ type: "run.completed", runId, steps: step });

        return {
          runId,
          output,
          steps: step,
          modelState: state,
          usage,
        };
      }

      toolResults = [];
      for (const call of turn.toolCalls) {
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
      };
    } catch (error) {
      result = {
        callId: call.id,
        name: call.name,
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }

    emit({ type: "tool.completed", runId, result });
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
