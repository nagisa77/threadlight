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

export interface PullRequestChangeSummary {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary?: boolean;
  localOnly?: boolean;
}

export interface PullRequestDescriptionData {
  title: string;
  body: string;
}

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
  /** Last saved model ID for the custom OpenAI-compatible provider. */
  customModel: string;
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
  /** Last saved model ID for the custom OpenAI-compatible provider. */
  customModel: string;
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
  errorCode?: string;
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

export interface HostDiagnosticEnvironment {
  runtime: "desktop" | "host";
  appVersion?: string;
  platform: string;
  architecture: string;
  nodeVersion: string;
  electronVersion?: string;
}

export interface HostDiagnosticConversation {
  threadId: string;
  title: string;
  source: string;
  createdAt?: string;
  updatedAt?: string;
  provider?: string;
  model?: string;
  workspaceMode?: HostTaskWorkspace["mode"];
  /**
   * A recursively redacted copy of the persisted conversation JSON. The key
   * structure is preserved so model state, plans, progress, process output,
   * citations, and queued turns remain available to badcase tooling.
   */
  record?: Readonly<Record<string, unknown>>;
}

export interface HostDiagnosticFile {
  threadId: string;
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  localOnly?: boolean;
  oldContent?: string;
  newContent?: string;
  omittedReason?: "binary" | "too_large" | "unavailable";
}

export type HostDiagnosticTimelineEventKind =
  "turn" | "model" | "tool" | "process";

export interface HostDiagnosticTimelineEvent {
  sequence: number;
  threadId: string;
  messageId?: string;
  kind: HostDiagnosticTimelineEventKind;
  name: string;
  status: "running" | "completed" | "failed" | "terminated";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorCode?: string;
}

export interface HostDiagnosticError {
  threadId: string;
  messageId?: string;
  source: "turn" | "tool" | "process";
  code: string;
  message?: string;
  occurredAt?: string;
}

export interface HostProjectDiagnosticBundle {
  schemaVersion: 1;
  filename: string;
  generatedAt: string;
  project: {
    id: string;
    name: string;
    scope?: "project" | "standalone";
    exportScope: "project" | "conversations";
    conversationCount: number;
    conversationIds: readonly string[];
  };
  environment: HostDiagnosticEnvironment;
  summary: HostProjectDiagnosticsSnapshot;
  timeline: readonly HostDiagnosticTimelineEvent[];
  errors: readonly HostDiagnosticError[];
  conversations: readonly HostDiagnosticConversation[];
  files: readonly HostDiagnosticFile[];
  redaction: {
    applied: true;
    replacement: "[REDACTED]";
    count: number;
    truncatedTextFields: number;
  };
  warnings: readonly string[];
}

export type HostAutomationKind =
  "custom" | "tests" | "dependencies" | "issue-triage";

export type HostAutomationCadence = "daily" | "weekdays" | "weekly";

export interface HostAutomationSchedule {
  cadence: HostAutomationCadence;
  time: string;
  weekday?: number;
}

export type HostAutomationRunStatus =
  "running" | "succeeded" | "attention" | "failed";

export interface HostAutomationRun {
  status: HostAutomationRunStatus;
  startedAt: string;
  completedAt?: string;
  threadId?: string;
  summary?: string;
}

export interface HostAutomation {
  id: string;
  projectId: string;
  name: string;
  kind: HostAutomationKind;
  prompt: string;
  enabled: boolean;
  schedule: HostAutomationSchedule;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRun?: HostAutomationRun;
}

export interface HostAutomationsSnapshot {
  projectId: string;
  generatedAt: string;
  timeZone: string;
  automations: readonly HostAutomation[];
}

export interface HostAutomationCreateRequest {
  projectId: string;
  name: string;
  kind: HostAutomationKind;
  prompt: string;
  enabled: boolean;
  schedule: HostAutomationSchedule;
}

export interface HostAutomationUpdateRequest extends HostAutomationCreateRequest {
  id: string;
}

export interface HostAutomationTarget {
  projectId: string;
  id: string;
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

export type HostConversationStatus = "pending" | "completed" | "attention";

/** Selects whether a new task shares the project checkout or gets an isolated Git worktree. */
export type TaskDevelopmentMode = "local" | "worktree";

export type HostTaskWorkspace =
  | {
      mode: "folder";
      path: string;
    }
  | {
      mode: "standalone";
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
  scope?: "project" | "standalone";
  pinnedAt?: string;
  conversations: readonly HostConversationSummary[];
}

export interface HostProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly HostProjectSummary[];
  runningThreadIds?: readonly string[];
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
  localOnly?: boolean;
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
  localOnlyFiles?: number;
  conflicts: readonly HostWorktreeDeliveryConflict[];
}

