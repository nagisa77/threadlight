import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SecretCodec } from "@threadlight/host-core";
import type {
  DesktopConnectionRequest,
} from "@threadlight/protocol";

type ConnectionField =
  | "clientInformation"
  | "tokens"
  | "codeVerifier"
  | "discoveryState";

interface ConnectionPayload {
  clientInformation?: unknown;
  tokens?: unknown;
  codeVerifier?: unknown;
  discoveryState?: unknown;
}

interface StoredConnection {
  version: string;
  encryptedPayload: string;
}

interface StoredConnections {
  version: 1;
  connections: Record<string, StoredConnection>;
}

interface AuthorizationWaiter {
  resolve(code: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const EMPTY_CONNECTIONS: StoredConnections = {
  version: 1,
  connections: {},
};
const MAX_AUTHORIZATION_WAIT_MS = 10 * 60 * 1_000;

export interface HostConnectionSnapshot {
  id: string;
  version: string;
  configured: boolean;
  authorized: boolean;
}

export interface HostOAuthCallback {
  connectorId: string;
  code?: string;
  error?: string;
  state: string;
}

export class HostConnectionStore {
  private readonly pendingStates = new Map<string, string>();
  private readonly authorizationCodes = new Map<string, string>();
  private readonly authorizationWaiters =
    new Map<string, AuthorizationWaiter>();

  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  status(connectorId: string, version: string): HostConnectionSnapshot {
    validateConnector(connectorId, version);
    const connection = this.read().connections[connectorId];
    if (!connection || connection.version !== version) {
      return {
        id: connectorId,
        version,
        configured: false,
        authorized: false,
      };
    }
    const payload = this.decrypt(connection.encryptedPayload);
    return {
      id: connectorId,
      version,
      configured: hasClientCredentials(payload.clientInformation),
      authorized: Boolean(payload.tokens),
    };
  }

  configure(
    connectorId: string,
    version: string,
    clientId: string,
    clientSecret: string,
  ): void {
    validateConnector(connectorId, version);
    const stored = this.read();
    this.write({
      version: 1,
      connections: {
        ...stored.connections,
        [connectorId]: {
          version,
          encryptedPayload: this.codec.encrypt(
            JSON.stringify({
              clientInformation: {
                client_id: requireString(clientId, "clientId"),
                client_secret: requireString(
                  clientSecret,
                  "clientSecret",
                ),
              },
            }),
          ),
        },
      },
    });
    this.clearAuthorizationState(connectorId);
  }

  get(
    connectorId: string,
    version: string,
    field: ConnectionField,
  ): unknown {
    validateConnector(connectorId, version);
    const connection = this.read().connections[connectorId];
    if (!connection || connection.version !== version) return;
    return this.decrypt(connection.encryptedPayload)[field];
  }

  set(
    connectorId: string,
    version: string,
    field: ConnectionField,
    value: unknown,
  ): void {
    validateConnector(connectorId, version);
    assertSerializable(value);
    const stored = this.read();
    const current = stored.connections[connectorId];
    const payload =
      current?.version === version
        ? this.decrypt(current.encryptedPayload)
        : {};
    if (value === undefined) delete payload[field];
    else payload[field] = value;
    this.write({
      version: 1,
      connections: {
        ...stored.connections,
        [connectorId]: {
          version,
          encryptedPayload: this.codec.encrypt(JSON.stringify(payload)),
        },
      },
    });
  }

  invalidate(
    connectorId: string,
    version: string,
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    validateConnector(connectorId, version);
    const stored = this.read();
    const current = stored.connections[connectorId];
    if (!current || current.version !== version) return;
    if (scope === "all") {
      const { [connectorId]: _removed, ...connections } =
        stored.connections;
      this.write({ version: 1, connections });
      this.clearAuthorizationState(connectorId);
      return;
    }
    const field = {
      client: "clientInformation",
      tokens: "tokens",
      verifier: "codeVerifier",
      discovery: "discoveryState",
    }[scope] as ConnectionField;
    this.set(connectorId, version, field, undefined);
  }

  createState(connectorId: string, version: string): string {
    validateConnector(connectorId, version);
    const state = randomBytes(32).toString("base64url");
    this.pendingStates.set(connectorId, state);
    return state;
  }

  acceptAuthorizationCallback(callback: HostOAuthCallback): boolean {
    validateConnector(callback.connectorId, "callback");
    if (
      (!callback.code && !callback.error) ||
      !this.matchesPendingState(callback.connectorId, callback.state)
    ) {
      return false;
    }
    this.pendingStates.delete(callback.connectorId);
    const waiter = this.authorizationWaiters.get(callback.connectorId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.authorizationWaiters.delete(callback.connectorId);
      if (callback.code) waiter.resolve(callback.code);
      else {
        waiter.reject(
          new Error(`OAuth authorization failed: ${callback.error}`),
        );
      }
    } else if (callback.code) {
      this.authorizationCodes.set(
        callback.connectorId,
        callback.code,
      );
    }
    return true;
  }

  takeAuthorizationCode(
    connectorId: string,
    version: string,
  ): string | undefined {
    validateConnector(connectorId, version);
    const code = this.authorizationCodes.get(connectorId);
    this.authorizationCodes.delete(connectorId);
    return code;
  }

  waitForAuthorizationCode(
    connectorId: string,
    version: string,
    timeoutMs: number,
  ): Promise<string> {
    validateConnector(connectorId, version);
    const existing = this.takeAuthorizationCode(connectorId, version);
    if (existing) return Promise.resolve(existing);
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_AUTHORIZATION_WAIT_MS
    ) {
      throw new Error("Invalid OAuth authorization timeout");
    }
    const previous = this.authorizationWaiters.get(connectorId);
    if (previous) {
      clearTimeout(previous.timer);
      previous.reject(new Error("OAuth authorization was restarted"));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.authorizationWaiters.delete(connectorId);
        reject(new Error("OAuth authorization timed out"));
      }, timeoutMs);
      this.authorizationWaiters.set(connectorId, {
        resolve,
        reject,
        timer,
      });
    });
  }

  private matchesPendingState(
    connectorId: string,
    candidate: string,
  ): boolean {
    const expected = this.pendingStates.get(connectorId);
    if (!expected) return false;
    const expectedBytes = Buffer.from(expected);
    const candidateBytes = Buffer.from(candidate);
    return (
      expectedBytes.length === candidateBytes.length &&
      timingSafeEqual(expectedBytes, candidateBytes)
    );
  }

  private clearAuthorizationState(connectorId: string): void {
    this.pendingStates.delete(connectorId);
    this.authorizationCodes.delete(connectorId);
    const waiter = this.authorizationWaiters.get(connectorId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.authorizationWaiters.delete(connectorId);
    waiter.reject(new Error("OAuth authorization was cancelled"));
  }

  private decrypt(value: string): ConnectionPayload {
    const payload = JSON.parse(this.codec.decrypt(value)) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(
        "Connection store contains an invalid encrypted payload",
      );
    }
    return payload as ConnectionPayload;
  }

  private read(): StoredConnections {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isStoredConnections(value)) {
        throw new Error("Connection store has an unsupported format");
      }
      return value;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return EMPTY_CONNECTIONS;
      }
      throw error;
    }
  }

  private write(value: StoredConnections): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(value, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporaryPath, this.path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

export class HostConnectionService {
  constructor(
    private readonly store: HostConnectionStore,
    private readonly openAuthorization: (url: string) => void,
  ) {}

  async handle(request: DesktopConnectionRequest): Promise<unknown> {
    const params = parseParams(request.params);
    const connectorId = requireString(params.connectorId, "connectorId");
    const version = requireString(params.version, "version");
    switch (request.method) {
      case "connection/get":
        return this.store.get(
          connectorId,
          version,
          parseField(params.field),
        );
      case "connection/set":
        this.store.set(
          connectorId,
          version,
          parseField(params.field),
          params.value,
        );
        return { ok: true };
      case "connection/status":
        return this.store.status(connectorId, version);
      case "connection/configure":
        this.store.configure(
          connectorId,
          version,
          requireString(params.clientId, "clientId"),
          requireString(params.clientSecret, "clientSecret"),
        );
        return this.store.status(connectorId, version);
      case "connection/invalidate":
        this.store.invalidate(
          connectorId,
          version,
          parseScope(params.scope),
        );
        return { ok: true };
      case "connection/create-state":
        return { state: this.store.createState(connectorId, version) };
      case "connection/open-authorization": {
        const url = new URL(requireString(params.url, "url"));
        if (url.protocol !== "https:") {
          throw new Error("OAuth authorization URL must use HTTPS");
        }
        this.openAuthorization(url.toString());
        return { ok: true };
      }
      case "connection/take-code":
        return {
          code: this.store.takeAuthorizationCode(connectorId, version),
        };
      case "connection/wait-code":
        return {
          code: await this.store.waitForAuthorizationCode(
            connectorId,
            version,
            requirePositiveInteger(params.timeoutMs, "timeoutMs"),
          ),
        };
    }
  }
}

function parseParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid connection request");
  }
  return value as Record<string, unknown>;
}

