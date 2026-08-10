export type WebStartupPhase = "connection" | "restoring";

export interface WebStartupCredentials {
  endpoint: string;
  token: string;
}

export function initialWebStartupPhase(
  credentials: WebStartupCredentials,
  sessionWasActive: boolean,
): WebStartupPhase {
  return sessionWasActive && credentials.endpoint && credentials.token
    ? "restoring"
    : "connection";
}

export function configuredHostEndpoint(
  configured: string | undefined,
  pageOrigin: string,
): string {
  const value = configured?.trim() ?? "";
  return value === "self" ? pageOrigin.replace(/\/+$/, "") : value;
}
