import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  DesktopConnectionRequest,
} from "@threadlight/protocol";

import type { SecretCodec } from "./settings-store.js";

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

export interface ConnectionSnapshot {
  id: string;
  version: string;
  configured: boolean;
  authorized: boolean;
}

interface AuthorizationWaiter {
  resolve(code: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const OAUTH_CALLBACK_HOST = "127.0.0.1";
const OAUTH_CALLBACK_PORT = 43119;
const MAX_AUTHORIZATION_WAIT_MS = 10 * 60 * 1_000;

const EMPTY_CONNECTIONS: StoredConnections = {
  version: 1,
  connections: {},
};

export class ConnectionStore {
  private readonly pendingStates = new Map<string, string>();
  private readonly authorizationCodes = new Map<string, string>();
  private readonly authorizationWaiters =
    new Map<string, AuthorizationWaiter>();

  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  snapshot(): readonly ConnectionSnapshot[] {
    const stored = this.read();
    return Object.entries(stored.connections).map(([id, connection]) => {
      const payload = this.decrypt(connection.encryptedPayload);
      return {
        id,
        version: connection.version,
        configured: hasClientCredentials(payload.clientInformation),
        authorized: Boolean(payload.tokens),
      };
    });
  }

  status(connectorId: string, version: string): ConnectionSnapshot {
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
    const normalizedClientId = requireString(clientId, "clientId");
    const normalizedClientSecret = requireString(
      clientSecret,
      "clientSecret",
    );
    this.write({
      version: 1,
      connections: {
        ...this.read().connections,
        [connectorId]: {
          version,
          encryptedPayload: this.codec.encrypt(
            JSON.stringify({
              clientInformation: {
                client_id: normalizedClientId,
                client_secret: normalizedClientSecret,
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
      const { [connectorId]: _removed, ...connections } = stored.connections;
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

  acceptAuthorizationCallback(url: URL): boolean {
    const isCustomProtocol =
      url.protocol === "threadlight:" && url.hostname === "oauth";
    const isLoopback =
      url.protocol === "http:" &&
      url.hostname === OAUTH_CALLBACK_HOST &&
      url.port === String(OAUTH_CALLBACK_PORT);
    if (!isCustomProtocol && !isLoopback) {
      return false;
    }
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const segments =
      isLoopback && pathSegments[0] === "oauth"
        ? pathSegments.slice(1)
        : pathSegments;
    if (segments[0] !== "callback" || !segments[1]) return false;
    const connectorId = decodeURIComponent(segments[1]);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const state = url.searchParams.get("state");
    if (
      (!code && !oauthError) ||
      !state ||
      !this.matchesPendingState(connectorId, state)
    ) {
      return false;
    }
    this.pendingStates.delete(connectorId);
    const waiter = this.authorizationWaiters.get(connectorId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.authorizationWaiters.delete(connectorId);
      if (code) waiter.resolve(code);
      else waiter.reject(new Error(`OAuth authorization failed: ${oauthError}`));
    } else if (code) {
      this.authorizationCodes.set(connectorId, code);
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
      this.authorizationWaiters.delete(connectorId);
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

  private matchesPendingState(connectorId: string, candidate: string): boolean {
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
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("OAuth authorization was cancelled"));
      this.authorizationWaiters.delete(connectorId);
    }
  }

  private decrypt(value: string): ConnectionPayload {
    const parsed = JSON.parse(this.codec.decrypt(value)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Connection store contains an invalid encrypted payload");
    }
    return parsed as ConnectionPayload;
  }

  private read(): StoredConnections {
    let source: string;
    try {
      source = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return EMPTY_CONNECTIONS;
      }
      throw error;
    }
    const value = JSON.parse(source) as unknown;
    if (!isStoredConnections(value)) {
      throw new Error("Connection store has an unsupported format");
    }
    return value;
  }

  private write(value: StoredConnections): void {
    mkdirSync(dirname(this.path), { recursive: true });
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

export class DesktopConnectionService {
  private callbackServer?: Server;

  constructor(
    private readonly store: ConnectionStore,
    private readonly openExternal: (url: string) => Promise<unknown>,
    private readonly authorizationCompleted: () => void = () => undefined,
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
        return {
          state: this.store.createState(connectorId, version),
        };
      case "connection/open-authorization": {
        const url = new URL(requireString(params.url, "url"));
        if (url.protocol !== "https:") {
          throw new Error("OAuth authorization URL must use HTTPS");
        }
        await this.ensureCallbackServer();
        await this.openExternal(url.toString());
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

  async dispose(): Promise<void> {
    const server = this.callbackServer;
    this.callbackServer = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async ensureCallbackServer(): Promise<void> {
    if (this.callbackServer?.listening) return;
    const server = createServer((request, response) => {
      try {
        const url = new URL(
          request.url ?? "/",
          `http://${OAUTH_CALLBACK_HOST}:${OAUTH_CALLBACK_PORT}`,
        );
        const accepted = this.store.acceptAuthorizationCallback(url);
        const authorized =
          accepted && Boolean(url.searchParams.get("code"));
        if (accepted) this.authorizationCompleted();
        response.writeHead(authorized ? 200 : 400, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(
          authorized
            ? oauthResultPage(
                "Connection complete",
                "You can close this window and return to Threadlight.",
              )
            : accepted
              ? oauthResultPage(
                  "Authorization cancelled",
                  "No connection was created. Return to Threadlight to try again.",
                )
            : oauthResultPage(
                "Connection failed",
                "The authorization response was invalid or expired.",
              ),
        );
      } catch {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end("Invalid OAuth callback");
      }
    });
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        OAUTH_CALLBACK_PORT,
        OAUTH_CALLBACK_HOST,
        () => {
          server.off("error", reject);
          resolve();
        },
      );
    });
    this.callbackServer = server;
  }
}

export function oauthRedirectUrl(connectorId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(connectorId)) {
    throw new Error("Invalid connector id");
  }
  return `http://${OAUTH_CALLBACK_HOST}:${OAUTH_CALLBACK_PORT}/oauth/callback/${encodeURIComponent(connectorId)}`;
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
  if (typeof value !== "string" || !value.trim()) {
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

function hasClientCredentials(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const client = value as Record<string, unknown>;
  return (
    typeof client.client_id === "string" &&
    client.client_id.length > 0 &&
    typeof client.client_secret === "string" &&
    client.client_secret.length > 0
  );
}

function oauthResultPage(title: string, message: string): string {
  return [
    "<!doctype html>",
    '<html lang="en"><meta charset="utf-8">',
    `<title>${title}</title>`,
    '<body style="font:16px system-ui;padding:48px;color:#222">',
    `<h1 style="font-size:22px">${title}</h1>`,
    `<p>${message}</p>`,
    "</body></html>",
  ].join("");
}

function validateConnector(connectorId: string, version: string): void {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(connectorId) ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
  ) {
    throw new Error("Invalid connector identity");
  }
}

function assertSerializable(value: unknown): void {
  if (value === undefined) return;
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > 1_000_000) {
    throw new Error("Connection value is not safely serializable");
  }
}

function isStoredConnections(value: unknown): value is StoredConnections {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  if (
    stored.version !== 1 ||
    !stored.connections ||
    typeof stored.connections !== "object" ||
    Array.isArray(stored.connections)
  ) {
    return false;
  }
  return Object.values(stored.connections).every(
    (connection) =>
      !!connection &&
      typeof connection === "object" &&
      !Array.isArray(connection) &&
      typeof (connection as Record<string, unknown>).version === "string" &&
      typeof (connection as Record<string, unknown>).encryptedPayload ===
        "string",
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
