export type {
  AttachmentData,
  ConversationActivityData,
  ConversationMessageData,
  ConversationProgressData,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcOutgoing,
  JsonRpcRequest,
  JsonRpcResponse,
  ProcessSnapshotData,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
} from "@threadlight/protocol";

import type { JsonRpcOutgoing } from "@threadlight/protocol";

export type SendMessage = (message: JsonRpcOutgoing) => void;
