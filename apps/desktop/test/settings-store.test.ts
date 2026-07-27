import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_QWEN_BASE_URL,
  runtimeEnvironment,
  SettingsStore,
  type SecretCodec,
} from "../src/main/settings-store.js";

const directories: string[] = [];
const codec: SecretCodec = {
  encrypt: (value) => Buffer.from(`protected:${value}`).toString("base64"),
  decrypt: (value) =>
    Buffer.from(value, "base64").toString("utf8").replace(/^protected:/, ""),
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "threadlight-settings-"));
  directories.push(directory);
  const path = join(directory, "settings.json");
  return { path, store: new SettingsStore(path, codec) };
}

describe("SettingsStore", () => {
  it("encrypts every provider key and exposes only configuration status", () => {
    const { path, store } = createStore();

    const snapshot = store.update(
      {
        provider: "deepseek",
        openAIApiKey: "openai-secret",
        deepSeekApiKey: "  deepseek-secret  ",
        qwenApiKey: "qwen-secret",
        searchApiKey: "search-secret",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: "  deepseek-v4-pro  ",
      },
      {},
    );

    expect(snapshot).toEqual({
      language: "zh-CN",
      theme: "system",
      preferredProjectOpener: "",
      provider: "deepseek",
      openAIApiKeyConfigured: true,
      deepSeekApiKeyConfigured: true,
      qwenApiKeyConfigured: true,
      searchApiKeyConfigured: true,
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      model: "deepseek-v4-pro",
    });
    const stored = readFileSync(path, "utf8");
    for (const secret of [
      "openai-secret",
      "deepseek-secret",
      "qwen-secret",
      "search-secret",
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(store.runtimeSettings({})).toEqual({
      provider: "deepseek",
      openAIApiKey: "openai-secret",
      deepSeekApiKey: "deepseek-secret",
      qwenApiKey: "qwen-secret",
      searchApiKey: "search-secret",
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      model: "deepseek-v4-pro",
    });
  });

  it("keeps unchanged keys, supports clearing, and falls back to environment", () => {
    const { store } = createStore();
    store.update(
      {
        provider: "openai",
        openAIApiKey: "stored-key",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: "gpt-5.6-sol",
      },
      {},
    );

    store.update(
      {
        provider: "qwen",
        openAIApiKey: null,
        qwenBaseUrl: "https://example.test/compatible-mode/v1/",
        model: "qwen3.7-plus",
      },
      { OPENAI_API_KEY: "environment-key" },
    );

    expect(
      store.runtimeSettings({ OPENAI_API_KEY: "environment-key" }),
    ).toEqual({
      provider: "qwen",
      openAIApiKey: "environment-key",
      deepSeekApiKey: undefined,
      qwenApiKey: undefined,
      searchApiKey: undefined,
      qwenBaseUrl: "https://example.test/compatible-mode/v1",
      model: "qwen3.7-plus",
    });
  });

  it("maps provider settings to child-process environment variables", () => {
    expect(
      runtimeEnvironment({
        provider: "qwen",
        openAIApiKey: "openai",
        deepSeekApiKey: "deepseek",
        qwenApiKey: "qwen",
        searchApiKey: "search",
        qwenBaseUrl: "https://qwen.example/v1",
        model: "qwen3.7-plus",
      }),
    ).toEqual({
      THREADLIGHT_PROVIDER: "qwen",
      DASHSCOPE_API_KEY: "qwen",
      BRAVE_SEARCH_API_KEY: "search",
      DASHSCOPE_BASE_URL: "https://qwen.example/v1",
      THREADLIGHT_MODEL: "qwen3.7-plus",
    });
  });

  it("uses provider defaults while remaining compatible with version 1 settings", () => {
    const { store } = createStore();

    expect(store.snapshot({ THREADLIGHT_PROVIDER: "deepseek" })).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    expect(store.snapshot({ THREADLIGHT_PROVIDER: "qwen" })).toMatchObject({
      provider: "qwen",
      model: "qwen3.7-plus",
    });
    expect(store.snapshot({})).toMatchObject({
      language: "zh-CN",
      theme: "system",
      preferredProjectOpener: "",
      provider: "openai",
      model: "gpt-5.6-sol",
    });
  });

  it("persists the interface language without affecting runtime settings", () => {
    const { path, store } = createStore();
    const before = store.runtimeSettings({});

    const snapshot = store.update(
      {
        language: "ja",
        provider: "openai",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: "gpt-5.6-sol",
      },
      {},
    );

    expect(snapshot.language).toBe("ja");
    expect(store.runtimeSettings({})).toEqual(before);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      version: 1,
      language: "ja",
    });
  });

  it("persists the theme preference without affecting runtime settings", () => {
    const { path, store } = createStore();
    const before = store.runtimeSettings({});

    const snapshot = store.update(
      {
        theme: "dark",
        provider: "openai",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: "gpt-5.6-sol",
      },
      {},
    );

    expect(snapshot.theme).toBe("dark");
    expect(store.runtimeSettings({})).toEqual(before);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      version: 1,
      theme: "dark",
    });
  });

  it("persists the preferred project opener without affecting runtime settings", () => {
    const { path, store } = createStore();
    const before = store.runtimeSettings({});

    const snapshot = store.update(
      {
        preferredProjectOpener: "cursor",
        provider: "openai",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: "gpt-5.6-sol",
      },
      {},
    );

    expect(snapshot.preferredProjectOpener).toBe("cursor");
    expect(store.runtimeSettings({})).toEqual(before);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      version: 1,
      preferredProjectOpener: "cursor",
    });
  });
});
