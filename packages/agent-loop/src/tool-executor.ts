import { RunStatistics } from "./run-statistics.js";
import { serializeValue } from "./runtime-value.js";
import { toolErrorMetadata } from "./tool-error.js";
import type {
  AgentEvent,
  AgentRunCheckpoint,
  RunOptions,
  Tool,
  ToolCall,
  ToolResult,
} from "./types.js";

interface ExecuteToolOptions {
  call: ToolCall;
  tools: readonly Tool[];
  runId: string;
  step: number;
  runOptions: RunOptions;
  statistics: RunStatistics;
  emit: (event: AgentEvent) => void;
  startedCheckpoint: AgentRunCheckpoint;
}

/** Executes one provider-neutral tool call and reports its lifecycle. */
export async function executeTool({
  call,
  tools,
  runId,
  step,
  runOptions,
  statistics,
  emit,
  startedCheckpoint,
}: ExecuteToolOptions): Promise<ToolResult> {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (call.argumentError) {
    emit({ type: "tool.started", runId, call });
    await runOptions.onCheckpoint?.(startedCheckpoint);
    const toolStartedAt = statistics.now();
    const result: ToolResult = {
      callId: call.id,
      name: call.name,
      output: call.argumentError,
      ...(tool?.kind ? { kind: tool.kind } : {}),
      isError: true,
    };
    emit({
      type: "tool.completed",
      runId,
      result,
      durationMs: statistics.elapsedSince(toolStartedAt),
    });
    return result;
  }

  const controllerContext = { runId, step, tools };
  const decision = runOptions.controller?.beforeToolCall
    ? await runOptions.controller.beforeToolCall(call, tool, controllerContext)
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
  await runOptions.onCheckpoint?.(startedCheckpoint);
  const toolStartedAt = statistics.now();

  let result: ToolResult;
  try {
    const output = await tool.execute(call.arguments, {
      runId,
      ...(runOptions.toolScopeId ? { scopeId: runOptions.toolScopeId } : {}),
      signal: runOptions.signal ?? new AbortController().signal,
    });
    result = {
      callId: call.id,
      name: call.name,
      output: serializeValue(output),
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
    durationMs: statistics.elapsedSince(toolStartedAt),
  });
  if (runOptions.controller?.afterToolCall) {
    await runOptions.controller.afterToolCall(call, result, controllerContext);
  }
  return result;
}
