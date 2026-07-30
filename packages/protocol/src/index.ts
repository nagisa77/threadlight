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

export type ThreadlightHostKind = "local" | "remote";

export interface ThreadlightHostSummary {
  id: string;
  name: string;
  kind: ThreadlightHostKind;
  endpoint?: string;
}

export interface ThreadlightHostsSnapshot {
  activeHostId: string;
  hosts: readonly ThreadlightHostSummary[];
}

export type HostModelProvider =
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "doubao"
  | "gemini"
  | "grok"
  | "custom";

export type HostLanguage = "zh-CN" | "zh-TW" | "en" | "ja" | "ko";
export type HostTheme = "system" | "light" | "dark";

export interface HostSettingsSnapshot {
  language: HostLanguage;
  theme: HostTheme;
  preferredProjectOpener: string;
  provider: HostModelProvider;
  openAIApiKeyConfigured: boolean;
  deepSeekApiKeyConfigured: boolean;
  qwenApiKeyConfigured: boolean;
  kimiApiKeyConfigured: boolean;
  doubaoApiKeyConfigured: boolean;
  geminiApiKeyConfigured: boolean;
  grokApiKeyConfigured: boolean;
  customApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  kimiBaseUrl: string;
  doubaoBaseUrl: string;
  geminiBaseUrl: string;
  grokBaseUrl: string;
  customBaseUrl: string;
  model: string;
}

export interface HostSettingsUpdate {
  language?: HostLanguage;
  theme?: HostTheme;
  preferredProjectOpener?: string;
  provider: HostModelProvider;
  openAIApiKey?: string | null;
  deepSeekApiKey?: string | null;
  qwenApiKey?: string | null;
  kimiApiKey?: string | null;
  doubaoApiKey?: string | null;
  geminiApiKey?: string | null;
  grokApiKey?: string | null;
  customApiKey?: string | null;
  searchApiKey?: string | null;
  qwenBaseUrl: string;
  kimiBaseUrl: string;
  doubaoBaseUrl: string;
  geminiBaseUrl: string;
  grokBaseUrl: string;
  customBaseUrl: string;
  model: string;
}

export interface HostProviderTestRequest {
  provider: HostModelProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string | null;
}

export type HostProviderDiagnosticCode =
  | "ok"
  | "missing_key"
  | "invalid_url"
  | "unauthorized"
  | "endpoint_not_found"
  | "model_not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "provider_error";

export interface HostProviderDiagnostic {
  status: "success" | "warning" | "error";
  code: HostProviderDiagnosticCode;
  provider: HostModelProvider;
  model: string;
  endpoint: string;
  checkedAt: string;
  latencyMs: number;
  httpStatus?: number;
  detail?: string;
}

export interface HostDiagnosticsTotals {
  turns: number;
  failedTurns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  modelSteps: number;
  toolCalls: number;
  toolDurationMs: number;
}

export interface HostModelStepDiagnostic {
  step: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HostToolCallDiagnostic {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
}

export interface HostTurnDiagnostic {
  threadId: string;
  title: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelSteps: readonly HostModelStepDiagnostic[];
  toolCalls: readonly HostToolCallDiagnostic[];
}

export interface HostProjectDiagnosticsSnapshot {
  projectId: string;
  projectName: string;
  generatedAt: string;
  totals: HostDiagnosticsTotals;
  turns: readonly HostTurnDiagnostic[];
}

export type HostSearchMode = "all" | "files";

export interface HostSearchRequest {
  projectId: string;
  threadId?: string;
  query: string;
  mode: HostSearchMode;
  limit?: number;
}

export interface HostSearchResult {
  id: string;
  kind: "message" | "file" | "command" | "tool" | "memory";
  projectId: string;
  threadId?: string;
  messageId?: string;
  activityId?: string;
  path?: string;
  line?: number;
  title: string;
  subtitle: string;
  snippet: string;
}

export type HostConversationStatus = "pending" | "completed";

export type HostTaskWorkspace =
  | {
      mode: "folder";
      path: string;
    }
  | {
      mode: "worktree";
      path: string;
      root: string;
      repositoryRoot: string;
      branch: string;
      baseCommit: string;
      sourceBranch?: string;
    };

export interface HostConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: HostConversationStatus;
  unread?: boolean;
  renamedAt?: string;
  titleGeneratedAt?: string;
  pinnedAt?: string;
  archivedAt?: string;
  accessMode?: "approval" | "full";
  workspace?: HostTaskWorkspace;
}

