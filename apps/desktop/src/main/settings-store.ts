import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  DesktopLanguage,
  DesktopModelProvider,
  DesktopSettingsSnapshot,
  DesktopSettingsUpdate,
} from "../shared/desktop-api.js";

interface StoredSettings {
  version: 1;
  language?: DesktopLanguage;
  provider?: DesktopModelProvider;
  encryptedOpenAIApiKey?: string;
  encryptedDeepSeekApiKey?: string;
  encryptedQwenApiKey?: string;
  encryptedSearchApiKey?: string;
  qwenBaseUrl?: string;
  model?: string;
}

export interface SecretCodec {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface RuntimeSettings {
  provider: DesktopModelProvider;
  openAIApiKey?: string;
  deepSeekApiKey?: string;
  qwenApiKey?: string;
  searchApiKey?: string;
  qwenBaseUrl: string;
  model: string;
}

export const DEFAULT_MODEL = "gpt-5.6-sol";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
export const DEFAULT_QWEN_MODEL = "qwen3.7-plus";
export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

const EMPTY_SETTINGS: StoredSettings = {
  version: 1,
};

export class SettingsStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  snapshot(environment: NodeJS.ProcessEnv = process.env): DesktopSettingsSnapshot {
    const settings = this.runtimeSettings(environment);
    return {
      language: parseLanguage(this.read().language),
      provider: settings.provider,
      openAIApiKeyConfigured: Boolean(settings.openAIApiKey),
      deepSeekApiKeyConfigured: Boolean(settings.deepSeekApiKey),
      qwenApiKeyConfigured: Boolean(settings.qwenApiKey),
      searchApiKeyConfigured: Boolean(settings.searchApiKey),
      qwenBaseUrl: settings.qwenBaseUrl,
      model: settings.model,
    };
  }

  update(
    update: DesktopSettingsUpdate,
    environment: NodeJS.ProcessEnv = process.env,
  ): DesktopSettingsSnapshot {
    const current = this.read();
    const next: StoredSettings = {
      ...current,
      language: update.language ?? current.language,
      provider: update.provider,
      qwenBaseUrl: normalizeHttpUrl(update.qwenBaseUrl),
      model: requireNonEmpty(update.model, "Model"),
    };

    updateSecret(
      next,
      "encryptedOpenAIApiKey",
      update.openAIApiKey,
      this.codec,
    );
    updateSecret(
      next,
      "encryptedDeepSeekApiKey",
      update.deepSeekApiKey,
      this.codec,
    );
    updateSecret(
      next,
      "encryptedQwenApiKey",
      update.qwenApiKey,
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
    const provider =
      stored.provider ?? parseProvider(environment.THREADLIGHT_PROVIDER);
    return {
      provider,
      openAIApiKey:
        decryptOptional(stored.encryptedOpenAIApiKey, this.codec) ??
        nonEmpty(environment.OPENAI_API_KEY),
      deepSeekApiKey:
        decryptOptional(stored.encryptedDeepSeekApiKey, this.codec) ??
        nonEmpty(environment.DEEPSEEK_API_KEY),
      qwenApiKey:
        decryptOptional(stored.encryptedQwenApiKey, this.codec) ??
        nonEmpty(environment.DASHSCOPE_API_KEY),
      searchApiKey:
        decryptOptional(stored.encryptedSearchApiKey, this.codec) ??
        nonEmpty(environment.BRAVE_SEARCH_API_KEY),
      qwenBaseUrl:
        nonEmpty(stored.qwenBaseUrl) ??
        nonEmpty(environment.DASHSCOPE_BASE_URL) ??
        DEFAULT_QWEN_BASE_URL,
      model:
        nonEmpty(stored.model) ??
        nonEmpty(environment.THREADLIGHT_MODEL) ??
        defaultModel(provider),
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
    THREADLIGHT_PROVIDER: settings.provider,
    ...(settings.provider === "openai" && settings.openAIApiKey
      ? { OPENAI_API_KEY: settings.openAIApiKey }
      : {}),
    ...(settings.provider === "deepseek" && settings.deepSeekApiKey
      ? { DEEPSEEK_API_KEY: settings.deepSeekApiKey }
      : {}),
    ...(settings.provider === "qwen" && settings.qwenApiKey
      ? { DASHSCOPE_API_KEY: settings.qwenApiKey }
      : {}),
    ...(settings.searchApiKey
      ? { BRAVE_SEARCH_API_KEY: settings.searchApiKey }
      : {}),
    ...(settings.provider === "qwen"
      ? { DASHSCOPE_BASE_URL: settings.qwenBaseUrl }
      : {}),
    THREADLIGHT_MODEL: settings.model,
  };
}

function updateSecret(
  settings: StoredSettings,
  key:
    | "encryptedOpenAIApiKey"
    | "encryptedDeepSeekApiKey"
    | "encryptedQwenApiKey"
    | "encryptedSearchApiKey",
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
    optionalProvider(settings.provider) &&
    optionalString(settings.encryptedOpenAIApiKey) &&
    optionalString(settings.encryptedDeepSeekApiKey) &&
    optionalString(settings.encryptedQwenApiKey) &&
    optionalString(settings.encryptedSearchApiKey) &&
    optionalString(settings.qwenBaseUrl) &&
    optionalString(settings.model) &&
    optionalLanguage(settings.language)
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

function optionalProvider(value: unknown): boolean {
  return value === undefined || isProvider(value);
}

function optionalLanguage(value: unknown): boolean {
  return value === undefined || isLanguage(value);
}

function isLanguage(value: unknown): value is DesktopLanguage {
  return value === "zh-CN" || value === "en" || value === "ja";
}

function parseLanguage(value: unknown): DesktopLanguage {
  return isLanguage(value) ? value : "zh-CN";
}

function isProvider(value: unknown): value is DesktopModelProvider {
  return value === "openai" || value === "deepseek" || value === "qwen";
}

function parseProvider(value: string | undefined): DesktopModelProvider {
  return isProvider(value) ? value : "openai";
}

function defaultModel(provider: DesktopModelProvider): string {
  if (provider === "deepseek") return DEFAULT_DEEPSEEK_MODEL;
  if (provider === "qwen") return DEFAULT_QWEN_MODEL;
  return DEFAULT_MODEL;
}

function normalizeHttpUrl(value: string): string {
  const normalized = requireNonEmpty(value, "Qwen Base URL").replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Qwen Base URL must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Qwen Base URL must use HTTP or HTTPS");
  }
  return normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
