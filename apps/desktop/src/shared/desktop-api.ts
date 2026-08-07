import type {
  AttachmentData,
  ConversationAccessMode,
  HostDirectoryListing,
  HostFileListing,
  HostProjectDiagnosticBundle,
  JsonRpcOutgoing,
  JsonRpcRequest,
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalWorkspaceScope,
} from "@threadlight/protocol";

export const DESKTOP_REQUEST_CHANNEL = "threadlight:request";
export const DESKTOP_MESSAGE_CHANNEL = "threadlight:message";
export const DESKTOP_SETTINGS_GET_CHANNEL = "threadlight:settings:get";
export const DESKTOP_SETTINGS_UPDATE_CHANNEL = "threadlight:settings:update";
export const DESKTOP_DIAGNOSTICS_GET_CHANNEL =
  "threadlight:diagnostics:get";
export const DESKTOP_DIAGNOSTICS_EXPORT_CHANNEL =
  "threadlight:diagnostics:export";
export const DESKTOP_PROVIDER_TEST_CHANNEL =
  "threadlight:provider:test";
export const DESKTOP_CLIPBOARD_WRITE_CHANNEL = "threadlight:clipboard:write";
export const DESKTOP_EXTERNAL_OPEN_CHANNEL = "threadlight:external:open";
export const DESKTOP_PROJECTS_GET_CHANNEL = "threadlight:projects:get";
export const DESKTOP_PROJECT_OPEN_CHANNEL = "threadlight:project:open";
export const DESKTOP_STANDALONE_CREATE_CHANNEL =
  "threadlight:standalone:create";
export const DESKTOP_PROJECT_ACTIVATE_CHANNEL = "threadlight:project:activate";
export const DESKTOP_PROJECT_UPDATE_CHANNEL = "threadlight:project:update";
export const DESKTOP_PROJECT_DELETE_CHANNEL = "threadlight:project:delete";
export const DESKTOP_REMOTE_RUNTIME_CONNECT_CHANNEL =
  "threadlight:host:connect";
export const DESKTOP_HOSTS_GET_CHANNEL = "threadlight:hosts:get";
export const DESKTOP_HOST_ACTIVATE_CHANNEL = "threadlight:host:activate";
export const DESKTOP_HOST_UPDATE_CHANNEL = "threadlight:host:update";
export const DESKTOP_HOST_DELETE_CHANNEL = "threadlight:host:delete";
export const DESKTOP_HOST_DIRECTORIES_CHANNEL =
  "threadlight:host:directories";
export const DESKTOP_PROJECT_OPENERS_GET_CHANNEL =
  "threadlight:project-openers:get";
export const DESKTOP_PROJECT_OPEN_WITH_CHANNEL =
  "threadlight:project-open-with";
export const DESKTOP_CONVERSATION_UPSERT_CHANNEL =
  "threadlight:conversation:upsert";
export const DESKTOP_CONVERSATION_UPDATE_CHANNEL =
  "threadlight:conversation:update";
export const DESKTOP_CONVERSATION_READ_CHANNEL =
  "threadlight:conversation:read";
export const DESKTOP_CONVERSATION_DELETE_CHANNEL =
  "threadlight:conversation:delete";
export const DESKTOP_PROJECT_MEMORY_GET_CHANNEL =
  "threadlight:project-memory:get";
export const DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL =
  "threadlight:project-memory:open";
export const DESKTOP_SEARCH_CHANNEL = "threadlight:search";
export const DESKTOP_AUTOMATIONS_GET_CHANNEL =
  "threadlight:automations:get";
export const DESKTOP_AUTOMATIONS_CREATE_CHANNEL =
  "threadlight:automations:create";
export const DESKTOP_AUTOMATIONS_UPDATE_CHANNEL =
  "threadlight:automations:update";
export const DESKTOP_AUTOMATIONS_DELETE_CHANNEL =
  "threadlight:automations:delete";
