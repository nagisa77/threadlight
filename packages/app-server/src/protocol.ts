export type {
  ActiveTurnData,
  AgentTaskData,
  AgentThreadData,
  AgentTreeData,
  AttachmentData,
  AgentPlanData,
  CapabilityDescriptor,
  CapabilityKind,
  ConnectorStatusData,
  ConversationAccessMode,
  ConversationActivityData,
  ConversationMessageData,
  ConversationProgressData,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcOutgoing,
  JsonRpcRequest,
  JsonRpcResponse,
  MessageCapabilityData,
  ProcessSnapshotData,
  QueuedTurnData,
  FollowUpDelivery,
  SuggestionLanguage,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
  TokenUsageData,
  TurnDiagnosticsData,
  TurnMode,
} from "@threadlight/protocol";

import type { JsonRpcOutgoing } from "@threadlight/protocol";

export type SendMessage = (message: JsonRpcOutgoing) => void;
