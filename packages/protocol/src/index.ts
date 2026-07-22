export type JsonRpcId = string | number | null;

export interface JsonRpcRequest<
  Method extends string = string,
  Params = unknown,
> {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: Method;
  params?: Params;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse<Result = unknown> =
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result: Result;
      error?: never;
    }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result?: never;
      error: JsonRpcError;
    };

export interface JsonRpcNotification<
  Method extends string = string,
  Params = unknown,
> {
  jsonrpc: "2.0";
  method: Method;
  params?: Params;
}

export type JsonRpcOutgoing = JsonRpcResponse | JsonRpcNotification;

export interface ToolCallData {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResultData {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ApprovalRequestData {
  id: string;
  runId: string;
  call: ToolCallData;
}

export interface ConversationActivityData {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  detail?: string;
}

export interface ConversationProgressData {
  text: string;
  activities: readonly ConversationActivityData[];
}

export interface ConversationMessageData {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  progress?: readonly ConversationProgressData[];
  /** @deprecated Kept for conversations written before ordered progress. */
  activities?: readonly ConversationActivityData[];
}

export type AgentEventData =
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
      toolCalls: readonly ToolCallData[];
      usage?: Partial<TokenUsageData>;
    }
  | { type: "approval.requested"; request: ApprovalRequestData }
  | {
      type: "approval.resolved";
      request: ApprovalRequestData;
      approved: boolean;
    }
  | { type: "tool.started"; runId: string; call: ToolCallData }
  | { type: "tool.completed"; runId: string; result: ToolResultData }
  | { type: "message.completed"; runId: string; text: string }
  | { type: "run.completed"; runId: string; steps: number }
  | { type: "run.failed"; runId: string; error: string };

export interface ThreadlightMethodMap {
  initialize: {
    params: undefined;
    result: { name: string; protocolVersion: string };
  };
  "thread/start": {
    params: undefined;
    result: { threadId: string };
  };
  "thread/resume": {
    params: { threadId: string };
    result: {
      threadId: string;
      messages: readonly ConversationMessageData[];
    };
  };
  "thread/delete": {
    params: { threadId: string };
    result: { deleted: boolean };
  };
  "turn/start": {
    params: { threadId: string; input: string };
    result: { turnId: string };
  };
  "turn/interrupt": {
    params: { threadId: string };
    result: { interrupted: boolean };
  };
  "approval/resolve": {
    params: { requestId: string; approved: boolean };
    result: { resolved: boolean };
  };
}

export const THREADLIGHT_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/delete",
  "turn/start",
  "turn/interrupt",
  "approval/resolve",
] as const satisfies readonly (keyof ThreadlightMethodMap)[];

export type ThreadlightMethod = keyof ThreadlightMethodMap;
export type MethodParams<Method extends ThreadlightMethod> =
  ThreadlightMethodMap[Method]["params"];
export type MethodResult<Method extends ThreadlightMethod> =
  ThreadlightMethodMap[Method]["result"];

export interface ThreadlightNotificationMap {
  "turn/started": { threadId: string; turnId: string };
  "turn/completed": {
    threadId: string;
    turnId: string;
    output: string;
    usage: TokenUsageData;
  };
  "turn/failed": {
    threadId: string;
    turnId: string;
    error: string;
  };
  "agent/event": {
    threadId: string;
    turnId: string;
    event: AgentEventData;
  };
}

export type ThreadlightNotificationMethod =
  keyof ThreadlightNotificationMap;

export type ThreadlightNotification = {
  [Method in ThreadlightNotificationMethod]: JsonRpcNotification<
    Method,
    ThreadlightNotificationMap[Method]
  > & { params: ThreadlightNotificationMap[Method] };
}[ThreadlightNotificationMethod];