export const DESKTOP_AUTOMATIONS_RUN_CHANNEL =
  "threadlight:automations:run";
export const DESKTOP_AUTOMATIONS_CHANGED_CHANNEL =
  "threadlight:automations:changed";
export const DESKTOP_AUTOMATION_OPEN_CHANNEL =
  "threadlight:automation:open";
export const DESKTOP_AUDIO_TRANSCRIBE_CHANNEL =
  "threadlight:audio:transcribe";
export const DESKTOP_ATTACHMENT_REFERENCE_CHANNEL =
  "threadlight:attachment:reference";
export const DESKTOP_COMPUTER_SHARE_GET_CHANNEL =
  "threadlight:computer-share:get";
export const DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL =
  "threadlight:computer-share:show";
export const DESKTOP_COMPUTER_SHARE_STOP_CHANNEL =
  "threadlight:computer-share:stop";
export const DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL =
  "threadlight:computer-share:changed";
export const DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL =
  "threadlight:computer-permission:get";
export const DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL =
  "threadlight:computer-permission:request";
export const DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL =
  "threadlight:computer-permission:relaunch";
export const DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL =
  "threadlight:computer-permission:changed";
export const DESKTOP_TERMINAL_CREATE_CHANNEL = "threadlight:terminal:create";
export const DESKTOP_TERMINAL_WRITE_CHANNEL = "threadlight:terminal:write";
export const DESKTOP_TERMINAL_RESIZE_CHANNEL = "threadlight:terminal:resize";
export const DESKTOP_TERMINAL_CLOSE_CHANNEL = "threadlight:terminal:close";
export const DESKTOP_TERMINAL_EVENT_CHANNEL = "threadlight:terminal:event";
export const DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL =
  "threadlight:conversation-changes:get";
export const DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL =
  "threadlight:conversation-changes:restore";
export const DESKTOP_WORKTREE_DELIVERY_PREFLIGHT_CHANNEL =
  "threadlight:worktree-delivery:preflight";
export const DESKTOP_WORKTREE_DELIVERY_HISTORY_CHANNEL =
  "threadlight:worktree-delivery:history";
export const DESKTOP_WORKTREE_DELIVERY_APPLY_CHANNEL =
  "threadlight:worktree-delivery:apply";
export const DESKTOP_WORKTREE_DELIVERY_UNDO_CHANNEL =
  "threadlight:worktree-delivery:undo";
export const DESKTOP_WORKTREE_DELIVERY_COMMIT_CHANNEL =
  "threadlight:worktree-delivery:commit";
export const DESKTOP_CODE_HOST_DELIVERY_STATUS_CHANNEL =
  "threadlight:code-host-delivery:status";
export const DESKTOP_CODE_HOST_DELIVERY_COMMIT_PUSH_CHANNEL =
  "threadlight:code-host-delivery:commit-push";
export const DESKTOP_CODE_HOST_DELIVERY_CREATE_PR_CHANNEL =
  "threadlight:code-host-delivery:create-pr";
export const DESKTOP_WORKSPACE_LIST_CHANNEL = "threadlight:workspace:list";
export const DESKTOP_WORKSPACE_FILE_GET_CHANNEL =
  "threadlight:workspace-file:get";
export const DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL =
  "threadlight:workspace-file:reveal";
export const DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL =
  "threadlight:system-file:choose";
export const DESKTOP_SYSTEM_FILE_LIST_CHANNEL =
  "threadlight:system-file:list";
export const DESKTOP_SYSTEM_FILE_GET_CHANNEL =
  "threadlight:system-file:get";
export const DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL =
  "threadlight:system-file:reveal";
export const DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL =
  "threadlight:execution-approval:required";
export const DESKTOP_EXECUTION_APPROVAL_RESOLVED_CHANNEL =
  "threadlight:execution-approval:resolved";
export const DESKTOP_EXECUTION_APPROVAL_RESPOND_CHANNEL =
  "threadlight:execution-approval:respond";
