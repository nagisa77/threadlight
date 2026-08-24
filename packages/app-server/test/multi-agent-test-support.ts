import type { AgentTreeData, JsonRpcOutgoing } from "@threadlight/protocol";

export function result<T>(messages: readonly JsonRpcOutgoing[], id: number): T {
  const message = messages.find(
    (candidate) => "id" in candidate && candidate.id === id,
  );
  if (!message || !("result" in message)) throw new Error(`Missing RPC ${id}`);
  return message.result as T;
}

export function latestTree(
  messages: readonly JsonRpcOutgoing[],
): AgentTreeData {
  const notification = [...messages]
    .reverse()
    .find(
      (message) =>
        "method" in message && message.method === "agent/tree-updated",
    );
  if (!notification || !("params" in notification)) {
    throw new Error("Missing agent tree notification");
  }
  return (notification.params as { tree: AgentTreeData }).tree;
}
