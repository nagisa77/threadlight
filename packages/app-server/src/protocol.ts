export type {
  AttachmentData,
  AgentPlanData,
  CapabilityDescriptor,
  CapabilityKind,
  ConnectorStatusData,
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
  SuggestionLanguage,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
  TurnMode,
} from "@threadlight/protocol";

import type { JsonRpcOutgoing } from "@threadlight/protocol";

export type SendMessage = (message: JsonRpcOutgoing) => void;
