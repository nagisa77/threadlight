import type {
  ModelProviderId,
  SettingsSnapshot,
} from "./settings.js";

export function providerIsConfigured(settings: SettingsSnapshot): boolean {
  return providerIsConfiguredFor(settings, settings.provider);
}

export function providerIsConfiguredFor(
  settings: SettingsSnapshot,
  provider: ModelProviderId,
): boolean {
  if (provider === "custom") {
    return Boolean(settings.customBaseUrl.trim());
  }
  if (provider === "deepseek") return settings.deepSeekApiKeyConfigured;
  if (provider === "qwen") return settings.qwenApiKeyConfigured;
  if (provider === "kimi") return settings.kimiApiKeyConfigured;
  if (provider === "doubao") return settings.doubaoApiKeyConfigured;
  if (provider === "gemini") return settings.geminiApiKeyConfigured;
  if (provider === "grok") return settings.grokApiKeyConfigured;
  return settings.openAIApiKeyConfigured;
}
