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
  isError?: boolean;
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

export interface ModelGenerateOptions {
  onEvent?: (event: ModelStreamEvent) => void;
}

export interface ModelProvider {
  validateAttachment?(
    attachment: ModelAttachment,
  ): void | Promise<void>;
  uploadAttachment?(
    attachment: ModelAttachment,
    signal?: AbortSignal,
  ): Promise<ModelAttachment>;
  prepareStateForPersistence?(
    state: unknown,
    options: { maxBytes: number },
  ): unknown;
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
    }
  | {
      type: "model.completed";
      runId: string;
      step: number;
      text: string;
      toolCalls: readonly ToolCall[];
      usage?: Partial<TokenUsage>;
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
  attachments?: readonly ModelAttachment[];
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
}

export interface RunControllerToolDecision {
  allowed: boolean;
  /** Returned as a recoverable tool error when the call is disallowed. */
  message?: string;
}

/**
 * Provider-neutral execution control for a run.
 *
 * A controller may narrow tools, inject ephemeral state, reject calls before
 * execution, observe results, and require another model turn instead of
 * accepting a premature final answer.
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
