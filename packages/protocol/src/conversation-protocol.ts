import {
  THREADLIGHT_HOST_PROTOCOL_VERSION,
  type HostDeliveryConflictEvent,
  type HostDeliveryFailedEvent,
  type HostDeliveryRevisionEvent,
  type HostDeliverySyncedEvent,
  type HostLanguage,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PullRequestChangeSummary,
  type PullRequestDescriptionData,
  type TaskDevelopmentMode,
} from "./host-protocol.js";

/** Stable, locale-neutral errors shared by every voice-input transport. */
export const VOICE_INPUT_ERROR_CODES = {
  openAiKeyRequired: "voice_input.openai_key_required",
  unsupportedFormat: "voice_input.unsupported_format",
  emptyRecording: "voice_input.empty_recording",
  recordingTooLarge: "voice_input.recording_too_large",
  serviceUnavailable: "voice_input.service_unavailable",
  emptyTranscript: "voice_input.empty_transcript",
  openAiKeyInvalid: "voice_input.openai_key_invalid",
  rateLimited: "voice_input.rate_limited",
  transcriptionFailed: "voice_input.transcription_failed",
} as const;

export type VoiceInputErrorCode =
  (typeof VOICE_INPUT_ERROR_CODES)[keyof typeof VOICE_INPUT_ERROR_CODES];

/** Stable attachment errors; presentation layers translate these codes. */
export const ATTACHMENT_ERROR_CODES = {
  stagingUnavailable: "attachment.staging_unavailable",
  localPathUnavailable: "attachment.local_path_unavailable",
  localFileRequired: "attachment.local_file_required",
  fileChanged: "attachment.file_changed",
  invalidLocalPath: "attachment.invalid_local_path",
  invalidSize: "attachment.invalid_size",
  projectRequired: "attachment.project_required",
} as const;

export type AttachmentErrorCode =
  (typeof ATTACHMENT_ERROR_CODES)[keyof typeof ATTACHMENT_ERROR_CODES];

/** Stable connector authorization errors shared by browser adapters. */
export const CONNECTOR_AUTH_ERROR_CODES = {
  popupBlocked: "connector_auth.popup_blocked",
  popupClosed: "connector_auth.popup_closed",
} as const;

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

/** Provider-confirmed usage and observed stream volume for a running turn. */
export interface ActiveTurnMetricsData {
  startedAt: string;
  usage: TokenUsageData;
  modelDurationMs: number;
  completedModelSteps: number;
  streamedBytes: number;
}

export interface ModelStepDiagnosticsData {
  step: number;
  durationMs: number;
  usage: TokenUsageData;
  agentId?: string;
  agentRole?: string;
}

export interface ToolCallDiagnosticsData {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
  errorCode?: string;
  agentId?: string;
  agentRole?: string;
}

export interface TurnDiagnosticsScopeData {
  usage: TokenUsageData;
  modelSteps: readonly ModelStepDiagnosticsData[];
  toolCalls: readonly ToolCallDiagnosticsData[];
}

export interface TurnDiagnosticsMetricsData {
  root: TurnDiagnosticsScopeData;
  children: TurnDiagnosticsScopeData;
  total: TurnDiagnosticsScopeData;
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
  /**
   * Scoped metrics for multi-agent turns. Optional so conversations written
   * before scoped diagnostics remain readable.
   */
  metrics?: TurnDiagnosticsMetricsData;
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
  /**
   * The Host retained detail/process output that was omitted from a lightweight
   * conversation projection. Clients can retrieve it with `activity/read`.
   */
  detailAvailable?: boolean;
  detail?: string;
  process?: ProcessSnapshotData;
}

export interface ConversationProgressData {
  text: string;
  activities: readonly ConversationActivityData[];
}

export type AgentTaskStatusData =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type AgentTaskPhaseData =
  "queued" | "thinking" | "working" | "waiting" | "done";

export interface AgentTaskActivityData {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  durationMs?: number;
}

export interface AgentTaskMessageData {
  id: string;
  fromAgentId: string;
  fromAgentThreadId: string;
  fromAgentName: string;
  toAgentThreadId: string;
  text: string;
  createdAt: string;
  delivery: "active" | "follow_up";
}

