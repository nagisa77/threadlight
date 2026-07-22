import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  DesktopSettingsSnapshot,
  DesktopSettingsUpdate,
} from "../shared/desktop-api.js";

interface StoredSettings {
  version: 1;
  encryptedOpenAIApiKey?: string;
  encryptedSearchApiKey?: string;
  model?: string;
  autoApproveAll: boolean;
}

export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface RuntimeSettings {
  openAIApiKey?: string;
  searchApiKey?: string;
  model: string;
  autoApproveAll: boolean;
}

export const DEFAULT_MODEL = "gpt-5.6-sol";

const EMPTY_SETTINGS: StoredSettings = {
  version: 1,
  autoApproveAll: false,
};

export class SettingsStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  snapshot(environment: NodeJS.ProcessEnv = process.env): DesktopSettingsSnapshot {
    const settings = this.runtimeSettings(environment);
    return {
      openAIApiKeyConfigured: Boolean(settings.openAIApiKey),
      searchApiKeyConfigured: Boolean(settings.searchApiKey),
      model: settings.model,
      autoApproveAll: settings.autoApproveAll,
    };
  }

  update(
    update: DesktopSettingsUpdate,
    environment: NodeJS.ProcessEnv = process.env,
  ): DesktopSettingsSnapshot {
    const current = this.read();
    const next: StoredSettings = {
      ...current,
      model: requireNonEmpty(update.model, "Model"),
      autoApproveAll: update.autoApproveAll,
    };

    updateSecret(
      next,
      "encryptedOpenAIApiKey",
      update.openAIApiKey,
      this.codec,
    );
    updateSecret(
      next,
      "encryptedSearchApiKey",
      update.searchApiKey,
      this.codec,
    );

    this.write(next);
    return this.snapshot(environment);
  }

  runtimeSettings(
    environment: NodeJS.ProcessEnv = process.env,
  ): RuntimeSettings {
    const stored = this.read();
    return {
      openAIApiKey:
        decryptOptional(stored.encryptedOpenAIApiKey, this.codec) ??
        nonEmpty(environment.OPENAI_API_KEY),
      searchApiKey:
        decryptOptional(stored.encryptedSearchApiKey, this.codec) ??
        nonEmpty(environment.BRAVE_SEARCH_API_KEY),
      model:
        nonEmpty(stored.model) ??
        nonEmpty(environment.THREADLIGHT_MODEL) ??
        DEFAULT_MODEL,
      autoApproveAll: stored.autoApproveAll,
    };
  }

  private read(): StoredSettings {
    let source: string;
    try {
      source = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return EMPTY_SETTINGS;
      throw error;
    }

    const value = JSON.parse(source) as unknown;
    if (!isStoredSettings(value)) {
      throw new Error("Settings file has an unsupported format");
    }
    return value;
  }

  private write(settings: StoredSettings): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
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

export function runtimeEnvironment(
  settings: RuntimeSettings,
): NodeJS.ProcessEnv {
  return {
    ...(settings.openAIApiKey
      ? { OPENAI_API_KEY: settings.openAIApiKey }
      : {}),
    ...(settings.searchApiKey
      ? { BRAVE_SEARCH_API_KEY: settings.searchApiKey }
      : {}),
    THREADLIGHT_MODEL: settings.model,
    THREADLIGHT_AUTO_APPROVE: settings.autoApproveAll ? "1" : "0",
  };
}

function updateSecret(
  settings: StoredSettings,
  key: "encryptedOpenAIApiKey" | "encryptedSearchApiKey",
  value: string | null | undefined,
  codec: SecretCodec,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete settings[key];
    return;
  }

  const normalized = value.trim();
  if (!normalized) throw new Error("API keys cannot be empty");
  settings[key] = codec.encrypt(normalized);
}

function decryptOptional(
  value: string | undefined,
  codec: SecretCodec,
): string | undefined {
  return value === undefined ? undefined : nonEmpty(codec.decrypt(value));
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isStoredSettings(value: unknown): value is StoredSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (
    settings.version === 1 &&
    typeof settings.autoApproveAll === "boolean" &&
    optionalString(settings.encryptedOpenAIApiKey) &&
    optionalString(settings.encryptedSearchApiKey) &&
    optionalString(settings.model)
  );
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = nonEmpty(value);
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
