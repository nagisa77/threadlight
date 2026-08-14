import type { Translate } from "../../i18n.js";

export type ConnectionStatus = "connecting" | "ready" | "error";

export function shortId(id?: string): string {
  return id ? id.slice(0, 8) : "—";
}

export function connectionLabel(
  connection: ConnectionStatus,
  t: Translate,
): string {
  if (connection === "ready") return t("runtimeConnected");
  if (connection === "error") return t("runtimeOffline");
  return t("connectionConnecting");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
