import type {
  Agent,
  AgentRunCheckpoint,
  ContextCompactionRecord,
  ModelConversationMessage,
  ModelRequest,
  ModelTurn,
  RunOptions,
  RunResult,
  TokenUsage,
  ToolResult,
} from "./types.js";

export interface PreparedModelRequest {
  request: ModelRequest;
  contextReplaced: boolean;
  usage?: Partial<TokenUsage>;
  compaction?: ContextCompactionRecord;
}

interface PrepareModelRequestOptions {
  runId: string;
  step: number;
  agent: Agent;
  request: ModelRequest;
  beforeModelRequest: NonNullable<RunOptions["beforeModelRequest"]>;
}

type CreateModelRequestOptions = Omit<
  PrepareModelRequestOptions,
  "beforeModelRequest"
>;

/**
 * Owns the provider conversation state and its provider-neutral fallback.
 * Host-defined context preparation can replace the fallback without leaking
 * compaction policy or provider wire formats into the orchestration loop.
 */
export class ModelSession {
  private state: unknown;
  private history: ModelConversationMessage[];
  private historyReplaced = false;
  private previousModelUsage: Partial<TokenUsage> | undefined;

  constructor(options: Pick<RunOptions, "history" | "modelState">) {
    this.state = options.modelState;
    this.history = [...(options.history ?? [])];
  }

  createRequest(options: CreateModelRequestOptions): PreparedModelRequest {
    const pending = this.pendingRequest(options.request);
    this.history = pending.fallbackHistory;
    return { request: pending.request, contextReplaced: false };
  }

  async prepareRequest(
    options: PrepareModelRequestOptions,
  ): Promise<PreparedModelRequest> {
    const pending = this.pendingRequest(options.request);
    const preparation = await options.beforeModelRequest({
      runId: options.runId,
      step: options.step,
      agent: options.agent,
      request: pending.request,
      fallbackHistory: pending.fallbackHistory,
      previousModelUsage: this.previousModelUsage,
    });

    if (!preparation) {
      this.history = pending.fallbackHistory;
      return { request: pending.request, contextReplaced: false };
    }

    this.history = [...preparation.history];
    this.historyReplaced = true;
    this.state = undefined;
    return {
      request: {
        ...pending.request,
        input: undefined,
        history: this.history,
        state: undefined,
        toolResults: [],
      },
      contextReplaced: true,
      usage: preparation.usage,
      compaction: preparation.compaction,
    };
  }

  completeTurn(turn: ModelTurn): void {
    this.state = turn.state;
    this.previousModelUsage = turn.usage;
    this.history = appendAssistantContext(this.history, turn);
  }

  checkpoint(
    step: number,
    phase: Exclude<AgentRunCheckpoint["phase"], "context_compacted">,
    usage: TokenUsage,
    pendingToolResults: readonly ToolResult[] = [],
    includeHistory = false,
  ): AgentRunCheckpoint {
    return {
      step,
      phase,
      modelState: this.state,
      ...this.resumableContext(pendingToolResults, includeHistory),
      usage,
    };
  }

  compactionCheckpoint(step: number, usage: TokenUsage): AgentRunCheckpoint {
    return {
      step,
      phase: "context_compacted",
      modelState: undefined,
      contextTokens: 0,
      contextHistory: [...this.history],
      usage,
    };
  }

  resultContext(): Pick<
    RunResult,
    "modelState" | "contextTokens" | "contextHistory"
  > {
    return {
      modelState: this.state,
      ...this.resumableContext(),
    };
  }

  private pendingRequest(request: ModelRequest): {
    request: ModelRequest;
    fallbackHistory: ModelConversationMessage[];
  } {
    const currentRequest: ModelRequest = {
      ...request,
      history: this.history,
      state: this.state,
    };
    return {
      request: currentRequest,
      fallbackHistory: appendPendingContext(
        this.history,
        currentRequest.input,
        currentRequest.toolResults ?? [],
      ),
    };
  }

  private resumableContext(): Pick<
    AgentRunCheckpoint,
    "contextTokens" | "contextHistory"
  >;
  private resumableContext(
    pendingToolResults: readonly ToolResult[],
    includeHistory?: boolean,
  ): Pick<AgentRunCheckpoint, "contextTokens" | "contextHistory">;
  private resumableContext(
    pendingToolResults: readonly ToolResult[] = [],
    includeHistory = false,
  ): Pick<AgentRunCheckpoint, "contextTokens" | "contextHistory"> {
    return {
      ...(this.previousModelUsage?.totalTokens === undefined
        ? {}
        : { contextTokens: this.previousModelUsage.totalTokens }),
      ...(includeHistory || this.historyReplaced
        ? {
            contextHistory: appendPendingContext(
              this.history,
              undefined,
              pendingToolResults,
            ),
          }
        : {}),
    };
  }
}

function appendPendingContext(
  history: readonly ModelConversationMessage[],
  input: string | undefined,
  toolResults: readonly ToolResult[],
): ModelConversationMessage[] {
  const next = [...history];
  if (toolResults.length > 0) {
    next.push({
      role: "user",
      text: "",
      toolResults: toolResults.map((result) => ({ ...result })),
    });
  }
  if (input?.trim()) next.push({ role: "user", text: input });
  return next;
}

function appendAssistantContext(
  history: readonly ModelConversationMessage[],
  turn: ModelTurn,
): ModelConversationMessage[] {
  if (!turn.text && turn.toolCalls.length === 0) return [...history];
  return [
    ...history,
    {
      role: "assistant",
      text: turn.text,
      ...(turn.toolCalls.length > 0
        ? { toolCalls: turn.toolCalls.map((call) => ({ ...call })) }
        : {}),
    },
  ];
}
