export type JsonSchema = Record<string, unknown>;

export interface ToolContext {
  runId: string;
  scopeId?: string;
  signal: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  kind?: "function" | "computer";
  /**
   * Whether calling the tool can change workspace or external state.
   * Restrictive controllers treat unannotated tools as write-capable.
   */
  mutability?: "read" | "write";
  /**
   * Additional provider-neutral impact metadata. Remote tool annotations are
   * conservative: omitted hints never make a tool safer.
   */
  impact?: {
    destructive?: boolean;
    external?: boolean;
  };
  execute(arguments_: unknown, context: ToolContext): Promise<unknown>;
}

export interface Agent {
  name: string;
  instructions: string;
  model?: string;
  /**
   * Provider-neutral routing hint for multi-provider runtimes. Adapters that
   * are bound to a single vendor ignore it; a routing adapter uses it to
   * dispatch the model request to the matching backend.
   */
  provider?: string;
  tools?: readonly Tool[];
  maxSteps?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: string;
  kind?: "function" | "computer";
  isError?: boolean;
  error?: ToolErrorMetadata;
}

export interface ToolUserAction {
  kind: string;
  data?: unknown;
}

export interface ToolErrorMetadata {
  code: string;
  retryable: boolean;
  userAction?: ToolUserAction;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
  path: string;
  /**
   * Routing hint used by multi-provider runtimes to upload through the same
   * backend that will consume the attachment.
   */
  provider?: string;
  providerReference?: unknown;
}

/** Provider-neutral visible transcript used when opaque state cannot cross providers. */
export interface ModelConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ModelRequest {
  model?: string;
  /** Routing hint forwarded from the agent; see {@link Agent.provider}. */
  provider?: string;
  instructions: string;
  input?: string;
  attachments?: readonly ModelAttachment[];
  /** Prior visible turns, available as a fallback when state belongs to another provider. */
  history?: readonly ModelConversationMessage[];
  state?: unknown;
  toolResults?: readonly ToolResult[];
  tools: readonly Pick<Tool, "name" | "description" | "parameters" | "kind">[];
  signal?: AbortSignal;
}

export interface ModelTurn {
  text: string;
  toolCalls: readonly ToolCall[];
  state?: unknown;
  usage?: Partial<TokenUsage>;
}

export type ModelStreamEvent = {
  type: "output_text.delta";
  delta: string;
};

export type ModelOutputVisibility = "user" | "provisional";

export interface ModelGenerateOptions {
  onEvent?: (event: ModelStreamEvent) => void;
}

export interface ModelProvider {
  generate(
    request: ModelRequest,
    options?: ModelGenerateOptions,
  ): Promise<ModelTurn>;
}

export type AgentEvent =
  | { type: "run.started"; runId: string }
  | { type: "model.started"; runId: string; step: number }
  | {
      type: "model.output_text.delta";
      runId: string;
      step: number;
      delta: string;
      outputVisibility?: ModelOutputVisibility;
    }
  | {
      type: "model.completed";
      runId: string;
      step: number;
      text: string;
      toolCalls: readonly ToolCall[];
      usage?: Partial<TokenUsage>;
      durationMs?: number;
      outputVisibility?: ModelOutputVisibility;
    }
  | { type: "tool.started"; runId: string; call: ToolCall }
  | {
      type: "tool.completed";
      runId: string;
      result: ToolResult;
      durationMs?: number;
    }
  | { type: "message.completed"; runId: string; text: string }
  | {
      type: "run.completed";
      runId: string;
      steps: number;
      durationMs?: number;
    }
  | {
      type: "run.failed";
      runId: string;
      error: string;
      durationMs?: number;
    };

export interface RunOptions {
  signal?: AbortSignal;
  toolScopeId?: string;
  modelState?: unknown;
  /** Prior visible turns forwarded without interpreting provider-specific state. */
  history?: readonly ModelConversationMessage[];
  controller?: RunController;
  /**
   * Consumes user input added while this run is active.
   *
   * The loop polls only at safe model/tool boundaries. Adapters keep their
   * provider-specific message formats; the loop forwards plain text.
   */
  takeAdditionalInput?: () => string | undefined | Promise<string | undefined>;
  /** Monotonic clock used for duration measurements. */
  now?: () => number;
  onEvent?: (event: AgentEvent) => void;
}

