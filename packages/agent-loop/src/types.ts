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
  providerReference?: unknown;
}

export interface ModelRequest {
  model?: string;
  instructions: string;
  input?: string;
  attachments?: readonly ModelAttachment[];
  state?: unknown;
  toolResults?: readonly ToolResult[];
  tools: readonly Pick<
    Tool,
    "name" | "description" | "parameters" | "kind"
  >[];
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
      outputVisibility?: ModelOutputVisibility;
    }
  | { type: "tool.started"; runId: string; call: ToolCall }
  | { type: "tool.completed"; runId: string; result: ToolResult }
  | { type: "message.completed"; runId: string; text: string }
  | { type: "run.completed"; runId: string; steps: number }
  | { type: "run.failed"; runId: string; error: string };

export interface RunOptions {
  signal?: AbortSignal;
  toolScopeId?: string;
  modelState?: unknown;
  controller?: RunController;
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
  ):
    | RunControllerModelDirective
    | Promise<RunControllerModelDirective>;
  beforeToolCall?(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ):
    | RunControllerToolDecision
    | Promise<RunControllerToolDecision>;
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
  modelState?: unknown;
  usage: TokenUsage;
}

export function defineAgent(agent: Agent): Agent {
  return agent;
}

export function defineTool(tool: Tool): Tool {
  return tool;
}
