import { randomUUID } from "node:crypto";

import type {
  Agent,
  AgentEvent,
  ApprovalRequest,
  ModelProvider,
  RunOptions,
  RunResult,
  TokenUsage,
  Tool,
  ToolCall,
  ToolResult,
} from "./types.js";

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
    const tools = agent.tools ?? [];
    const maxSteps = agent.maxSteps ?? 20;
    const usage = { ...EMPTY_USAGE };
    let state = options.modelState;
    let toolResults: ToolResult[] = [];

    for (let step = 1; step <= maxSteps; step += 1) {
      options.signal?.throwIfAborted();
      emit({ type: "model.started", runId, step });

      const turn = await this.provider.generate({
        model: agent.model,
        instructions: agent.instructions,
        input: step === 1 ? input : undefined,
        state,
        toolResults,
        tools,
        signal: options.signal,
      });

      state = turn.state;
      addUsage(usage, turn.usage);

      if (turn.toolCalls.length === 0) {
        emit({ type: "message.completed", runId, text: turn.text });
        emit({ type: "run.completed", runId, steps: step });

        return {
          runId,
          output: turn.text,
          steps: step,
          modelState: state,
          usage,
        };
      }

      toolResults = [];
      for (const call of turn.toolCalls) {
        options.signal?.throwIfAborted();
        toolResults.push(
          await this.executeTool(call, tools, runId, options, emit),
        );
      }
    }

    throw new Error(`Agent exceeded maxSteps (${maxSteps})`);
  }

  private async executeTool(
    call: ToolCall,
    tools: readonly Tool[],
    runId: string,
    options: RunOptions,
    emit: (event: AgentEvent) => void,
  ): Promise<ToolResult> {
    const tool = tools.find((candidate) => candidate.name === call.name);
    if (!tool) {
      return {
        callId: call.id,
        name: call.name,
        output: `Unknown tool: ${call.name}`,
        isError: true,
      };
    }

    if (requiresApproval(tool, call.arguments)) {
      const request: ApprovalRequest = {
        id: randomUUID(),
        runId,
        call,
      };

      emit({ type: "approval.requested", request });
      const approved = options.approve
        ? await options.approve(request)
        : false;
      emit({ type: "approval.resolved", request, approved });
      options.signal?.throwIfAborted();

      if (!approved) {
        return {
          callId: call.id,
          name: call.name,
          output: "Tool execution was not approved",
          isError: true,
        };
      }
    }

    emit({ type: "tool.started", runId, call });

    let result: ToolResult;
    try {
      const output = await tool.execute(call.arguments, {
        runId,
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
    return result;
  }
}

function requiresApproval(tool: Tool, arguments_: unknown): boolean {
  return typeof tool.needsApproval === "function"
    ? tool.needsApproval(arguments_)
    : (tool.needsApproval ?? false);
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