function parseField(value: unknown): ConnectionField {
  if (
    value !== "clientInformation" &&
    value !== "tokens" &&
    value !== "codeVerifier" &&
    value !== "discoveryState"
  ) {
    throw new Error("Invalid connection field");
  }
  return value;
}

function parseScope(
  value: unknown,
): "all" | "client" | "tokens" | "verifier" | "discovery" {
  if (
    value !== "all" &&
    value !== "client" &&
    value !== "tokens" &&
    value !== "verifier" &&
    value !== "discovery"
  ) {
    throw new Error("Invalid connection invalidation scope");
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value as number;
}

function validateConnector(connectorId: string, version: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(connectorId)) {
    throw new Error("Invalid connector id");
  }
  if (!version.trim() || version.length > 128) {
    throw new Error("Invalid connector version");
  }
}

function hasClientCredentials(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.client_id === "string" &&
    Boolean(record.client_id) &&
    typeof record.client_secret === "string" &&
    Boolean(record.client_secret)
  );
}

function assertSerializable(value: unknown): void {
  if (value === undefined) return;
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > 1024 * 1024) {
    throw new Error("Connection value is not serializable");
  }
}

function isStoredConnections(value: unknown): value is StoredConnections {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const stored = value as Record<string, unknown>;
  if (
    stored.version !== 1 ||
    !stored.connections ||
    typeof stored.connections !== "object" ||
    Array.isArray(stored.connections)
  ) {
    return false;
  }
  return Object.values(
    stored.connections as Record<string, unknown>,
  ).every((connection) => {
    if (
      !connection ||
      typeof connection !== "object" ||
      Array.isArray(connection)
    ) {
      return false;
    }
    const record = connection as Record<string, unknown>;
    return (
      typeof record.version === "string" &&
      typeof record.encryptedPayload === "string"
    );
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
