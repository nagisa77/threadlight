import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  ThreadlightHostsSnapshot,
  ThreadlightHostSummary,
} from "@threadlight/protocol";

export const LOCAL_HOST_ID = "local";

interface StoredRemoteHost {
  id: string;
  name: string;
  endpoint: string;
  lastConnectedAt: string;
}

interface StoredHosts {
  version: 1;
  activeHostId: string;
  hosts: StoredRemoteHost[];
}

const EMPTY_HOSTS: StoredHosts = {
  version: 1,
  activeHostId: LOCAL_HOST_ID,
  hosts: [],
};

export class HostStore {
  constructor(
    private readonly path: string,
    private readonly localName = "This Mac",
  ) {}

  snapshot(): ThreadlightHostsSnapshot {
    const stored = this.read();
    return {
      activeHostId: stored.activeHostId,
      hosts: [
        {
          id: LOCAL_HOST_ID,
          name: this.localName,
          kind: "local",
        },
        ...stored.hosts
          .slice()
          .sort((left, right) =>
            right.lastConnectedAt.localeCompare(left.lastConnectedAt),
          )
          .map(
            (host): ThreadlightHostSummary => ({
              id: host.id,
              name: host.name,
              kind: "remote",
              endpoint: host.endpoint,
            }),
          ),
      ],
    };
  }

  upsert(input: {
    id: string;
    name: string;
    endpoint: string;
  }): ThreadlightHostsSnapshot {
    if (!input.id.trim() || input.id === LOCAL_HOST_ID) {
      throw new Error("Remote host id is invalid.");
    }
    const stored = this.read();
    const existing = stored.hosts.find((host) => host.id === input.id);
    const next: StoredRemoteHost = {
      id: input.id,
      name: input.name.trim() || input.id,
      endpoint: input.endpoint,
      lastConnectedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, next);
    else stored.hosts.push(next);
    stored.activeHostId = input.id;
    this.write(stored);
    return this.snapshot();
  }

  update(input: {
    id: string;
    name: string;
    endpoint: string;
  }): ThreadlightHostsSnapshot {
    if (!input.id.trim() || input.id === LOCAL_HOST_ID) {
      throw new Error("Only a saved remote Host can be updated.");
    }
    const stored = this.read();
    const existing = stored.hosts.find((host) => host.id === input.id);
    if (!existing) {
      throw new Error(`Unknown Threadlight Host: ${input.id}`);
    }
    existing.name = input.name.trim() || input.id;
    existing.endpoint = input.endpoint;
    this.write(stored);
    return this.snapshot();
  }

  activate(hostId: string): ThreadlightHostsSnapshot {
    const stored = this.read();
    if (
      hostId !== LOCAL_HOST_ID &&
      !stored.hosts.some((host) => host.id === hostId)
    ) {
      throw new Error(`Unknown Threadlight Host: ${hostId}`);
    }
    stored.activeHostId = hostId;
    const remote = stored.hosts.find((host) => host.id === hostId);
    if (remote) remote.lastConnectedAt = new Date().toISOString();
    this.write(stored);
    return this.snapshot();
  }

  delete(hostId: string): ThreadlightHostsSnapshot {
    if (!hostId || hostId === LOCAL_HOST_ID) {
      throw new Error("The local Host cannot be removed.");
    }
    const stored = this.read();
    const nextHosts = stored.hosts.filter((host) => host.id !== hostId);
    if (nextHosts.length === stored.hosts.length) {
      throw new Error(`Unknown Threadlight Host: ${hostId}`);
    }
    stored.hosts = nextHosts;
    if (stored.activeHostId === hostId) {
      stored.activeHostId = LOCAL_HOST_ID;
    }
    this.write(stored);
    return this.snapshot();
  }

  remote(hostId: string): StoredRemoteHost | undefined {
    return this.read().hosts.find((host) => host.id === hostId);
  }

  private read(): StoredHosts {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isStoredHosts(parsed)) {
        throw new Error("Host connections file has an unsupported format.");
      }
      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return structuredClone(EMPTY_HOSTS);
      }
      throw error;
    }
  }

  private write(value: StoredHosts): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

function isStoredHosts(value: unknown): value is StoredHosts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  return (
    stored.version === 1 &&
    typeof stored.activeHostId === "string" &&
    Array.isArray(stored.hosts) &&
    stored.hosts.every(
      (host) =>
        !!host &&
        typeof host === "object" &&
        !Array.isArray(host) &&
        typeof (host as Record<string, unknown>).id === "string" &&
        typeof (host as Record<string, unknown>).name === "string" &&
        typeof (host as Record<string, unknown>).endpoint === "string" &&
        typeof (host as Record<string, unknown>).lastConnectedAt === "string",
    )
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