export interface HostProjectSummary {
  id: string;
  name: string;
  basePath: string;
  lastOpenedAt: string;
  pinnedAt?: string;
  conversations: readonly HostConversationSummary[];
}

export interface HostProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly HostProjectSummary[];
}

export interface HostDirectoryEntry {
  name: string;
  path: string;
}

export interface HostDirectoryListing {
  path: string;
  directories: readonly HostDirectoryEntry[];
}

export interface HostFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface HostFileListing {
  path: string;
  parentPath?: string;
  entries: readonly HostFileEntry[];
}

export interface HostSystemFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export interface HostConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface HostConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly HostConversationFileChange[];
}

export interface HostConversationChangesRestoreRequest {
  revision: string;
  paths?: readonly string[];
}

export interface HostWorktreeDeliveryConflict {
  path: string;
  reason:
    | "both_added"
    | "target_deleted"
    | "target_modified"
    | "merge_conflict"
    | "unsafe_target";
}

export interface HostWorktreeDeliveryPreflight {
  taskBranch: string;
  targetBranch: string;
  sourceBranch?: string;
  branchChanged: boolean;
  files: number;
  pendingFiles: number;
  alreadyAppliedFiles: number;
  conflicts: readonly HostWorktreeDeliveryConflict[];
}

export interface HostWorktreeDeliveryResult
  extends HostWorktreeDeliveryPreflight {
  appliedFiles: number;
  commit?: string;
}

export interface HostCodeHostCheck {
  name: string;
  status: "queued" | "running" | "success" | "failure" | "skipped";
  url?: string;
}

export interface HostCodeHostReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  path?: string;
  line?: number;
  kind: "comment" | "review" | "inline";
  state?: string;
}

export interface HostCodeHostPullRequest {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headBranch: string;
  baseBranch: string;
  ciStatus: "none" | "pending" | "success" | "failure";
  reviewDecision?: string;
  checks: readonly HostCodeHostCheck[];
  comments: readonly HostCodeHostReviewComment[];
}

export interface HostCodeHostDeliveryStatus {
  provider: "github";
  available: boolean;
  reason?: string;
  repository?: string;
  remote?: string;
  taskBranch: string;
  baseBranch: string;
  pushed: boolean;
  ahead: number;
  pullRequest?: HostCodeHostPullRequest;
}

export interface HostCodeHostCommitPushResult {
  commit: string;
  status: HostCodeHostDeliveryStatus;
}

export interface ThreadlightHostHealth {
  ok: true;
  protocolVersion: 2;
  hostId: string;
  name: string;
  homePath: string;
  capabilities?: {
    terminal?: boolean;
  };
}

export interface TerminalSessionInfo {
  id: string;
  shell: string;
}

export type TerminalSessionEvent =
  | {
      type: "data";
      sessionId: string;
      data: string;
    }
  | {
      type: "exit";
      sessionId: string;
      exitCode: number;
    };

export type HostTerminalClientMessage =
  | {
      type: "open";
      requestId: string;
      projectId: string;
      threadId?: string;
      cols: number;
      rows: number;
    }
  | {
      type: "input";
      sessionId: string;
      data: string;
    }
  | {
      type: "resize";
      sessionId: string;
      cols: number;
      rows: number;
    }
  | {
      type: "close";
      sessionId: string;
    };

export type HostTerminalServerMessage =
  | {
      type: "opened";
      requestId: string;
      session: TerminalSessionInfo;
    }
  | TerminalSessionEvent
  | {
      type: "error";
      requestId?: string;
      sessionId?: string;
      message: string;
    };

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

export interface ModelStepDiagnosticsData {
  step: number;
  durationMs: number;
  usage: TokenUsageData;
}

export interface ToolCallDiagnosticsData {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
}

export interface TurnDiagnosticsData {
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  model?: string;
  usage: TokenUsageData;
  modelSteps: readonly ModelStepDiagnosticsData[];
  toolCalls: readonly ToolCallDiagnosticsData[];
}

