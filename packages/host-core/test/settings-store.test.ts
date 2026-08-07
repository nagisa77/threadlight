import { mkdtempSync, rmSync } from "node:fs";
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

describe("SettingsStore custom model", () => {
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
});
