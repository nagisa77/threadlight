import { randomUUID } from "node:crypto";

import { ModelSession } from "./model-session.js";
import { mergeAdditionalInput, skippedToolResult } from "./run-input.js";
import { RunStatistics } from "./run-statistics.js";
import { executeTool } from "./tool-executor.js";
import type {
  Agent,
  AgentEvent,
  ModelProvider,
  RunOptions,
  RunResult,
  ToolResult,
} from "./types.js";

const EMPTY_RESPONSE_RETRY_INSTRUCTION =
  "Your previous response contained neither visible content nor a tool call. Continue by returning a non-empty response or calling an available tool.";
const MAX_CONSECUTIVE_COMPLETION_REJECTIONS = 3;
const MAX_CONSECUTIVE_EMPTY_RESPONSES = 3;

export class AgentLoop {
  constructor(private readonly provider: ModelProvider) {}

  async run(
    agent: Agent,
    input: string,
    options: RunOptions = {},
  ): Promise<RunResult> {
    const runId = randomUUID();
    const emit = (event: AgentEvent) => options.onEvent?.(event);
    const statistics = new RunStatistics(options.now);
    const startedAt = statistics.now();

    emit({ type: "run.started", runId });

    try {
      return await this.execute(
        agent,
        input,
        runId,
        startedAt,
        options,
        statistics,
        emit,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "run.failed",
        runId,
        error: message,
        durationMs: statistics.elapsedSince(startedAt),
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
    statistics: RunStatistics,
    emit: (event: AgentEvent) => void,
  ): Promise<RunResult> {
    const tools = agent.tools ?? [];
    const maxSteps = agent.maxSteps ?? 5_000;
    const checkpointHistory = options.checkpointHistory === true;
    const modelSession = new ModelSession(options);
    let toolResults: ToolResult[] = [];
    let continuationInput: string | undefined;
    let consecutiveCompletionRejections = 0;
    let consecutiveEmptyResponses = 0;

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
      const advertisedTools = directive.tools ?? tools;
      const instructions = directive.instructions
        ? `${agent.instructions}\n\n${directive.instructions}`
        : agent.instructions;
      const modelInput =
        step === 1
          ? mergeAdditionalInput(input, boundaryInput)
          : mergeAdditionalInput(continuationInput, boundaryInput);
      continuationInput = undefined;

      const modelRequestOptions = {
        runId,
        step,
        agent: { ...agent, instructions, tools: advertisedTools },
        request: {
          model: agent.model,
          provider: agent.provider,
          instructions,
          input: modelInput,
          attachments: directive.attachments,
          toolResults,
          tools: advertisedTools,
          signal: options.signal,
        },
      };
      const preparation = options.beforeModelRequest
        ? await modelSession.prepareRequest({
            ...modelRequestOptions,
            beforeModelRequest: options.beforeModelRequest,
          })
        : modelSession.createRequest(modelRequestOptions);
      if (preparation.contextReplaced) {
        toolResults = [];
        statistics.addUsage(preparation.usage);
        if (preparation.compaction) {
          emit({
            type: "context.compacted",
            runId,
            step,
            ...preparation.compaction,
            usage: preparation.usage,
          });
        }
        await options.onCheckpoint?.(
          modelSession.compactionCheckpoint(step, statistics.snapshot()),
        );
      }

      if (options.onCheckpoint) {
        await options.onCheckpoint(
          modelSession.checkpoint(
            step,
            "model_started",
            statistics.snapshot(),
            [],
            checkpointHistory,
          ),
        );
      }

      emit({ type: "model.started", runId, step });

      const modelStartedAt = statistics.now();
      let ttftMs: number | undefined;
      const turn = await this.provider.generate(preparation.request, {
        onEvent: (event) => {
          if (event.type === "output_text.delta") {
            const firstTextDelta =
              ttftMs === undefined && event.delta.length > 0;
            if (firstTextDelta) {
              ttftMs = statistics.elapsedSince(modelStartedAt);
            }
            emit({
              type: "model.output_text.delta",
              runId,
              step,
              delta: event.delta,
              ...(firstTextDelta ? { ttftMs } : {}),
              outputVisibility,
            });
            return;
          }
          emit({
            type: "model.retrying",
            runId,
            step,
            retryAttempt: event.retryAttempt,
            maxRetries: event.maxRetries,
            reason: event.reason,
            ...(event.discardPartialOutput
              ? { discardPartialOutput: true }
              : {}),
          });
        },
      });

      emit({
        type: "model.completed",
        runId,
        step,
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: turn.usage,
        durationMs: statistics.elapsedSince(modelStartedAt),
        ...(ttftMs === undefined ? {} : { ttftMs }),
        outputVisibility,
      });

      modelSession.completeTurn(turn);
      statistics.addUsage(turn.usage);
      await options.onCheckpoint?.(
        modelSession.checkpoint(
          step,
          "model_completed",
          statistics.snapshot(),
          [],
          checkpointHistory,
        ),
      );

      const additionalInput = options.takeAdditionalInput
        ? await options.takeAdditionalInput()
        : undefined;
      if (additionalInput) {
        consecutiveCompletionRejections = 0;
        consecutiveEmptyResponses = 0;
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
        const controlledOutput = options.controller?.resolveCompletionOutput
          ? await options.controller.resolveCompletionOutput(
              turn,
              controllerContext,
            )
          : undefined;
        const output = controlledOutput ?? turn.text;
        if (!output.trim()) {
          consecutiveEmptyResponses += 1;
          if (consecutiveEmptyResponses >= MAX_CONSECUTIVE_EMPTY_RESPONSES) {
            throw new Error(
              `Model provider returned no visible content or tool calls after ${MAX_CONSECUTIVE_EMPTY_RESPONSES} attempts.`,
            );
          }
          consecutiveCompletionRejections = 0;
          continuationInput = EMPTY_RESPONSE_RETRY_INSTRUCTION;
          toolResults = [];
          continue;
        }
        consecutiveEmptyResponses = 0;
        const completionError = options.controller?.validateCompletion
          ? await options.controller.validateCompletion(turn, controllerContext)
          : undefined;
        if (completionError) {
          consecutiveCompletionRejections += 1;
          if (
            consecutiveCompletionRejections >=
            MAX_CONSECUTIVE_COMPLETION_REJECTIONS
          ) {
            throw new Error(
              `Agent could not satisfy completion requirements after ${MAX_CONSECUTIVE_COMPLETION_REJECTIONS} attempts: ${completionError}`,
            );
          }
          continuationInput = completionError;
          toolResults = [];
          continue;
        }
        consecutiveCompletionRejections = 0;
        emit({ type: "message.completed", runId, text: output });
        const durationMs = statistics.elapsedSince(startedAt);
        emit({ type: "run.completed", runId, steps: step, durationMs });

        return {
          runId,
          output,
          steps: step,
          durationMs,
          ...modelSession.resultContext(),
          usage: statistics.snapshot(),
        };
      }

      consecutiveCompletionRejections = 0;
      consecutiveEmptyResponses = 0;
      toolResults = [];
      for (const [index, call] of turn.toolCalls.entries()) {
        options.signal?.throwIfAborted();
        toolResults.push(
          await executeTool({
            call,
            tools,
            runId,
            step,
            runOptions: options,
            statistics,
            emit,
            startedCheckpoint: modelSession.checkpoint(
              step,
              "tool_started",
              statistics.snapshot(),
              toolResults,
              checkpointHistory,
            ),
          }),
        );
        await options.onCheckpoint?.(
          modelSession.checkpoint(
            step,
            "tool_completed",
            statistics.snapshot(),
            toolResults,
            checkpointHistory,
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
}
