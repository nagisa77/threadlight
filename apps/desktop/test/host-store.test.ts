import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HostStore,
  LOCAL_HOST_ID,
} from "../src/main/host-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("HostStore", () => {
  it("keeps local as a first-class host and switches back from remote", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-host-store-"));
    directories.push(root);
    const path = join(root, "hosts.json");
    const store = new HostStore(path, "Tim's Mac");

    expect(store.snapshot()).toEqual({
      activeHostId: LOCAL_HOST_ID,
      hosts: [
        {
          id: LOCAL_HOST_ID,
          name: "Tim's Mac",
          kind: "local",
        },
      ],
    });

    store.upsert({
      id: "build-host",
      name: "Build Host",
      endpoint: "http://127.0.0.1:7432",
    });
    expect(store.snapshot()).toMatchObject({
      activeHostId: "build-host",
      hosts: [
        { id: LOCAL_HOST_ID, kind: "local" },
        {
          id: "build-host",
          kind: "remote",
          endpoint: "http://127.0.0.1:7432",
        },
      ],
    });

    expect(store.activate(LOCAL_HOST_ID).activeHostId).toBe(LOCAL_HOST_ID);
    expect(new HostStore(path).snapshot().activeHostId).toBe(LOCAL_HOST_ID);
  });

  it("removes a remote host and falls back to local when it was active", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-host-store-"));
    directories.push(root);
    const store = new HostStore(join(root, "hosts.json"), "This Mac");
    store.upsert({
      id: "build-host",
      name: "Build Host",
      endpoint: "http://127.0.0.1:7432",
    });

    expect(store.delete("build-host")).toEqual({
      activeHostId: LOCAL_HOST_ID,
      hosts: [
        {
          id: LOCAL_HOST_ID,
          name: "This Mac",
          kind: "local",
        },
      ],
    });
    expect(() => store.delete(LOCAL_HOST_ID)).toThrow(
      "local Host cannot be removed",
    );
  });

  it("updates a saved remote host without activating it", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-host-store-"));
    directories.push(root);
    const store = new HostStore(join(root, "hosts.json"), "This Mac");
    store.upsert({
      id: "build-host",
      name: "Build Host",
      endpoint: "http://127.0.0.1:7432",
    });
    store.activate(LOCAL_HOST_ID);

    const snapshot = store.update({
      id: "build-host",
      name: "CI Host",
      endpoint: "https://host.example.test",
    });

    expect(snapshot.activeHostId).toBe(LOCAL_HOST_ID);
    expect(snapshot.hosts).toContainEqual({
      id: "build-host",
      name: "CI Host",
      kind: "remote",
      endpoint: "https://host.example.test",
    });
    expect(() =>
      store.update({
        id: LOCAL_HOST_ID,
        name: "Renamed Mac",
        endpoint: "http://127.0.0.1",
      }),
    ).toThrow("saved remote Host");
  });
});