export const DESKTOP_EXECUTION_POLICY_GET_CHANNEL =
  "threadlight:execution-policy:get";
export const DESKTOP_EXECUTION_POLICY_REVOKE_CHANNEL =
  "threadlight:execution-policy:revoke";

export type DesktopModelProvider =
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "doubao"
  | "gemini"
  | "grok"
  | "custom";
export type DesktopLanguage = "zh-CN" | "zh-TW" | "en" | "ja" | "ko";
export type DesktopTheme = "system" | "light" | "dark";
export type DesktopProjectOpener = string;

export interface DesktopSettingsSnapshot {
  language: DesktopLanguage;
  theme: DesktopTheme;
  preferredProjectOpener: DesktopProjectOpener;
  provider: DesktopModelProvider;
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
  customModel: string;
  model: string;
}

export interface DesktopSettingsUpdate {
  language?: DesktopLanguage;
  theme?: DesktopTheme;
  preferredProjectOpener?: DesktopProjectOpener;
  provider: DesktopModelProvider;
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
  customModel: string;
  model: string;
}

export interface DesktopDiagnosticsTotals {
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

export interface DesktopModelStepDiagnostic {
  step: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface DesktopToolCallDiagnostic {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
  errorCode?: string;
}

export interface DesktopTurnDiagnostic {
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
  modelSteps: readonly DesktopModelStepDiagnostic[];
  toolCalls: readonly DesktopToolCallDiagnostic[];
}

export interface DesktopProjectDiagnosticsSnapshot {
  projectId: string;
  projectName: string;
  generatedAt: string;
  totals: DesktopDiagnosticsTotals;
  turns: readonly DesktopTurnDiagnostic[];
}

export type DesktopProjectDiagnosticBundle = HostProjectDiagnosticBundle;

export interface DesktopProviderTestRequest {
  provider: DesktopModelProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string | null;
}

export type DesktopProviderDiagnosticCode =
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

export interface DesktopProviderDiagnostic {
  status: "success" | "warning" | "error";
  code: DesktopProviderDiagnosticCode;
  provider: DesktopModelProvider;
  model: string;
  endpoint: string;
  checkedAt: string;
  latencyMs: number;
  httpStatus?: number;
  detail?: string;
}

export interface DesktopConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: DesktopConversationStatus;
  unread?: boolean;
  renamedAt?: string;
  titleGeneratedAt?: string;
  pinnedAt?: string;
  archivedAt?: string;
  accessMode?: ConversationAccessMode;
  workspace?: DesktopTaskWorkspace;
}

export type DesktopConversationStatus = "pending" | "completed" | "attention";

export type DesktopTaskWorkspace =
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

export interface DesktopProject {
  id: string;
  name: string;
  basePath: string;
  lastOpenedAt: string;
  scope?: "project" | "standalone";
  pinnedAt?: string;
  conversations: readonly DesktopConversationSummary[];
  runtime?: DesktopProjectRuntime;
}

export interface DesktopProjectMetadataUpdate {
  id: string;
  pinned: boolean;
}

export interface DesktopProjectRuntime {
  kind: "remote";
  hostId: string;
  endpoint: string;
  workspacePath: string;
  runtimeId: string;
}

export interface DesktopProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly DesktopProject[];
}

export interface DesktopRemoteRuntimeConnectRequest {
  endpoint: string;
  token: string;
  name?: string;
}

export interface DesktopHostUpdateRequest {
  hostId: string;
  endpoint: string;
  token?: string;
  name?: string;
}

export interface DesktopHostSummary {
  id: string;
  name: string;
  kind: "local" | "remote";
  endpoint?: string;
}

export interface DesktopHostsSnapshot {
  activeHostId: string;
  hosts: readonly DesktopHostSummary[];
}

export interface DesktopProjectOpenerOption {
  id: DesktopProjectOpener;
  label: string;
  available: boolean;
  default: boolean;
  iconDataUrl?: string;
}

