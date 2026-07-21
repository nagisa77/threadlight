export type JsonSchema = Record<string, unknown>;

export interface ToolContext {
  runId: string;
  signal: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  needsApproval?: boolean | ((arguments_: unknown) => boolean);
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

export interface ModelRequest {
  model?: string;
  instructions: string;
  input?: string;
  state?: unknown;
  toolResults?: readonly ToolResult[];
  tools: readonly Pick<Tool, "name" | "description" | "parameters">[];
  signal?: AbortSignal;
}

export interface ModelTurn {
  text: string;
  toolCalls: readonly ToolCall[];
  state?: unknown;
  usage?: Partial<TokenUsage>;
}

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelTurn>;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  call: ToolCall;
}

export type AgentEvent =
  | { type: "run.started"; runId: string }
  | { type: "model.started"; runId: string; step: number }
  | { type: "approval.requested"; request: ApprovalRequest }
  | {
      type: "approval.resolved";
      request: ApprovalRequest;
      approved: boolean;
    }
  | { type: "tool.started"; runId: string; call: ToolCall }
  | { type: "tool.completed"; runId: string; result: ToolResult }
  | { type: "message.completed"; runId: string; text: string }
  | { type: "run.completed"; runId: string; steps: number }
  | { type: "run.failed"; runId: string; error: string };

export interface RunOptions {
  signal?: AbortSignal;
  modelState?: unknown;
  onEvent?: (event: AgentEvent) => void;
  approve?: (request: ApprovalRequest) => Promise<boolean>;
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
