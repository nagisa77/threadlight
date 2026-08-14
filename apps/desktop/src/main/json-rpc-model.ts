import {
  THREADLIGHT_METHODS,
  type JsonRpcId,
  type JsonRpcRequest,
  type ThreadlightMethod,
} from "@threadlight/protocol";

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    typeof request.method === "string" &&
    THREADLIGHT_METHODS.includes(request.method as ThreadlightMethod)
  );
}

export function extractJsonRpcId(
  value: unknown,
): string | number | null | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const id = (value as Record<string, unknown>).id;
  if (id === null || typeof id === "string" || typeof id === "number") {
    return id;
  }
}

export function jsonRpcRequestKey(id: JsonRpcId): string {
  return `${id === null ? "null" : typeof id}:${String(id)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