export interface DesktopProjectOpenWithRequest {
  projectId: string;
  opener: DesktopProjectOpener;
  threadId?: string;
}

export interface DesktopConversationUpdate {
  projectId: string;
  id: string;
  title: string;
}

export interface DesktopConversationMetadataUpdate {
  projectId: string;
  id: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  accessMode?: ConversationAccessMode;
}

export interface DesktopConversationTarget {
  projectId: string;
  id: string;
}

export interface DesktopProjectMemorySnapshot {
  path: string;
  content: string;
  revision: string;
}

export interface DesktopAudioTranscriptionRequest {
  audio: ArrayBuffer;
  mimeType: string;
}

export interface DesktopAttachmentReferenceRequest {
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export interface DesktopComputerShareTarget {
  id: string;
  name: string;
  applicationName?: string;
}

export interface DesktopComputerShareSnapshot {
  active: boolean;
  pictureInPicture: boolean;
  ownerThreadId?: string;
  targets: readonly DesktopComputerShareTarget[];
}

export type DesktopComputerPermissionCapability =
  | "screen_recording"
  | "accessibility";

export type DesktopComputerPermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export interface DesktopComputerPermissionSnapshot {
  required: boolean;
  blockingCapability?: DesktopComputerPermissionCapability;
  ownerThreadId?: string;
  screenRecording: DesktopComputerPermissionStatus;
  accessibility: "granted" | "denied";
  relaunchRequired: boolean;
}

export interface DesktopTerminalCreateRequest {
  projectId: string;
  threadId?: string;
  workspace?: TerminalWorkspaceScope;
  cols: number;
  rows: number;
}

export type DesktopTerminalSession = TerminalSessionInfo;

export interface DesktopTerminalWriteRequest {
  sessionId: string;
  data: string;
}

export interface DesktopTerminalResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

export type DesktopTerminalEvent = TerminalSessionEvent;

export interface DesktopConversationChangesRequest {
  projectId: string;
  threadId: string;
}

export interface DesktopConversationChangesRestoreRequest
  extends DesktopConversationChangesRequest {
  revision: string;
  paths?: readonly string[];
}

export interface DesktopWorktreeDeliveryRequest
  extends DesktopConversationChangesRequest {
  revision: string;
}

export interface DesktopWorktreeDeliveryCommitRequest
  extends DesktopWorktreeDeliveryRequest {
  message: string;
}

export interface DesktopWorktreeDeliveryConflict {
  path: string;
  reason:
    | "both_added"
    | "target_deleted"
    | "target_modified"
    | "merge_conflict"
    | "unsafe_target";
}

export interface DesktopWorktreeDeliveryPreflight {
  taskBranch: string;
  targetBranch: string;
  sourceBranch?: string;
  branchChanged: boolean;
  files: number;
  pendingFiles: number;
  alreadyAppliedFiles: number;
  localOnlyFiles?: number;
  conflicts: readonly DesktopWorktreeDeliveryConflict[];
}

export interface DesktopWorktreeDeliveryResult
  extends DesktopWorktreeDeliveryPreflight {
  appliedFiles: number;
  commit?: string;
  undoAvailable?: boolean;
}

export interface DesktopWorktreeDeliveryUndoResult {
  targetBranch: string;
  revertedFiles: number;
  revision: string;
}

export interface DesktopWorktreeDeliveryHistoryEntry {
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
  conflicts?: readonly DesktopWorktreeDeliveryConflict[];
  error?: string;
}

export interface DesktopWorktreeDeliveryHistorySnapshot {
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
  entries: readonly DesktopWorktreeDeliveryHistoryEntry[];
}

export interface DesktopCodeHostCheck {
  name: string;
  status: "queued" | "running" | "success" | "failure" | "skipped";
  url?: string;
}

export interface DesktopCodeHostReviewComment {
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

export interface DesktopCodeHostPullRequest {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headBranch: string;
  baseBranch: string;
  ciStatus: "none" | "pending" | "success" | "failure";
  reviewDecision?: string;
  checks: readonly DesktopCodeHostCheck[];
  comments: readonly DesktopCodeHostReviewComment[];
}

export interface DesktopCodeHostDeliveryStatus {
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
  pullRequest?: DesktopCodeHostPullRequest;
}

export interface DesktopCodeHostCommitPushRequest
  extends DesktopWorktreeDeliveryRequest {
  message: string;
}

export interface DesktopCodeHostCommitPushResult {
  commit: string;
  status: DesktopCodeHostDeliveryStatus;
}

export interface DesktopCodeHostCreatePullRequest
  extends DesktopWorktreeDeliveryRequest {
  title: string;
  body?: string;
  draft: boolean;
}

export interface DesktopConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface DesktopConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly DesktopConversationFileChange[];
}

export interface DesktopWorkspaceListRequest {
  projectId: string;
  threadId?: string;
  path?: string;
}

export interface DesktopWorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface DesktopWorkspaceFileRequest {
  projectId: string;
  threadId?: string;
  path: string;
}

export interface DesktopWorkspaceFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export interface DesktopSystemFileRequest {
  path: string;
}

export type DesktopSearchMode = "all" | "files";

export interface DesktopSearchRequest {
  projectId: string;
  threadId?: string;
  query: string;
  mode: DesktopSearchMode;
  limit?: number;
}

export interface DesktopSearchResult {
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

export type DesktopAutomationKind =
  | "custom"
  | "tests"
  | "dependencies"
  | "issue-triage";

export type DesktopAutomationCadence =
  | "daily"
  | "weekdays"
  | "weekly";

export interface DesktopAutomationSchedule {
  cadence: DesktopAutomationCadence;
  time: string;
  weekday?: number;
}

export type DesktopAutomationRunStatus =
  | "running"
  | "succeeded"
  | "attention"
  | "failed";

export interface DesktopAutomationRun {
  status: DesktopAutomationRunStatus;
  startedAt: string;
  completedAt?: string;
  threadId?: string;
  summary?: string;
}

export interface DesktopAutomation {
  id: string;
  projectId: string;
  name: string;
  kind: DesktopAutomationKind;
  prompt: string;
  enabled: boolean;
  schedule: DesktopAutomationSchedule;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRun?: DesktopAutomationRun;
}

export interface DesktopAutomationsSnapshot {
  projectId: string;
  generatedAt: string;
  timeZone: string;
  automations: readonly DesktopAutomation[];
}

export interface DesktopAutomationCreateRequest {
  projectId: string;
  name: string;
  kind: DesktopAutomationKind;
  prompt: string;
  enabled: boolean;
  schedule: DesktopAutomationSchedule;
}

export interface DesktopAutomationUpdateRequest
  extends DesktopAutomationCreateRequest {
  id: string;
}

export interface DesktopAutomationTarget {
  projectId: string;
  id: string;
}

export interface DesktopExecutionApprovalRequest {
  requestId: string;
  projectId: string;
  projectName: string;
  threadId: string;
  runId: string;
  toolName: string;
  permissionKey: string;
  risk: "write";
  summary: string;
  detail?: string;
  external: boolean;
  projectScopeAvailable: boolean;
}

export type DesktopExecutionApprovalScope = "once" | "task" | "project";

export interface DesktopExecutionApprovalResponse {
  requestId: string;
  decision: "allow" | "deny";
  scope: DesktopExecutionApprovalScope;
}

export interface DesktopExecutionPolicyGrant {
  permissionKey: string;
  label: string;
  external: boolean;
  grantedAt: string;
}

export interface DesktopExecutionPolicySnapshot {
  projectId: string;
  rules: {
    read: "allow";
    write: "ask";
    destructive: "deny";
  };
  permanentGrants: readonly DesktopExecutionPolicyGrant[];
}

export interface DesktopExecutionPolicyRevokeRequest {
  projectId: string;
  permissionKey: string;
}

export interface DesktopApi {
  readonly isMacOS: boolean;
  send(message: JsonRpcRequest): void;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
  writeClipboardText(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  getSettings(): Promise<DesktopSettingsSnapshot>;
  updateSettings(
    update: DesktopSettingsUpdate,
  ): Promise<DesktopSettingsSnapshot>;
  getDiagnostics(projectId: string): Promise<DesktopProjectDiagnosticsSnapshot>;
  exportDiagnostics(projectId: string): Promise<DesktopProjectDiagnosticBundle>;
  testProvider(
    request: DesktopProviderTestRequest,
  ): Promise<DesktopProviderDiagnostic>;
  getProjects(): Promise<DesktopProjectsSnapshot>;
  openProject(path?: string): Promise<DesktopProjectsSnapshot>;
  createStandaloneTask(): Promise<DesktopProjectsSnapshot>;
  getHosts(): Promise<DesktopHostsSnapshot>;
  connectRemoteRuntime(
    request: DesktopRemoteRuntimeConnectRequest,
  ): Promise<DesktopHostsSnapshot>;
  activateHost(hostId: string): Promise<DesktopHostsSnapshot>;
  updateHost(request: DesktopHostUpdateRequest): Promise<DesktopHostsSnapshot>;
  deleteHost(hostId: string): Promise<DesktopHostsSnapshot>;
  listRemoteDirectories(path: string): Promise<HostDirectoryListing>;
  activateProject(projectId: string): Promise<DesktopProjectsSnapshot>;
  updateProject(
    update: DesktopProjectMetadataUpdate,
  ): Promise<DesktopProjectsSnapshot>;

    deleteProject(projectId: string): Promise<DesktopProjectsSnapshot>;
  getProjectOpeners(
    projectId?: string,
  ): Promise<readonly DesktopProjectOpenerOption[]>;
  openProjectWith(request: DesktopProjectOpenWithRequest): Promise<void>;
  upsertConversation(
    update: DesktopConversationUpdate,
  ): Promise<DesktopProjectsSnapshot>;
  updateConversation(
    update: DesktopConversationMetadataUpdate,
  ): Promise<DesktopProjectsSnapshot>;
  markConversationRead(
    target: DesktopConversationTarget,
  ): Promise<DesktopProjectsSnapshot>;
  deleteConversation(
    target: DesktopConversationTarget,
  ): Promise<DesktopProjectsSnapshot>;
  getProjectMemory(projectId: string): Promise<DesktopProjectMemorySnapshot>;
  openProjectMemory(projectId: string): Promise<void>;
  search(request: DesktopSearchRequest): Promise<readonly DesktopSearchResult[]>;
  getAutomations(projectId: string): Promise<DesktopAutomationsSnapshot>;
  createAutomation(
    request: DesktopAutomationCreateRequest,
  ): Promise<DesktopAutomationsSnapshot>;
  updateAutomation(
    request: DesktopAutomationUpdateRequest,
  ): Promise<DesktopAutomationsSnapshot>;
  deleteAutomation(
    target: DesktopAutomationTarget,
  ): Promise<DesktopAutomationsSnapshot>;
  runAutomation(
    target: DesktopAutomationTarget,
  ): Promise<DesktopAutomationsSnapshot>;
  onAutomationsChanged(
    listener: (snapshot: DesktopAutomationsSnapshot) => void,
  ): () => void;
  onAutomationOpen(
    listener: (target: DesktopConversationTarget) => void,
  ): () => void;
  onExecutionApprovalRequired(
    listener: (request: DesktopExecutionApprovalRequest) => void,
  ): () => void;
  onExecutionApprovalResolved(
    listener: (requestId: string) => void,
  ): () => void;
  respondExecutionApproval(
    response: DesktopExecutionApprovalResponse,
  ): Promise<void>;
  getExecutionPolicy(
    projectId: string,
  ): Promise<DesktopExecutionPolicySnapshot>;
  revokeExecutionPolicyGrant(
    request: DesktopExecutionPolicyRevokeRequest,
  ): Promise<DesktopExecutionPolicySnapshot>;
  transcribeAudio(
    request: DesktopAudioTranscriptionRequest,
  ): Promise<string>;
  createAttachmentReference(file: File): Promise<AttachmentData>;
  getComputerShare(): Promise<DesktopComputerShareSnapshot>;
  showComputerShare(): Promise<DesktopComputerShareSnapshot>;
  stopComputerShare(): Promise<DesktopComputerShareSnapshot>;
  onComputerShareChanged(
    listener: (snapshot: DesktopComputerShareSnapshot) => void,
  ): () => void;
  getComputerPermissions(): Promise<DesktopComputerPermissionSnapshot>;
  requestComputerPermission(
    capability: DesktopComputerPermissionCapability,
  ): Promise<DesktopComputerPermissionSnapshot>;
  relaunchForComputerPermissions(): Promise<void>;
  onComputerPermissionChanged(
    listener: (snapshot: DesktopComputerPermissionSnapshot) => void,
  ): () => void;
  createTerminal(
    request: DesktopTerminalCreateRequest,
  ): Promise<DesktopTerminalSession>;
  writeTerminal(request: DesktopTerminalWriteRequest): void;
  resizeTerminal(request: DesktopTerminalResizeRequest): void;
  closeTerminal(sessionId: string): Promise<void>;
  onTerminalEvent(
    listener: (event: DesktopTerminalEvent) => void,
  ): () => void;
  getConversationChanges(
    request: DesktopConversationChangesRequest,
  ): Promise<DesktopConversationChangesSnapshot>;
  restoreConversationChanges(
    request: DesktopConversationChangesRestoreRequest,
  ): Promise<DesktopConversationChangesSnapshot>;
  preflightWorktreeDelivery(
    request: DesktopWorktreeDeliveryRequest,
  ): Promise<DesktopWorktreeDeliveryPreflight>;
  getWorktreeDeliveryHistory(
    request: DesktopConversationChangesRequest,
  ): Promise<DesktopWorktreeDeliveryHistorySnapshot>;
  applyWorktreeDelivery(
    request: DesktopWorktreeDeliveryRequest,
  ): Promise<DesktopWorktreeDeliveryResult>;
  undoWorktreeDelivery(
    request: DesktopWorktreeDeliveryRequest,
  ): Promise<DesktopWorktreeDeliveryUndoResult>;
  commitWorktreeDelivery(
    request: DesktopWorktreeDeliveryCommitRequest,
  ): Promise<DesktopWorktreeDeliveryResult>;
  getCodeHostDeliveryStatus(
    request: DesktopWorktreeDeliveryRequest,
  ): Promise<DesktopCodeHostDeliveryStatus>;
  commitAndPushCodeHostDelivery(
    request: DesktopCodeHostCommitPushRequest,
  ): Promise<DesktopCodeHostCommitPushResult>;
  createPullRequest(
    request: DesktopCodeHostCreatePullRequest,
  ): Promise<DesktopCodeHostDeliveryStatus>;
  listWorkspace(
    request: DesktopWorkspaceListRequest,
  ): Promise<readonly DesktopWorkspaceEntry[]>;
  getWorkspaceFile(
    request: DesktopWorkspaceFileRequest,
  ): Promise<DesktopWorkspaceFile>;
  revealWorkspaceFile(request: DesktopWorkspaceFileRequest): Promise<void>;
  chooseSystemFile(): Promise<string | undefined>;
  listSystemFiles(path: string): Promise<HostFileListing>;
  getSystemFile(request: DesktopSystemFileRequest): Promise<DesktopWorkspaceFile>;
  revealSystemFile(request: DesktopSystemFileRequest): Promise<void>;
}
