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
  onEvent?: (event: AgentEvent) => void;
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
