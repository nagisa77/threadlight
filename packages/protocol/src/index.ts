export {
  appendActivityDetail,
  formatComputerToolInput,
  formatComputerToolResult,
} from "./computer-activity.js";
export {
  parseProcessSnapshot,
  projectAgentProgress,
  projectMessagesProcess,
  projectProgressProcess,
  runningProcessSessionIds,
} from "./conversation-progress.js";
export {
  parsePlanUpdate,
  projectAgentPlan,
  UPDATE_PLAN_TOOL_NAME,
} from "./plan-progress.js";

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

export const DESKTOP_COMPUTER_METHODS = [
  "computer/list",
  "computer/configure",
  "computer/clear",
  "computer/execute",
] as const;

export type DesktopComputerMethod =
  (typeof DESKTOP_COMPUTER_METHODS)[number];

export type DesktopComputerRequest = JsonRpcRequest<
  DesktopComputerMethod,
  unknown
> & { id: JsonRpcId };

export type DesktopComputerResponse = JsonRpcResponse<unknown>;

export interface ToolCallData {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResultData {
  callId: string;
  name: string;
  output: string;
  kind?: "function" | "computer";
  isError?: boolean;
  error?: {
    code: string;
    retryable: boolean;
    userAction?: {
      kind: string;
      data?: unknown;
    };
  };
}

export interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ProcessSnapshotData {
  sessionId: string;
  command: string;
  cwd: string;
  status: "running" | "completed" | "failed" | "terminated";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface ConversationActivityData {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "terminated";
  detail?: string;
  process?: ProcessSnapshotData;
}

export interface ConversationProgressData {
  text: string;
  activities: readonly ConversationActivityData[];
}

export type TurnMode = "default" | "plan";
export type PlanSource = "user" | "model";
export type PlanItemStatusData = "pending" | "in_progress" | "completed";

export interface PlanItemData {
  step: string;
  /** Detailed execution guidance. Optional for conversations saved before rich plans. */
  details?: string;
  /** Observable completion conditions. Optional for legacy plan items. */
  acceptanceCriteria?: readonly string[];
  /** Concrete evidence recorded when a controlled step completed. */
  completionEvidence?: readonly string[];
  status: PlanItemStatusData;
}

export interface AgentPlanData {
  source: PlanSource;
  explanation?: string;
  items: readonly PlanItemData[];
  documentPath?: string;
  documentVersion?: string;
}

export interface AttachmentData {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "file";
  /** Provider-readable local path. Wire adapters must never inline its bytes. */
  path: string;
}

export interface ConversationMessageData {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly AttachmentData[];
  error?: boolean;
  mode?: TurnMode;
  plan?: AgentPlanData;
  progress?: readonly ConversationProgressData[];
  /** @deprecated Kept for conversations written before ordered progress. */
  activities?: readonly ConversationActivityData[];
}

export type SuggestionLanguage = "zh-CN" | "zh-TW" | "en" | "ja" | "ko";

export type AgentEventData =
  | { type: "run.started"; runId: string }
  | { type: "model.started"; runId: string; step: number }
  | {
      type: "model.output_text.delta";
      runId: string;
      step: number;
      delta: string;
      outputVisibility?: "user" | "provisional";
    }
  | {
      type: "model.completed";
      runId: string;
      step: number;
      text: string;
      toolCalls: readonly ToolCallData[];
      usage?: Partial<TokenUsageData>;
      outputVisibility?: "user" | "provisional";
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
  "thread/suggestions": {
    params: { threadId: string; language: SuggestionLanguage };
    result: { suggestions: readonly [string, string, string] };
  };
  "turn/start": {
    params: {
      threadId: string;
      input: string;
      mode?: TurnMode;
      attachments?: readonly AttachmentData[];
    };
    result: { turnId: string };
  };
  "turn/interrupt": {
    params: { threadId: string };
    result: { interrupted: boolean };
  };
  "process/status": {
    params: { sessionId: string };
    result: ProcessSnapshotData;
  };
  "process/read": {
    params: { sessionId: string };
    result: ProcessSnapshotData;
  };
  "process/wait": {
    params: { sessionId: string; timeoutMs?: number };
    result: ProcessSnapshotData;
  };
  "process/kill": {
    params: { sessionId: string };
    result: ProcessSnapshotData;
  };
}

export const THREADLIGHT_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/delete",
  "thread/suggestions",
  "turn/start",
  "turn/interrupt",
  "process/status",
  "process/read",
  "process/wait",
  "process/kill",
] as const satisfies readonly (keyof ThreadlightMethodMap)[];

export type ThreadlightMethod = keyof ThreadlightMethodMap;
export type MethodParams<Method extends ThreadlightMethod> =
  ThreadlightMethodMap[Method]["params"];
export type MethodResult<Method extends ThreadlightMethod> =
  ThreadlightMethodMap[Method]["result"];

export interface ThreadlightNotificationMap {
  "turn/started": { threadId: string; turnId: string; mode: TurnMode };
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
