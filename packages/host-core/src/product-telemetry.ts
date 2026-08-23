import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_PRODUCT_TELEMETRY_ENDPOINT =
  "https://threadlight.xyz/api/events";

export type ProductTelemetryEvent =
  "install_succeeded" | "first_task_completed";

export type ProductTelemetrySource = "desktop" | "self_host" | "source";

export interface ProductTelemetryPayload {
  schemaVersion: 1;
  eventId: string;
  anonymousId: string;
  name: ProductTelemetryEvent;
  occurredAt: string;
  source: ProductTelemetrySource;
  appVersion: string;
  platform: string;
}

export interface ProductTelemetryTransport {
  send(endpoint: string, payload: ProductTelemetryPayload): Promise<void>;
}

export interface ProductTelemetryOptions {
  homePath: string;
  source: ProductTelemetrySource;
  appVersion: string;
  enabled?: boolean;
  attributionId?: string;
  endpoint?: string;
  transport?: ProductTelemetryTransport;
  now?: () => Date;
  createId?: () => string;
}

interface StoredTelemetryIdentity {
  schemaVersion: 1;
  anonymousId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING_CLAIM_MAX_AGE_MS = 5 * 60 * 1_000;

export class ProductTelemetry {
  private readonly enabled: boolean;
  private readonly endpoint: string;
  private readonly transport: ProductTelemetryTransport;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: ProductTelemetryOptions) {
    this.enabled =
      (options.enabled ?? true) &&
      !existsSync(join(options.homePath, "telemetry-disabled"));
    this.endpoint =
      options.endpoint?.trim() || DEFAULT_PRODUCT_TELEMETRY_ENDPOINT;
    this.transport = options.transport ?? fetchProductTelemetry;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async reportOnce(name: ProductTelemetryEvent): Promise<boolean> {
    if (!this.enabled) return false;

    let pendingPath: string | undefined;
    try {
      const stateDirectory = join(this.options.homePath, "telemetry");
      mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
      const sentPath = join(stateDirectory, `${name}.sent`);
      if (existsSync(sentPath)) return false;

      pendingPath = join(stateDirectory, `${name}.pending`);
      if (!claimEvent(pendingPath, this.now())) return false;

      const anonymousId = readOrCreateAnonymousId(
        join(this.options.homePath, "telemetry.json"),
        this.options.attributionId,
        this.createId,
      );
      const occurredAt = this.now().toISOString();
      await this.transport.send(this.endpoint, {
        schemaVersion: 1,
        eventId: this.createId(),
        anonymousId,
        name,
        occurredAt,
        source: this.options.source,
        appVersion: normalizeVersion(this.options.appVersion),
        platform: `${process.platform}-${process.arch}`,
      });
      writeFileSync(pendingPath, `${occurredAt}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(pendingPath, sentPath);
      return true;
    } catch {
      try {
        if (pendingPath) rmSync(pendingPath, { force: true });
      } catch {
        // Telemetry must never interrupt the product, even on a read-only home.
      }
      return false;
    }
  }
}

export function productTelemetryEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const value =
    environment.THREADLIGHT_TELEMETRY_DISABLED?.trim().toLowerCase();
  return value !== "1" && value !== "true" && value !== "yes";
}

export function productTelemetrySource(
  value: string | undefined,
): ProductTelemetrySource {
  if (value === "desktop" || value === "self_host") return value;
  return "source";
}

function claimEvent(path: string, now: Date): boolean {
  try {
    const descriptor = openSync(path, "wx", 0o600);
    closeSync(descriptor);
    return true;
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  try {
    const age = now.getTime() - statSync(path).mtimeMs;
    if (age <= PENDING_CLAIM_MAX_AGE_MS) return false;
    rmSync(path, { force: true });
    const descriptor = openSync(path, "wx", 0o600);
    closeSync(descriptor);
    return true;
  } catch (error) {
    if (isAlreadyExistsError(error)) return false;
    throw error;
  }
}

function readOrCreateAnonymousId(
  path: string,
  attributionId: string | undefined,
  createId: () => string,
): string {
  const existing = readStoredIdentity(path);
  if (existing) return existing.anonymousId;

  const anonymousId = isUuid(attributionId) ? attributionId : createId();
  const identity: StoredTelemetryIdentity = {
    schemaVersion: 1,
    anonymousId,
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return anonymousId;
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    return readStoredIdentity(path)?.anonymousId ?? anonymousId;
  }
}

function readStoredIdentity(path: string): StoredTelemetryIdentity | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      schemaVersion?: unknown;
      anonymousId?: unknown;
    };
    if (value.schemaVersion !== 1 || !isUuid(value.anonymousId)) return;
    return { schemaVersion: 1, anonymousId: value.anonymousId };
  } catch {
    return;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeVersion(value: string): string {
  const version = value.trim();
  return version && version.length <= 40 ? version : "unknown";
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

const fetchProductTelemetry: ProductTelemetryTransport = {
  async send(endpoint, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    timeout.unref();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Telemetry endpoint returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  },
};
