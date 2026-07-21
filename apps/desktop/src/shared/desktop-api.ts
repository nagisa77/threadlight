import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

export const DESKTOP_REQUEST_CHANNEL = "threadlight:request";
export const DESKTOP_MESSAGE_CHANNEL = "threadlight:message";

export interface DesktopApi {
  send(message: JsonRpcRequest): void;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
}