export interface HostWorktreeDeliveryResult extends HostWorktreeDeliveryPreflight {
  appliedFiles: number;
  commit?: string;
  undoAvailable?: boolean;
}

export interface HostWorktreeDeliveryUndoResult {
  targetBranch: string;
  revertedFiles: number;
  revision: string;
}

export interface HostWorktreeDeliveryHistoryEntry {
  id: string;
  createdAt: string;
  revision: string;
  status: "synced" | "conflict" | "failed" | "undone";
  taskBranch?: string;
  targetBranch?: string;
  files?: number;
  appliedFiles?: number;
  revertedFiles?: number;
  commit?: string;
  undoAvailable?: boolean;
  conflicts?: readonly HostWorktreeDeliveryConflict[];
  error?: string;
}

export interface HostWorktreeDeliveryHistorySnapshot {
  projectId: string;
  threadId: string;
  targetBranch?: string;
  currentRevision?: string;
  synchronizedFiles: number;
  undoPoint?: {
    revision: string;
    previousRevision?: string;
    files: readonly string[];
    createdAt?: string;
  };
  entries: readonly HostWorktreeDeliveryHistoryEntry[];
}

export type HostDeliverySource = "lifecycle" | "retry";

export interface HostDeliveryEvent {
  projectId: string;
  threadId: string;
  source: HostDeliverySource;
}

export interface HostDeliveryRevisionEvent extends HostDeliveryEvent {
  revision: string;
}

export interface HostDeliverySyncedEvent extends HostDeliveryRevisionEvent {
  result: HostWorktreeDeliveryResult;
}

export interface HostDeliveryConflictEvent extends HostDeliveryRevisionEvent {
  preflight: HostWorktreeDeliveryPreflight;
  error: string;
}

