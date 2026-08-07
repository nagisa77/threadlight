import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_DOUBAO_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GROK_BASE_URL,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_QWEN_BASE_URL,
  SettingsStore,
  type SecretCodec,
} from "../src/settings-store.js";

const directories: string[] = [];
const codec: SecretCodec = { encrypt: (value) => value, decrypt: (value) => value };
const connections = {
  qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
  kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
  doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
  geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
  grokBaseUrl: DEFAULT_GROK_BASE_URL,
  customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
};

afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("SettingsStore", () => {
  it("persists the custom model independently of the active provider and defaults old settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-custom-model-"));
    directories.push(directory);
    const store = new SettingsStore(join(directory, "settings.json"), codec);

    const snapshot = store.update({
      provider: "openai",
      ...connections,
      customModel: "local/vision-model",
      model: "gpt-5.6-sol",
    });

    expect(snapshot).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-sol",
      customModel: "local/vision-model",
    });
  });

  it("builds a snapshot from one consistent stored document", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "threadlight-settings-snapshot-"),
    );
    directories.push(directory);
    const path = join(directory, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        language: "ja",
        theme: "dark",
        preferredProjectOpener: "cursor",
        provider: "openai",
        encryptedOpenAIApiKey: "secret",
        customModel: "original-custom-model",
        model: "gpt-5.6-sol",
      }),
    );
    const mutatingCodec: SecretCodec = {
      encrypt: (value) => value,
      decrypt: (value) => {
        writeFileSync(
          path,
          JSON.stringify({
            version: 1,
            language: "ko",
            theme: "light",
            preferredProjectOpener: "vscode",
            provider: "openai",
            customModel: "replacement-custom-model",
            model: "gpt-5.6-sol",
          }),
        );
        return value;
      },
    };

    expect(new SettingsStore(path, mutatingCodec).snapshot({})).toMatchObject({
      language: "ja",
      theme: "dark",
      preferredProjectOpener: "cursor",
      openAIApiKeyConfigured: true,
      customModel: "original-custom-model",
    });
  });
});