export interface RunControllerContext {
  runId: string;
  step: number;
  tools: readonly Tool[];
}

export interface RunControllerModelDirective {
  /** Appended to the base agent instructions for this model turn only. */
  instructions?: string;
  /** Tools advertised to the model for this turn. Defaults to every tool. */
  tools?: readonly Tool[];
  /** Provider-ready attachments to include in this model turn. */
  attachments?: readonly ModelAttachment[];
  /**
   * Whether streamed text is ready for the user or remains provisional while
   * runtime control validates the turn. Defaults to user-facing.
   */
  outputVisibility?: ModelOutputVisibility;
}

export interface RunControllerToolDecision {
  allowed: boolean;
  /** Returned as a recoverable tool error when the call is disallowed. */
  message?: string;
}

/**
 * Provider-neutral execution control for a run.
 *
 * A controller may shape advertised tools, inject ephemeral state, reject
 * calls before execution, observe results, require another model turn instead
 * of accepting a premature final answer, and choose canonical completion text.
 */
export interface RunController {
  beforeModel?(
    context: RunControllerContext,
  ): RunControllerModelDirective | Promise<RunControllerModelDirective>;
  beforeToolCall?(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): RunControllerToolDecision | Promise<RunControllerToolDecision>;
  afterToolCall?(
    call: ToolCall,
    result: ToolResult,
    context: RunControllerContext,
  ): void | Promise<void>;
  validateCompletion?(
    turn: Pick<ModelTurn, "text">,
    context: RunControllerContext,
  ): string | undefined | Promise<string | undefined>;
  /**
   * Returns the controller-authoritative user-facing output after completion
   * validation succeeds. The provider's opaque state remains unchanged.
   */
  resolveCompletionOutput?(
    turn: Pick<ModelTurn, "text">,
    context: RunControllerContext,
  ): string | undefined | Promise<string | undefined>;
}

export interface RunResult {
  runId: string;
  output: string;
  steps: number;
  durationMs: number;
  modelState?: unknown;
  usage: TokenUsage;
}

export type SubagentToolAccess = "read-only" | "all";

/** Product-configurable role used by the provider-neutral orchestrator. */
export interface SubagentProfile {
  name: string;
  description: string;
  instructions: string;
  toolAccess?: SubagentToolAccess;
  excludedTools?: readonly string[];
  model?: string;
  provider?: string;
  maxSteps?: number;
}

export type AgentTaskStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export type AgentTaskPhase =
  "queued" | "thinking" | "working" | "waiting" | "done";

export interface AgentTaskActivity {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  durationMs?: number;
}

export interface AgentTaskSnapshot {
  id: string;
  parentId?: string;
  retryOf?: string;
  runId?: string;
  name: string;
  role: string;
  task: string;
  status: AgentTaskStatus;
  phase: AgentTaskPhase;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  elapsedMs: number;
  latestActivity?: string;
  summary?: string;
  output?: string;
  error?: string;
  steps?: number;
  usage?: TokenUsage;
  activities: readonly AgentTaskActivity[];
}

export interface AgentTreeSnapshot {
  rootId: string;
  maxConcurrent: number;
  agents: readonly AgentTaskSnapshot[];
}

export type AgentTreeUpdateReason =
  | "created"
  | "started"
  | "progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "steered";

export interface AgentTreeEvent {
  type: "agent.tree.updated";
  changedAgentId: string;
  reason: AgentTreeUpdateReason;
  tree: AgentTreeSnapshot;
}

export interface ChildAgentRunContext {
  agentId: string;
  parentId: string;
  profile: SubagentProfile;
}

export interface AgentOrchestratorOptions extends RunOptions {
  profiles: readonly SubagentProfile[];
  maxConcurrent?: number;
  maxAgents?: number;
  wallNow?: () => Date;
  onAgentTreeEvent?: (event: AgentTreeEvent) => void;
  createChildRunOptions?: (
    context: ChildAgentRunContext,
  ) => Pick<RunOptions, "controller" | "toolScopeId" | "history">;
}

export function defineAgent(agent: Agent): Agent {
  return agent;
}

export function defineTool(tool: Tool): Tool {
  return tool;
}
