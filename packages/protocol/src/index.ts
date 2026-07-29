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
  ADVANCE_PLAN_TOOL_NAME,
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

export const DESKTOP_CONNECTION_METHODS = [
  "connection/get",
  "connection/set",
  "connection/status",
  "connection/configure",
  "connection/invalidate",
  "connection/create-state",
  "connection/open-authorization",
  "connection/take-code",
  "connection/wait-code",
] as const;

export type DesktopConnectionMethod =
  (typeof DESKTOP_CONNECTION_METHODS)[number];

export type DesktopConnectionRequest = JsonRpcRequest<
  DesktopConnectionMethod,
  unknown
> & { id: JsonRpcId };

export type DesktopConnectionResponse = JsonRpcResponse<unknown>;

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

export type CapabilityKind = "skill" | "tool";
export type CapabilityVisibility = "featured" | "search" | "hidden";
export type CapabilityStatus =
  | "ready"
  | "needs_configuration"
  | "needs_authorization";

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  source?: string;
  /** Stable icon name rendered by the client; never an arbitrary URL. */
  icon?: string;
  /** Featured entries appear before the user types. Search entries require a query. */
  visibility?: CapabilityVisibility;
  /** Additional local search terms that are not shown to the model. */
  keywords?: readonly string[];
  status?: CapabilityStatus;
  /** Connector that must be ready before this capability can be selected. */
  connectorRef?: string;
}

export interface MessageCapabilityData {
  id: string;
  kind: CapabilityKind;
  name: string;
  source?: string;
  icon?: string;
}

export interface ConnectorStatusData {
  capabilityId: string;
  connectorId: string;
  name: string;
  status: CapabilityStatus;
  configured: boolean;
  authorized: boolean;
  redirectUrl: string;
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
  capabilityRefs?: readonly string[];
  /** Display-safe snapshot of capabilities selected or applied for this message. */
  capabilities?: readonly MessageCapabilityData[];
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
  "capability/list": {
    params: { threadId: string };
    result: { capabilities: readonly CapabilityDescriptor[] };
  };
  "connector/status": {
    params: { threadId: string; capabilityId: string };
    result: ConnectorStatusData;
  };
  "connector/configure": {
    params: {
      threadId: string;
      capabilityId: string;
      clientId: string;
      clientSecret: string;
    };
    result: ConnectorStatusData;
  };
  "connector/authorize": {
    params: { threadId: string; capabilityId: string };
    result: ConnectorStatusData;
  };
  "connector/disconnect": {
    params: { threadId: string; capabilityId: string };
    result: ConnectorStatusData;
  };
  "turn/start": {
    params: {
      threadId: string;
      input: string;
      mode?: TurnMode;
      attachments?: readonly AttachmentData[];
      capabilityRefs?: readonly string[];
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
  "capability/list",
  "connector/status",
  "connector/configure",
  "connector/authorize",
  "connector/disconnect",
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
    capabilities?: readonly MessageCapabilityData[];
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
