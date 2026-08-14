import { ToolExecutionError } from "./tool-error.js";
import type { AgentOrchestrator } from "./agent-orchestrator.js";
import type { Deferred } from "./orchestrator-types.js";
import type {
  AgentLifecycleErrorCode,
  AgentOrchestratorOptions,
  AgentTaskMessage,
  AgentTaskSnapshot,
  RunController,
  RunControllerContext,
  RunControllerModelDirective,
  RunControllerToolDecision,
  RunOptions,
  Tool,
  ToolCall,
  ToolResult,
} from "./types.js";

export class OrchestrationRunController implements RunController {
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly callerThreadId: string,
    private readonly callerTaskId: string,
    private readonly root: boolean,
    private readonly delegate?: RunController,
  ) {}

  beforeModel(
    context: RunControllerContext,
  ): Promise<RunControllerModelDirective> {
    return Promise.resolve(this.delegate?.beforeModel?.(context) ?? {}).then(
      (directive) => {
        if (this.root) this.orchestrator.syncRootTools(context.tools);
        return directive;
      },
    );
  }

  async beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): Promise<RunControllerToolDecision> {
    const ownership = this.orchestrator.writeDecision(
      this.callerTaskId,
      call,
      tool,
    );
    if (ownership) return ownership;
    return (
      (await this.delegate?.beforeToolCall?.(call, tool, context)) ?? {
        allowed: true,
      }
    );
  }

  afterToolCall(
    call: ToolCall,
    result: ToolResult,
    context: RunControllerContext,
  ): void | Promise<void> {
    return this.delegate?.afterToolCall?.(call, result, context);
  }

  async validateCompletion(
    turn: { text: string },
    context: RunControllerContext,
  ): Promise<string | undefined> {
    const delegated = await this.delegate?.validateCompletion?.(turn, context);
    return (
      delegated ??
      this.orchestrator.completionBlocker(this.callerThreadId, this.root)
    );
  }

  resolveCompletionOutput(
    turn: { text: string },
    context: RunControllerContext,
  ): string | undefined | Promise<string | undefined> {
    return this.delegate?.resolveCompletionOutput?.(turn, context);
  }
}

export function rootRunOptions(options: AgentOrchestratorOptions): RunOptions {
  const {
    profiles: _profiles,
    maxConcurrent: _maxConcurrent,
    maxAgents: _maxAgents,
    maxDepth: _maxDepth,
    resumableThreads: _resumableThreads,
    wallNow: _wallNow,
    onAgentTreeEvent: _onAgentTreeEvent,
    onRuntimeCheckpoint: _onRuntimeCheckpoint,
    createChildRunOptions: _createChildRunOptions,
    controller: _controller,
    onEvent: _onEvent,
    ...runOptions
  } = options;
  return runOptions;
}

export function agentDepth(path: string | undefined): number {
  if (!path) return 0;
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

export function parentAgentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/root" : path.slice(0, index);
}

export function formatAgentMessage(message: AgentTaskMessage): string {
  return [
    `Message from ${message.fromAgentName} (${message.fromAgentThreadId}):`,
    message.text,
  ].join("\n");
}

export function lifecycleError(
  code: AgentLifecycleErrorCode,
  agentId: string,
  operation: string,
  detail?: string,
): ToolExecutionError {
  const message =
    code === "agent_busy"
      ? `Agent ${agentId} already has an active run and is unavailable for ${operation}`
      : code === "agent_ambiguous"
        ? `Agent reference ${agentId} is ambiguous for ${operation}; use its stable thread ID or canonical path`
        : code === "agent_closed"
          ? `Agent ${agentId} is closed and unavailable for ${operation}`
          : code === "agent_not_found"
            ? `Agent ${agentId} was not found for ${operation}`
            : code === "agent_state_unavailable"
              ? `Agent ${agentId} state is unavailable for ${operation}${detail ? `: ${detail}` : ""}`
              : code === "agent_write_conflict"
                ? `Agent ${agentId} cannot perform ${operation}${detail ? `: ${detail}` : ""}`
                : `Agent ${agentId} is not attached to the current orchestrator for ${operation}${detail ? `: ${detail}` : ""}`;
  return new ToolExecutionError(message, {
    code,
    retryable: code === "agent_busy" || code === "agent_not_attached",
  });
}

export function positiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return value === undefined ? fallback : Math.max(1, Math.floor(value));
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

export function combineSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): AbortSignal {
  return first ? AbortSignal.any([first, second]) : second;
}

export function elapsedSince(startedAt: string | undefined, now: Date): number {
  if (!startedAt) return 0;
  return Math.max(0, now.getTime() - Date.parse(startedAt));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