export interface HostDeliveryFailedEvent extends HostDeliveryEvent {
  revision?: string;
  preflight?: HostWorktreeDeliveryPreflight;
  error: string;
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
  setupIssue?:
    | "cli_missing"
    | "authentication_required"
    | "remote_missing"
    | "remote_ambiguous"
    | "repository_unavailable"
    | "unknown";
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

export const THREADLIGHT_HOST_PROTOCOL_VERSION = 2 as const;

export interface ThreadlightHostHealth {
  ok: true;
  protocolVersion: typeof THREADLIGHT_HOST_PROTOCOL_VERSION;
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
  cwd?: string;
  branch?: string;
}

export type TerminalWorkspaceScope = "task" | "original";

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
      workspace?: TerminalWorkspaceScope;
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

export type DesktopComputerMethod = (typeof DESKTOP_COMPUTER_METHODS)[number];

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
  errorCode?: string;
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

export type AgentTaskStatusData =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export type AgentTaskPhaseData =
  "queued" | "thinking" | "working" | "waiting" | "done";

export interface AgentTaskActivityData {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  durationMs?: number;
}

/** Display-safe projection of one provider-neutral agent task. */
export interface AgentTaskData {
  id: string;
  parentId?: string;
  retryOf?: string;
  runId?: string;
  name: string;
  role: string;
  task: string;
  status: AgentTaskStatusData;
  phase: AgentTaskPhaseData;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  elapsedMs: number;
  latestActivity?: string;
  summary?: string;
  output?: string;
  error?: string;
  steps?: number;
  usage?: TokenUsageData;
  activities: readonly AgentTaskActivityData[];
}

export interface AgentTreeData {
  rootId: string;
  maxConcurrent: number;
  agents: readonly AgentTaskData[];
}

/**
 * Host-owned projection of a turn that is still running.
 *
 * Clients render this snapshot when attaching to an existing thread; they do
 * not need to have observed every earlier streaming notification.
 */
export interface ActiveTurnData {
  turnId: string;
  revision: number;
  mode: TurnMode;
  isThinking: boolean;
  streamingText: string;
  progress: readonly ConversationProgressData[];
  plan?: AgentPlanData;
  agentTree?: AgentTreeData;
}

export type CapabilityKind = "skill" | "tool";
export type CapabilityVisibility = "featured" | "search" | "hidden";
export type CapabilityStatus =
  "ready" | "needs_configuration" | "needs_authorization";

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
  /** How a running-turn follow-up entered the conversation. */
  followUpDelivery?: FollowUpDelivery;
  capabilityRefs?: readonly string[];
  /** Display-safe snapshot of capabilities selected or applied for this message. */
  capabilities?: readonly MessageCapabilityData[];
  error?: boolean;
  mode?: TurnMode;
  plan?: AgentPlanData;
  progress?: readonly ConversationProgressData[];
  /** Final inspectable snapshot for turns that delegated to subagents. */
  agentTree?: AgentTreeData;
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
  attachments?: readonly AttachmentData[];
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
    params: { developmentMode?: TaskDevelopmentMode } | undefined;
    result: { threadId: string };
  };
  "thread/resume": {
    params: { threadId: string };
    result: {
      threadId: string;
      messages: readonly ConversationMessageData[];
      queuedTurns: readonly QueuedTurnData[];
      revision: number;
      activeTurn?: ActiveTurnData;
      /** Provider/model selected for this conversation, if any. */
      provider?: string;
      model?: string;
    };
  };
  "thread/delete": {
    params: { threadId: string };
    result: { deleted: boolean };
  };
  "thread/suggestions": {
    params: { threadId?: string; language: SuggestionLanguage };
    result: { suggestions: readonly [string, string, string] };
  };
  "delivery/pull-request-description": {
    params: {
      threadId: string;
      changes: readonly PullRequestChangeSummary[];
    };
    result: PullRequestDescriptionData;
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
      /** Provider routing hint for this turn; defaults to the conversation's. */
      provider?: string;
      /** Model override for this turn; defaults to the conversation's. */
      model?: string;
    };
    result: { turnId: string };
  };
  "turn/interrupt": {
    params: { threadId: string };
    result: { interrupted: boolean };
  };
  "agent/cancel": {
    params: { threadId: string; agentId: string };
    result: { cancelled: boolean };
  };
  "agent/steer": {
    params: { threadId: string; agentId: string; input: string };
    result: { accepted: boolean };
  };
  "agent/retry": {
    params: { threadId: string; agentId: string };
    result: { agent?: AgentTaskData };
  };
  "turn/follow-up": {
    params: {
      threadId: string;
      input: string;
      delivery: FollowUpDelivery;
      attachments?: readonly AttachmentData[];
    };
    result: { item: QueuedTurnData };
  };
  "turn/queue/inject": {
    params: { threadId: string; itemId: string };
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
      /** Routes the response back to the task-owned runtime on a Host. */
      threadId?: string;
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
  "delivery/pull-request-description",
  "capability/list",
  "connector/status",
  "connector/configure",
  "connector/authorize",
  "connector/disconnect",
  "turn/start",
  "turn/interrupt",
  "agent/cancel",
  "agent/steer",
  "agent/retry",
  "turn/follow-up",
  "turn/queue/inject",
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
  "delivery/syncing": HostDeliveryRevisionEvent;
  "delivery/synced": HostDeliverySyncedEvent;
  "delivery/conflict": HostDeliveryConflictEvent;
  "delivery/failed": HostDeliveryFailedEvent;
  "thread/title": {
    threadId: string;
    title: string;
  };
  "turn/started": {
    threadId: string;
    turnId: string;
    mode: TurnMode;
    revision: number;
    activeTurn: ActiveTurnData;
  };
  "turn/completed": {
    threadId: string;
    turnId: string;
    revision: number;
    message: ConversationMessageData;
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
    revision: number;
    message: ConversationMessageData;
    error: string;
    diagnostics?: TurnDiagnosticsData;
  };
  "agent/event": {
    threadId: string;
    turnId: string;
    revision: number;
    activeTurn: ActiveTurnData;
    event: AgentEventData;
  };
  "agent/tree-updated": {
    threadId: string;
    turnId: string;
    revision: number;
    activeTurn: ActiveTurnData;
    changedAgentId: string;
    reason:
      | "created"
      | "started"
      | "progress"
      | "completed"
      | "failed"
      | "cancelled"
      | "steered";
    tree: AgentTreeData;
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

export type ThreadlightNotificationMethod = keyof ThreadlightNotificationMap;

export type ThreadlightNotification = {
  [Method in ThreadlightNotificationMethod]: JsonRpcNotification<
    Method,
    ThreadlightNotificationMap[Method]
  > & { params: ThreadlightNotificationMap[Method] };
}[ThreadlightNotificationMethod];
