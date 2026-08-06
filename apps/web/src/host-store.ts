export interface HostRecord {
  id: string;
  name: string;
  endpoint: string;
  token: string;
  lastConnectedAt: number;
}

export interface HostRecordInput {
  id?: string;
  name: string;
  endpoint: string;
  token: string;
}

export const HOST_STORAGE_KEY = "threadlight:web:saved-hosts";
export const LEGACY_ENDPOINT_KEY = "threadlight:web:host-endpoint";
export const LEGACY_TOKEN_KEY = "threadlight:web:host-token";
export const MAX_HOST_RECORDS = 12;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export function hostNameForEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.host) return parsed.host;
  } catch {
    // Fall through to the raw value below.
  }
  return trimmed.replace(/^https?:\/\//i, "");
}

export function createHostId(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the timestamp-based id below.
  }
  return `host-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function loadHostRecords(storage: StorageLike): HostRecord[] {
  try {
    const raw = storage.getItem(HOST_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: HostRecord[] = [];
    for (const entry of parsed) {
      if (!isHostRecord(entry)) continue;
      const endpoint = normalizeEndpoint(entry.endpoint);
      if (!endpoint) continue;
      records.push({
        id: entry.id,
        name: entry.name || hostNameForEndpoint(endpoint),
        endpoint,
        token: entry.token,
        lastConnectedAt: Number.isFinite(entry.lastConnectedAt)
          ? entry.lastConnectedAt
          : 0,
      });
    }
    records.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt);
    return records.slice(0, MAX_HOST_RECORDS);
  } catch {
    return [];
  }
}

export function saveHostRecords(
  records: HostRecord[],
  storage: StorageLike,
): void {
  try {
    storage.setItem(
      HOST_STORAGE_KEY,
      JSON.stringify(records.slice(0, MAX_HOST_RECORDS)),
    );
  } catch {
    // Storage can be unavailable in private or locked-down browsing modes.
  }
}

/**
 * Migrates the pre-multi-host storage layout (`threadlight:web:host-endpoint`
 * in localStorage plus `threadlight:web:host-token` in sessionStorage) into a
 * single saved-host record. Returns the migrated record, or undefined when
 * there is nothing to migrate. Legacy keys are removed after a successful
 * migration.
 */
export function migrateLegacyHostRecord(
  storage: StorageLike,
  tokenStorage: StorageLike,
): HostRecord | undefined {
  try {
    const endpoint = storage.getItem(LEGACY_ENDPOINT_KEY);
    if (!endpoint) return undefined;
    const record: HostRecord = {
      id: createHostId(),
      name: hostNameForEndpoint(endpoint),
      endpoint: normalizeEndpoint(endpoint),
      token: tokenStorage.getItem(LEGACY_TOKEN_KEY) ?? "",
      lastConnectedAt: Date.now(),
    };
    saveHostRecords([record], storage);
    storage.removeItem(LEGACY_ENDPOINT_KEY);
    tokenStorage.removeItem(LEGACY_TOKEN_KEY);
    return record;
  } catch {
    return undefined;
  }
}

export function upsertHostRecord(
  records: HostRecord[],
  input: HostRecordInput & { lastConnectedAt?: number },
): HostRecord[] {
  const endpoint = normalizeEndpoint(input.endpoint);
  if (!endpoint) return records;
  const existingIndex = records.findIndex(
    (host) =>
      (input.id !== undefined && host.id === input.id) ||
      normalizeEndpoint(host.endpoint).toLowerCase() ===
        endpoint.toLowerCase(),
  );
  const next: HostRecord = {
    id:
      existingIndex >= 0
        ? records[existingIndex]!.id
        : input.id ?? createHostId(),
    name: input.name.trim() || hostNameForEndpoint(endpoint),
    endpoint,
    token: input.token,
    lastConnectedAt: input.lastConnectedAt ?? Date.now(),
  };
  const rest =
    existingIndex >= 0
      ? records.filter((_, index) => index !== existingIndex)
      : records;
  return [next, ...rest].slice(0, MAX_HOST_RECORDS);
}

export function removeHostRecord(
  records: HostRecord[],
  id: string,
): HostRecord[] {
  return records.filter((host) => host.id !== id);
}

export function mostRecentHost(
  records: HostRecord[],
): HostRecord | undefined {
  return records[0];
}

function isHostRecord(value: unknown): value is HostRecord {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.endpoint === "string" &&
    typeof entry.token === "string"
  );
}
