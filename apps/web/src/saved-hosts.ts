/**
 * Saved remote Host history for the web client.
 *
 * Previously connected Hosts (endpoint plus the last-used token) are persisted
 * in localStorage so the connection page can prefill credentials and offer
 * one-click reconnects after a logout or a page reload. Logout never clears a
 * saved Host or its token; deleting a Host in the connection page is the
 * explicit way to forget it.
 *
 * All helpers take an injected storage so they can be unit-tested without a
 * browser environment.
 */

export interface SavedHost {
  id: string;
  /** Optional display label; falls back to the endpoint when empty. */
  name: string;
  endpoint: string;
  /** Last token used for this Host, kept across logout for quick reconnects. */
  token: string;
  lastConnectedAt: number;
}

export const HOSTS_STORAGE_KEY = "threadlight:web:hosts";
export const LEGACY_ENDPOINT_STORAGE_KEY = "threadlight:web:host-endpoint";
export const LEGACY_TOKEN_STORAGE_KEY = "threadlight:web:host-token";
export const MAX_SAVED_HOSTS = 20;

export interface HostStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Unique id for a saved Host, preferring the Web Crypto UUID when available. */
export function createHostId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reads the saved Host list, migrating the legacy single-endpoint keys
 * (threadlight:web:host-endpoint / threadlight:web:host-token) the first time
 * they are the only source of truth.
 */
export function loadSavedHosts(storage: HostStorage): SavedHost[] {
  const hosts = parseHosts(storage.getItem(HOSTS_STORAGE_KEY));
  if (hosts.length > 0) return hosts;

  const legacyEndpoint = storage.getItem(LEGACY_ENDPOINT_STORAGE_KEY)?.trim();
  if (!legacyEndpoint) return [];

  const migrated: SavedHost[] = [
    {
      id: createHostId(),
      name: "",
      endpoint: legacyEndpoint,
      token: storage.getItem(LEGACY_TOKEN_STORAGE_KEY) ?? "",
      lastConnectedAt: 0,
    },
  ];
  persistSavedHosts(storage, migrated);
  try {
    storage.removeItem(LEGACY_ENDPOINT_STORAGE_KEY);
    storage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or locked-down browsing modes.
  }
  return migrated;
}

/** Persists the list; storage failures are ignored (session still works). */
export function persistSavedHosts(storage: HostStorage, hosts: SavedHost[]): void {
  try {
    storage.setItem(HOSTS_STORAGE_KEY, JSON.stringify(hosts));
  } catch {
    // Storage can be unavailable in private or locked-down browsing modes.
  }
}

/**
 * Adds or refreshes the Host matching `endpoint` (exact match after trimming),
 * moves it to the front, and caps the list. Re-connecting to a known endpoint
 * keeps the existing record id so edits and the selector stay stable.
 */
export function upsertSavedHost(
  hosts: SavedHost[],
  input: { name?: string; endpoint: string; token: string },
  now: number = Date.now(),
): SavedHost[] {
  const endpoint = input.endpoint.trim();
  const existing = hosts.find((host) => host.endpoint === endpoint);
  const record: SavedHost = {
    id: existing?.id ?? createHostId(),
    name: typeof input.name === "string" ? input.name.trim() : existing?.name ?? "",
    endpoint,
    token: input.token,
    lastConnectedAt: now,
  };
  return [record, ...hosts.filter((host) => host.endpoint !== endpoint)].slice(
    0,
    MAX_SAVED_HOSTS,
  );
}

/**
 * Edits the Host with `id`. An edited endpoint that collides with another
 * saved Host drops the other record so the list stays unique per endpoint.
 */
export function updateSavedHost(
  hosts: SavedHost[],
  id: string,
  input: { name?: string; endpoint: string; token: string },
  now: number = Date.now(),
): SavedHost[] {
  const target = hosts.find((host) => host.id === id);
  if (!target) return hosts;

  const endpoint = input.endpoint.trim();
  const others = hosts.filter((host) => host.id !== id);
  const duplicate = others.find((host) => host.endpoint === endpoint);
  const record: SavedHost = {
    id,
    name: typeof input.name === "string" ? input.name.trim() : target.name,
    endpoint,
    token: input.token,
    lastConnectedAt: Math.max(target.lastConnectedAt, now),
  };
  return [
    record,
    ...others.filter((host) => host.id !== duplicate?.id),
  ].slice(0, MAX_SAVED_HOSTS);
}

/** Removes the Host with `id`, forgetting its endpoint and token. */
export function deleteSavedHost(hosts: SavedHost[], id: string): SavedHost[] {
  return hosts.filter((host) => host.id !== id);
}

function parseHosts(raw: string | null): SavedHost[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const hosts: SavedHost[] = [];
  const seenEndpoints = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
    if (!endpoint || seenEndpoints.has(endpoint)) continue;
    seenEndpoints.add(endpoint);
    hosts.push({
      id:
        typeof record.id === "string" && record.id.length > 0
          ? record.id
          : createHostId(),
      name: typeof record.name === "string" ? record.name : "",
      endpoint,
      token: typeof record.token === "string" ? record.token : "",
      lastConnectedAt:
        typeof record.lastConnectedAt === "number" ? record.lastConnectedAt : 0,
    });
  }
  return hosts;
}