export interface ProcessSnapshotData {
  sessionId: string;
  command: string;
  cwd: string;
  status:
    | "running"
    | "completed"
    | "completed_with_warnings"
    | "failed"
    | "terminated";
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
  status:
    | "running"
    | "completed"
    | "completed_with_warnings"
    | "failed"
    | "terminated";
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
export type ConversationAccessMode = "approval" | "full";
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
  diagnostics?: TurnDiagnosticsData;
  /** Web sources cited by this assistant message. */
  sources?: readonly MessageSourceData[];
  /** Inline citations anchored in `text` through threadlight-source links. */
  citations?: readonly MessageCitationData[];
  /** @deprecated Kept for conversations written before ordered progress. */
  activities?: readonly ConversationActivityData[];
}

export interface MessageSourceData {
  id: string;
  title: string;
  url: string;
  domain: string;
  description?: string;
}

export interface MessageCitationData {
  id: string;
  sourceIds: readonly string[];
  excerpt: string;
}

export type FollowUpDelivery = "inject" | "queued";

export interface QueuedTurnData {
  id: string;
  input: string;
  delivery: FollowUpDelivery;
  createdAt: string;
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
      durationMs?: number;
      outputVisibility?: "user" | "provisional";
    }
  | { type: "tool.started"; runId: string; call: ToolCallData }
  | {
      type: "tool.completed";
      runId: string;
      result: ToolResultData;
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

export interface ThreadlightMethodMap {
  initialize: {
    params:
      | {
          capabilities?: {
            executionApprovals?: boolean;
          };
        }
      | undefined;
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
      queuedTurns: readonly QueuedTurnData[];
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
      accessMode?: ConversationAccessMode;
      attachments?: readonly AttachmentData[];
      capabilityRefs?: readonly string[];
    };
    result: { turnId: string };
  };
  "turn/interrupt": {
    params: { threadId: string };
    result: { interrupted: boolean };
  };
  "turn/follow-up": {
    params: {
      threadId: string;
      input: string;
      delivery: FollowUpDelivery;
    };
    result: { item: QueuedTurnData };
  };
  "turn/queue/reorder": {
    params: {
      threadId: string;
      itemId: string;
      beforeItemId?: string;
    };
    result: { queuedTurns: readonly QueuedTurnData[] };
  };
  "turn/queue/cancel": {
    params: { threadId: string; itemId: string };
    result: {
      canceled: boolean;
      queuedTurns: readonly QueuedTurnData[];
    };
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
  "execution/approval/respond": {
    params: {
      requestId: string;
      decision: "allow" | "deny";
    };
    result: { accepted: boolean };
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
  "turn/follow-up",
  "turn/queue/reorder",
  "turn/queue/cancel",
  "process/status",
  "process/read",
  "process/wait",
  "process/kill",
  "execution/approval/respond",
] as const satisfies readonly (keyof ThreadlightMethodMap)[];

export type ThreadlightMethod = keyof ThreadlightMethodMap;
export type MethodParams<Method extends ThreadlightMethod> =
  ThreadlightMethodMap[Method]["params"];
export type MethodResult<Method extends ThreadlightMethod> =
  ThreadlightMethodMap[Method]["result"];

export interface ThreadlightNotificationMap {
  "connector/authorization-requested": {
    url: string;
  };
  "thread/title": {
    threadId: string;
    title: string;
  };
  "turn/started": { threadId: string; turnId: string; mode: TurnMode };
  "turn/completed": {
    threadId: string;
    turnId: string;
    output: string;
    usage: TokenUsageData;
    diagnostics?: TurnDiagnosticsData;
    capabilities?: readonly MessageCapabilityData[];
    sources?: readonly MessageSourceData[];
    citations?: readonly MessageCitationData[];
  };
  "turn/failed": {
    threadId: string;
    turnId: string;
    error: string;
    diagnostics?: TurnDiagnosticsData;
  };
  "agent/event": {
    threadId: string;
    turnId: string;
    event: AgentEventData;
  };
  "turn/queue/updated": {
    threadId: string;
    queuedTurns: readonly QueuedTurnData[];
  };
  "turn/follow-up/consumed": {
    threadId: string;
    itemId: string;
    message: ConversationMessageData;
    precedingAssistantMessage?: ConversationMessageData;
  };
  "execution/approval-required": {
    requestId: string;
    threadId: string;
    runId: string;
    toolName: string;
    permissionKey: string;
    risk: "write";
    summary: string;
    detail?: string;
    external: boolean;
  };
  "execution/approval-resolved": {
    requestId: string;
    threadId: string;
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
