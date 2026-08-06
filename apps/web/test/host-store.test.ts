import { describe, expect, it } from "vitest";

import {
  HOST_STORAGE_KEY,
  LEGACY_ENDPOINT_KEY,
  LEGACY_TOKEN_KEY,
  MAX_HOST_RECORDS,
  hostNameForEndpoint,
  loadHostRecords,
  migrateLegacyHostRecord,
  normalizeEndpoint,
  removeHostRecord,
  saveHostRecords,
  upsertHostRecord,
  type HostRecord,
} from "../src/host-store.js";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function record(partial: Partial<HostRecord>): HostRecord {
  return {
    id: "host-a",
    name: "Prod",
    endpoint: "https://prod.example.com",
    token: "token-a",
    lastConnectedAt: 1,
    ...partial,
  };
}

describe("host record storage", () => {
  it("upserts a new record to the front with a generated id", () => {
    const next = upsertHostRecord([], {
      name: "Prod",
      endpoint: "https://prod.example.com/",
      token: "token-a",
    });
    expect(next).toHaveLength(1);
    expect(next[0]!.endpoint).toBe("https://prod.example.com");
    expect(next[0]!.id).toBeTruthy();
    expect(next[0]!.lastConnectedAt).toBeGreaterThan(0);
  });

  it("updates an existing record when the endpoint matches, keeping its id", () => {
    const existing = record({ id: "fixed-id" });
    const next = upsertHostRecord([existing], {
      id: "unrelated",
      name: "Renamed",
      endpoint: "https://prod.example.com/",
      token: "token-b",
    });
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("fixed-id");
    expect(next[0]!.name).toBe("Renamed");
    expect(next[0]!.token).toBe("token-b");
  });

  it("updates by explicit id even when the endpoint changed", () => {
    const existing = record({ id: "fixed-id" });
    const next = upsertHostRecord([existing], {
      id: "fixed-id",
      name: "Prod 2",
      endpoint: "https://prod2.example.com",
      token: "token-c",
    });
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("fixed-id");
    expect(next[0]!.endpoint).toBe("https://prod2.example.com");
  });

  it("removes a record by id", () => {
    const records = [
      record({ id: "a" }),
      record({ id: "b", endpoint: "https://dev.example.com" }),
    ];
    const next = removeHostRecord(records, "a");
    expect(next.map((host) => host.id)).toEqual(["b"]);
  });

  it("round-trips through save and load", () => {
    const storage = new MemoryStorage();
    const records = [
      record({ id: "a", lastConnectedAt: 2 }),
      record({
        id: "b",
        name: "",
        endpoint: "https://dev.example.com",
        token: "token-b",
        lastConnectedAt: 1,
      }),
    ];
    saveHostRecords(records, storage);

    const loaded = loadHostRecords(storage);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.id).toBe("a");
    expect(loaded[0]!.name).toBe("Prod");
    // Empty names fall back to the hostname.
    expect(loaded[1]!.name).toBe("dev.example.com");
  });

  it("returns an empty list for corrupt or non-array storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(HOST_STORAGE_KEY,
  LEGACY_ENDPOINT_KEY,
  LEGACY_TOKEN_KEY, "{not json");
    expect(loadHostRecords(storage)).toEqual([]);

    storage.setItem(HOST_STORAGE_KEY,
  LEGACY_ENDPOINT_KEY,
  LEGACY_TOKEN_KEY, JSON.stringify({ id: "x" }));
    expect(loadHostRecords(storage)).toEqual([]);
  });

  it("caps the number of kept records", () => {
    let records: HostRecord[] = [];
    for (let index = 0; index < MAX_HOST_RECORDS + 5; index += 1) {
      records = upsertHostRecord(records, {
        name: `Host ${index}`,
        endpoint: `https://host-${index}.example.com`,
        token: `token-${index}`,
      });
    }
    expect(records).toHaveLength(MAX_HOST_RECORDS);
    expect(records[0]!.endpoint).toBe(
      `https://host-${MAX_HOST_RECORDS + 4}.example.com`,
    );
  });

  it("derives display names and normalizes endpoints", () => {
    expect(hostNameForEndpoint("https://host.example.com/threads")).toBe(
      "host.example.com",
    );
    expect(hostNameForEndpoint("http://127.0.0.1:7432")).toBe(
      "127.0.0.1:7432",
    );
    expect(hostNameForEndpoint("host.example.com")).toBe("host.example.com");
    expect(normalizeEndpoint("  https://a.example.com///  ")).toBe(
      "https://a.example.com",
    );
  });
  it("migrates legacy endpoint/token keys into a saved-host record and clears them", () => {
    const storage = new MemoryStorage();
    const tokenStorage = new MemoryStorage();
    storage.setItem(LEGACY_ENDPOINT_KEY, "https://legacy.example.com/");
    tokenStorage.setItem(LEGACY_TOKEN_KEY, "legacy-token");

    const migrated = migrateLegacyHostRecord(storage, tokenStorage);
    expect(migrated).toBeDefined();
    expect(migrated!.endpoint).toBe("https://legacy.example.com");
    expect(migrated!.token).toBe("legacy-token");
    expect(migrated!.name).toBe("legacy.example.com");
    // The migrated record is persisted and the legacy keys are removed.
    expect(loadHostRecords(storage)).toEqual([migrated]);
    expect(storage.getItem(LEGACY_ENDPOINT_KEY)).toBeNull();
    expect(tokenStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it("does not migrate when there is no legacy endpoint", () => {
    const storage = new MemoryStorage();
    const tokenStorage = new MemoryStorage();
    expect(migrateLegacyHostRecord(storage, tokenStorage)).toBeUndefined();
    expect(loadHostRecords(storage)).toEqual([]);
  });
});

