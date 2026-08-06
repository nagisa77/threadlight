import { describe, expect, it } from "vitest";

import {
  createHostId,
  deleteSavedHost,
  HOSTS_STORAGE_KEY,
  LEGACY_ENDPOINT_STORAGE_KEY,
  LEGACY_TOKEN_STORAGE_KEY,
  loadSavedHosts,
  MAX_SAVED_HOSTS,
  persistSavedHosts,
  type HostStorage,
  type SavedHost,
  updateSavedHost,
  upsertSavedHost,
} from "../src/saved-hosts.js";

function memoryStorage(
  initial: Record<string, string> = {},
): { storage: HostStorage; data: Record<string, string> } {
  const data = { ...initial };
  return {
    storage: {
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => {
        data[key] = value;
      },
      removeItem: (key) => {
        delete data[key];
      },
    },
    data,
  };
}

function host(overrides: Partial<SavedHost> & { endpoint: string }): SavedHost {
  return {
    id: `id-${overrides.endpoint}`,
    name: "",
    token: "",
    lastConnectedAt: 0,
    ...overrides,
  };
}

describe("createHostId", () => {
  it("returns a non-empty string and unique values", () => {
    const ids = new Set([createHostId(), createHostId(), createHostId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

describe("loadSavedHosts", () => {
  it("returns [] for empty storage", () => {
    const { storage } = memoryStorage();
    expect(loadSavedHosts(storage)).toEqual([]);
  });

  it("ignores corrupted JSON and non-array payloads", () => {
    const { storage } = memoryStorage({ [HOSTS_STORAGE_KEY]: "{oops" });
    expect(loadSavedHosts(storage)).toEqual([]);
    const { storage: storage2 } = memoryStorage({
      [HOSTS_STORAGE_KEY]: JSON.stringify({ endpoint: "nope" }),
    });
    expect(loadSavedHosts(storage2)).toEqual([]);
  });

  it("parses valid entries, skips invalid ones, and dedupes by endpoint", () => {
    const { storage } = memoryStorage({
      [HOSTS_STORAGE_KEY]: JSON.stringify([
        { id: "a", name: "A", endpoint: " https://a.example.com ", token: "t1", lastConnectedAt: 5 },
        { id: "b", endpoint: "https://b.example.com" },
        { endpoint: "" },
        { id: "c", name: "C", endpoint: "https://a.example.com", token: "dup" },
        "garbage",
      ]),
    });
    const hosts = loadSavedHosts(storage);
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toMatchObject({
      id: "a",
      name: "A",
      endpoint: "https://a.example.com",
      token: "t1",
      lastConnectedAt: 5,
    });
    expect(hosts[1]).toMatchObject({
      id: "b",
      endpoint: "https://b.example.com",
      token: "",
      lastConnectedAt: 0,
    });
  });

  it("migrates legacy single-endpoint keys into the list and removes them", () => {
    const { storage, data } = memoryStorage({
      [LEGACY_ENDPOINT_STORAGE_KEY]: "  https://old.example.com  ",
      [LEGACY_TOKEN_STORAGE_KEY]: "legacy-token",
    });
    const hosts = loadSavedHosts(storage);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      endpoint: "https://old.example.com",
      token: "legacy-token",
    });
    expect(data[HOSTS_STORAGE_KEY]).toContain("https://old.example.com");
    expect(data[LEGACY_ENDPOINT_STORAGE_KEY]).toBeUndefined();
    expect(data[LEGACY_TOKEN_STORAGE_KEY]).toBeUndefined();
  });

  it("prefers the hosts list over legacy keys", () => {
    const { storage } = memoryStorage({
      [HOSTS_STORAGE_KEY]: JSON.stringify([
        host({ id: "x", endpoint: "https://x.example.com" }),
      ]),
      [LEGACY_ENDPOINT_STORAGE_KEY]: "https://old.example.com",
    });
    const hosts = loadSavedHosts(storage);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].endpoint).toBe("https://x.example.com");
  });
});

describe("persistSavedHosts", () => {
  it("writes the JSON list", () => {
    const { storage, data } = memoryStorage();
    const hosts = [host({ id: "a", endpoint: "https://a.example.com", token: "t" })];
    persistSavedHosts(storage, hosts);
    expect(JSON.parse(data[HOSTS_STORAGE_KEY])).toEqual(hosts);
  });

  it("does not throw when storage is unavailable", () => {
    const failing: HostStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(() => persistSavedHosts(failing, [])).not.toThrow();
  });
});

describe("upsertSavedHost", () => {
  it("adds a new host at the front with a generated id", () => {
    const existing = [host({ id: "a", endpoint: "https://a.example.com" })];
    const next = upsertSavedHost(existing, {
      endpoint: "  https://b.example.com  ",
      token: "tb",
    });
    expect(next).toHaveLength(2);
    expect(next[0].endpoint).toBe("https://b.example.com");
    expect(next[0].token).toBe("tb");
    expect(next[0].id).toMatch(/^host-|^[0-9a-f-]{8}/);
    expect(next[1].id).toBe("a");
  });

  it("updates an existing endpoint in place and moves it to the front", () => {
    const existing = [
      host({ id: "b", endpoint: "https://b.example.com" }),
      host({ id: "a", endpoint: "https://a.example.com", token: "old" }),
    ];
    const next = upsertSavedHost(existing, {
      name: "Alpha",
      endpoint: "https://a.example.com",
      token: "new",
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: "a", name: "Alpha", token: "new" });
    expect(next[1].id).toBe("b");
  });

  it("caps the list at MAX_SAVED_HOSTS", () => {
    let hosts: SavedHost[] = [];
    for (let i = 0; i < MAX_SAVED_HOSTS + 5; i += 1) {
      hosts = upsertSavedHost(hosts, {
        endpoint: `https://h${i}.example.com`,
        token: `t${i}`,
      });
    }
    expect(hosts).toHaveLength(MAX_SAVED_HOSTS);
    expect(hosts[0].endpoint).toBe(`https://h${MAX_SAVED_HOSTS + 4}.example.com`);
  });
});

describe("updateSavedHost", () => {
  it("updates fields by id and keeps lastConnectedAt", () => {
    const existing = [
      host({ id: "a", endpoint: "https://a.example.com", lastConnectedAt: 10 }),
      host({ id: "b", endpoint: "https://b.example.com" }),
    ];
    const next = updateSavedHost(
      existing,
      "a",
      {
        name: "Renamed",
        endpoint: "https://a.example.com",
        token: "rotated",
      },
      1,
    );
    expect(next[0]).toMatchObject({
      id: "a",
      name: "Renamed",
      token: "rotated",
      lastConnectedAt: 10,
    });
    expect(next[1].id).toBe("b");
  });

  it("clears the name when an empty string is submitted", () => {
    const existing = [
      host({ id: "a", name: "Old", endpoint: "https://a.example.com" }),
    ];
    const next = updateSavedHost(existing, "a", {
      name: "  ",
      endpoint: "https://a.example.com",
      token: "t",
    });
    expect(next[0].name).toBe("");
  });

  it("drops the colliding host when the endpoint changes onto another record", () => {
    const existing = [
      host({ id: "a", endpoint: "https://a.example.com" }),
      host({ id: "b", endpoint: "https://b.example.com" }),
    ];
    const next = updateSavedHost(existing, "b", {
      endpoint: "https://a.example.com",
      token: "tb",
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: "b", endpoint: "https://a.example.com" });
  });

  it("returns the list unchanged for an unknown id", () => {
    const existing = [host({ id: "a", endpoint: "https://a.example.com" })];
    const next = updateSavedHost(existing, "nope", {
      endpoint: "https://z.example.com",
      token: "t",
    });
    expect(next).toBe(existing);
  });
});

describe("deleteSavedHost", () => {
  it("removes the host with the given id", () => {
    const existing = [
      host({ id: "a", endpoint: "https://a.example.com" }),
      host({ id: "b", endpoint: "https://b.example.com" }),
    ];
    const next = deleteSavedHost(existing, "a");
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("b");
  });
});