export type AgentTaskTranscriptEntryData =
  | {
      id: string;
      kind: "model";
      step: number;
      status: "running" | "completed" | "failed";
      text: string;
      outputVisibility?: "user" | "provisional";
      startedAt: string;
      completedAt?: string;
      durationMs?: number;
      usage?: TokenUsageData;
    }
  | {
      id: string;
      kind: "tool";
      name: string;
      status: "running" | "completed" | "failed";
      arguments: string;
      output?: string;
      isError?: boolean;
      errorCode?: string;
      startedAt: string;
      completedAt?: string;
      durationMs?: number;
    };

/** Display-safe projection of one provider-neutral agent task. */
export interface AgentTaskData {
  id: string;
  /** Stable parent agent-thread ID; the root record has no parent. */
  parentId?: string;
  agentThreadId?: string;
  agentPath?: string;
  retryOf?: string;
  followUpOf?: string;
  closedAt?: string;
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
  messages?: readonly AgentTaskMessageData[];
  /** Ordered visible model/tool activity. Hidden provider reasoning is excluded. */
  transcript?: readonly AgentTaskTranscriptEntryData[];
}

export interface AgentTreeData {
  rootId: string;
  maxConcurrent: number;
  agents: readonly AgentTaskData[];
}

export type AgentRunStatusData =
  "active" | "completed" | "failed" | "interrupted";

/**
 * Queryable, display-safe projection of one persisted agent thread.
 *
 * Opaque provider state remains host-owned. Clients can see whether a
 * checkpoint exists without receiving provider-specific wire data.
 */
export interface AgentThreadData {
  id: string;
  agentThreadId: string;
  hostThreadId: string;
  turnId: string;
  rootId: string;
  maxConcurrent: number;
  runStatus: AgentRunStatusData;
  updatedAt: string;
  profileName?: string;
  agent: AgentTaskData;
  pendingInput: readonly string[];
  collected: boolean;
  closedAt?: string;
  interruption?: {
    previousStatus: "queued" | "running";
    interruptedAt: string;
    reason: string;
  };
  checkpoint?: {
    step: number;
    phase: "model_completed" | "tool_started" | "tool_completed";
    hasModelState: boolean;
  };
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
  modelRetry?: ModelRetryData;
  streamingText: string;
  metrics?: ActiveTurnMetricsData;
  /** Sources already cited by the currently streaming assistant output. */
  sources?: readonly MessageSourceData[];
  /** Inline citations anchored in `streamingText`. */
  citations?: readonly MessageCitationData[];
  progress: readonly ConversationProgressData[];
  plan?: AgentPlanData;
  agentTree?: AgentTreeData;
}

export interface ModelRetryData {
  retryAttempt: number;
  maxRetries: number;
  reason: "connection_lost";
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
  /** Absolute host-local path to a skill's entry file. */
  localPath?: string;
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

/** Conversation payload used by the interactive thread surface. */
export type ConversationDisplayMessageData = Omit<
  ConversationMessageData,
  "diagnostics"
>;

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

export type SuggestionLanguage = HostLanguage;

export type AgentEventData =
  | { type: "run.started"; runId: string }
  | { type: "model.started"; runId: string; step: number }
  | ({
      type: "model.retrying";
      runId: string;
      step: number;
    } & ModelRetryData)
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
      messages: readonly ConversationDisplayMessageData[];
      queuedTurns: readonly QueuedTurnData[];
      revision: number;
      activeTurn?: ActiveTurnData;
      /** Provider/model selected for this conversation, if any. */
      provider?: string;
      model?: string;
    };
  };
  "activity/read": {
    params: { threadId: string; activityId: string };
    result: { activity: ConversationActivityData };
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
    /** Omit threadId to list capabilities for a new-task draft. */
    params: { threadId?: string; refresh?: boolean };
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
  "agent/list": {
    params: { threadId: string; turnId?: string; includeRoot?: boolean };
    result: { agents: readonly AgentThreadData[] };
  };
  "agent/read": {
    params: { threadId: string; agentId: string };
    result: { agent: AgentThreadData };
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
  "activity/read",
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
  "agent/list",
  "agent/read",
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
      | "interrupted"
      | "followed_up"
      | "closed"
      | "steered"
      | "messaged";
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
