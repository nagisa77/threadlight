import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface HostConfig {
  token?: string;
  host?: string;
  port?: number;
  home?: string;
  project?: string;
  origins?: string[];
  name?: string;
  publicUrl?: string;
  webRoot?: string;
}

const CONFIG_KEYS = new Set<keyof HostConfig>([
  "token",
  "host",
  "port",
  "home",
  "project",
  "origins",
  "name",
  "publicUrl",
  "webRoot",
]);

export function readHostConfig(path: string): HostConfig {
  const configPath = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read Host config ${configPath}: ${errorMessage(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`Host config ${configPath} must contain a JSON object.`);
  }

  const unknown = Object.keys(parsed).filter(
    (key) => !CONFIG_KEYS.has(key as keyof HostConfig),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown Host config ${unknown.length === 1 ? "key" : "keys"}: ${unknown.join(", ")}`,
    );
  }

  const config: HostConfig = {};
  for (const key of [
    "token",
    "host",
    "home",
    "project",
    "name",
    "publicUrl",
    "webRoot",
  ] as const) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Host config ${key} must be a non-empty string.`);
    }
    config[key] = value;
  }

  if (parsed.port !== undefined) {
    if (
      !Number.isInteger(parsed.port) ||
      (parsed.port as number) < 0 ||
      (parsed.port as number) > 65_535
    ) {
      throw new Error("Host config port must be an integer from 0 to 65535.");
    }
    config.port = parsed.port as number;
  }

  if (parsed.origins !== undefined) {
    if (
      !Array.isArray(parsed.origins) ||
      parsed.origins.some(
        (origin) => typeof origin !== "string" || !origin.trim(),
      )
    ) {
      throw new Error(
        "Host config origins must be an array of non-empty strings.",
      );
    }
    config.origins = parsed.origins;
  }
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
