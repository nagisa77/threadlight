import type { AgentTaskStatusData } from "./conversation-protocol.js";

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

export const SUPPORTED_LANGUAGES = [
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
] as const;
export type HostLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isHostLanguage(value: unknown): value is HostLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}
export type HostTheme = "system" | "light" | "dark";
export type HostSearchProvider = "brave" | "linkup";

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
  searchProvider: HostSearchProvider;
  /** Brave Search credential status. Kept under the legacy name for compatibility. */
  searchApiKeyConfigured: boolean;
  linkupApiKeyConfigured: boolean;
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
  searchProvider?: HostSearchProvider;
  /** Brave Search credential. Kept under the legacy name for compatibility. */
  searchApiKey?: string | null;
  linkupApiKey?: string | null;
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
  agentId?: string;
  agentRole?: string;
}

export interface HostToolCallDiagnostic {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
  errorCode?: string;
  agentId?: string;
  agentRole?: string;
}

export interface HostTurnDiagnosticScope {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelSteps: number;
  toolCalls: number;
  toolDurationMs: number;
}

export interface HostTurnDiagnosticMetrics {
  root: HostTurnDiagnosticScope;
  children: HostTurnDiagnosticScope;
  total: HostTurnDiagnosticScope;
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
  /** Present for turns recorded with scoped multi-agent diagnostics. */
  metrics?: HostTurnDiagnosticMetrics;
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
  "turn" | "agent" | "model" | "tool" | "process";

export interface HostDiagnosticTimelineEvent {
  sequence: number;
  threadId: string;
  messageId?: string;
  agentId?: string;
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
  source: "turn" | "agent" | "tool" | "process";
  code: string;
  message?: string;
  occurredAt?: string;
}

export interface HostDiagnosticAgent {
  threadId: string;
  messageId: string;
  rootId: string;
  maxConcurrent: number;
  agentId: string;
  parentId?: string;
  name: string;
  role: string;
  status: AgentTaskStatusData;
  /** Recursively redacted agent snapshot, including its visible transcript. */
  record: Readonly<Record<string, unknown>>;
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
  agents: readonly HostDiagnosticAgent[];
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

export interface HostDirectoryListOptions {
  showHidden?: boolean;
  strict?: boolean;
}

export interface HostDirectoryListing {
  path: string;
  parentPath?: string;
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

export const THREADLIGHT_HOST_PROTOCOL_VERSION = 3 as const;
