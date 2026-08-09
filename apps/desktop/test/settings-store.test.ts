import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_CUSTOM_MODEL,
  DEFAULT_DOUBAO_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GROK_BASE_URL,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_QWEN_BASE_URL,
  runtimeEnvironment,
  SettingsStore,
  type SecretCodec,
} from "../src/main/settings-store.js";

const DEFAULT_CONNECTIONS = {
  qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
  kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
  doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
  geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
  grokBaseUrl: DEFAULT_GROK_BASE_URL,
  customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
};

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
        kimiApiKey: "kimi-secret",
        doubaoApiKey: "doubao-secret",
        geminiApiKey: "gemini-secret",
        grokApiKey: "grok-secret",
        customApiKey: "custom-secret",
        searchApiKey: "search-secret",
        ...DEFAULT_CONNECTIONS,
        customModel: DEFAULT_CUSTOM_MODEL,
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
      kimiApiKeyConfigured: true,
      doubaoApiKeyConfigured: true,
      geminiApiKeyConfigured: true,
      grokApiKeyConfigured: true,
      customApiKeyConfigured: true,
      searchApiKeyConfigured: true,
      ...DEFAULT_CONNECTIONS,
      customModel: DEFAULT_CUSTOM_MODEL,
      model: "deepseek-v4-pro",
    });
    const stored = readFileSync(path, "utf8");
    for (const secret of [
      "openai-secret",
      "deepseek-secret",
      "qwen-secret",
      "kimi-secret",
      "doubao-secret",
      "gemini-secret",
      "grok-secret",
      "custom-secret",
      "search-secret",
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(store.runtimeSettings({})).toEqual({
      provider: "deepseek",
      openAIApiKey: "openai-secret",
      deepSeekApiKey: "deepseek-secret",
      qwenApiKey: "qwen-secret",
      kimiApiKey: "kimi-secret",
      doubaoApiKey: "doubao-secret",
      geminiApiKey: "gemini-secret",
      grokApiKey: "grok-secret",
      customApiKey: "custom-secret",
      searchApiKey: "search-secret",
      ...DEFAULT_CONNECTIONS,
      model: "deepseek-v4-pro",
    });
  });

  it("keeps unchanged keys, supports clearing, and falls back to environment", () => {
    const { store } = createStore();
    store.update(
      {
        provider: "openai",
        openAIApiKey: "stored-key",
        ...DEFAULT_CONNECTIONS,
        customModel: DEFAULT_CUSTOM_MODEL,
        model: "gpt-5.6-sol",
      },
      {},
    );

    store.update(
      {
        provider: "qwen",
        openAIApiKey: null,
        qwenBaseUrl: "https://example.test/compatible-mode/v1/",
        kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
        doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
        geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
        grokBaseUrl: DEFAULT_GROK_BASE_URL,
        customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
        customModel: DEFAULT_CUSTOM_MODEL,
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
      kimiApiKey: undefined,
      doubaoApiKey: undefined,
      geminiApiKey: undefined,
      grokApiKey: undefined,
      customApiKey: undefined,
      searchApiKey: undefined,
      qwenBaseUrl: "https://example.test/compatible-mode/v1",
      kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
      doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
      geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
      grokBaseUrl: DEFAULT_GROK_BASE_URL,
      customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
      model: "qwen3.7-plus",
    });
  });

  it("treats secrets encrypted by another host as unconfigured", () => {
    const { path } = createStore();
    const incompatibleCodec: SecretCodec = {
      encrypt: (value) => `other-host:${value}`,
      decrypt: () => {
        throw new Error("Unable to authenticate data");
      },
    };
    const store = new SettingsStore(path, incompatibleCodec);
    const compatibleStore = new SettingsStore(path, codec);

    compatibleStore.update(
      {
        provider: "openai",
        openAIApiKey: "machine-bound-secret",
        ...DEFAULT_CONNECTIONS,
        customModel: DEFAULT_CUSTOM_MODEL,
        model: "gpt-5.6-sol",
      },
      {},
    );

    expect(store.snapshot({})).toMatchObject({
      provider: "openai",
      openAIApiKeyConfigured: false,
      model: "gpt-5.6-sol",
    });
    expect(store.runtimeSettings({ OPENAI_API_KEY: "environment-key" }))
      .toMatchObject({
        openAIApiKey: "environment-key",
      });
  });

  it("maps provider settings to child-process environment variables", () => {
    expect(
      runtimeEnvironment({
        provider: "qwen",
        openAIApiKey: "openai",
        deepSeekApiKey: "deepseek",
        qwenApiKey: "qwen",
        kimiApiKey: "kimi",
        doubaoApiKey: "doubao",
        geminiApiKey: "gemini",
        grokApiKey: "grok",
        customApiKey: "custom",
        searchApiKey: "search",
        qwenBaseUrl: "https://qwen.example/v1",
        kimiBaseUrl: "https://kimi.example/v1",
        doubaoBaseUrl: "https://doubao.example/v1",
        geminiBaseUrl: "https://gemini.example/v1",
        grokBaseUrl: "https://grok.example/v1",
        customBaseUrl: "http://localhost:1234/v1",
        model: "qwen3.7-plus",
      }),
    ).toEqual({
      THREADLIGHT_PROVIDER: "qwen",
      OPENAI_API_KEY: "openai",
      DEEPSEEK_API_KEY: "deepseek",
      DASHSCOPE_API_KEY: "qwen",
      MOONSHOT_API_KEY: "kimi",
      ARK_API_KEY: "doubao",
      GEMINI_API_KEY: "gemini",
      XAI_API_KEY: "grok",
      CUSTOM_API_KEY: "custom",
      BRAVE_SEARCH_API_KEY: "search",
      DASHSCOPE_BASE_URL: "https://qwen.example/v1",
      MOONSHOT_BASE_URL: "https://kimi.example/v1",
      ARK_BASE_URL: "https://doubao.example/v1",
      GEMINI_BASE_URL: "https://gemini.example/v1",
      XAI_BASE_URL: "https://grok.example/v1",
      CUSTOM_BASE_URL: "http://localhost:1234/v1",
      THREADLIGHT_MODEL: "qwen3.7-plus",
    });
  });

  it("maps Kimi credentials and endpoint to the child process", () => {
    expect(
      runtimeEnvironment({
        provider: "kimi",
        openAIApiKey: "openai",
        deepSeekApiKey: "deepseek",
        qwenApiKey: "qwen",
        kimiApiKey: "kimi",
        doubaoApiKey: "doubao",
        geminiApiKey: "gemini",
        grokApiKey: "grok",
        customApiKey: "custom",
        searchApiKey: "search",
        qwenBaseUrl: "https://qwen.example/v1",
        kimiBaseUrl: "https://kimi.example/v1",
        doubaoBaseUrl: "https://doubao.example/v1",
        geminiBaseUrl: "https://gemini.example/v1",
        grokBaseUrl: "https://grok.example/v1",
        customBaseUrl: "http://localhost:1234/v1",
        model: "kimi-k3",
      }),
    ).toEqual({
      THREADLIGHT_PROVIDER: "kimi",
      OPENAI_API_KEY: "openai",
      DEEPSEEK_API_KEY: "deepseek",
      DASHSCOPE_API_KEY: "qwen",
      MOONSHOT_API_KEY: "kimi",
      ARK_API_KEY: "doubao",
      GEMINI_API_KEY: "gemini",
      XAI_API_KEY: "grok",
      CUSTOM_API_KEY: "custom",
      BRAVE_SEARCH_API_KEY: "search",
      DASHSCOPE_BASE_URL: "https://qwen.example/v1",
      MOONSHOT_BASE_URL: "https://kimi.example/v1",
      ARK_BASE_URL: "https://doubao.example/v1",
      GEMINI_BASE_URL: "https://gemini.example/v1",
      XAI_BASE_URL: "https://grok.example/v1",
      CUSTOM_BASE_URL: "http://localhost:1234/v1",
      THREADLIGHT_MODEL: "kimi-k3",
    });
  });

  it.each([
    {
      provider: "doubao" as const,
      model: "doubao-seed-2-0-pro-260215",
      keyName: "ARK_API_KEY",
      baseUrlName: "ARK_BASE_URL",
      key: "doubao",
      baseUrl: "https://doubao.example/v1",
    },
    {
      provider: "gemini" as const,
      model: "gemini-3.6-flash",
      keyName: "GEMINI_API_KEY",
      baseUrlName: "GEMINI_BASE_URL",
      key: "gemini",
      baseUrl: "https://gemini.example/v1",
    },
    {
      provider: "grok" as const,
      model: "grok-4.5",
      keyName: "XAI_API_KEY",
      baseUrlName: "XAI_BASE_URL",
      key: "grok",
      baseUrl: "https://grok.example/v1",
    },
  ])(
    "maps $provider credentials and endpoint to the child process",
    ({ provider, model, keyName, baseUrlName, key, baseUrl }) => {
      const settings = {
        provider,
        openAIApiKey: "openai",
        deepSeekApiKey: "deepseek",
        qwenApiKey: "qwen",
        kimiApiKey: "kimi",
        doubaoApiKey: "doubao",
        geminiApiKey: "gemini",
        grokApiKey: "grok",
        customApiKey: "custom",
        searchApiKey: "search",
        qwenBaseUrl: "https://qwen.example/v1",
        kimiBaseUrl: "https://kimi.example/v1",
        doubaoBaseUrl: "https://doubao.example/v1",
        geminiBaseUrl: "https://gemini.example/v1",
        grokBaseUrl: "https://grok.example/v1",
        customBaseUrl: "http://localhost:1234/v1",
        model,
      };

      expect(runtimeEnvironment(settings)).toEqual({
        THREADLIGHT_PROVIDER: provider,
        OPENAI_API_KEY: "openai",
        DEEPSEEK_API_KEY: "deepseek",
        DASHSCOPE_API_KEY: "qwen",
        MOONSHOT_API_KEY: "kimi",
        ARK_API_KEY: "doubao",
        GEMINI_API_KEY: "gemini",
        XAI_API_KEY: "grok",
        CUSTOM_API_KEY: "custom",
        BRAVE_SEARCH_API_KEY: "search",
        DASHSCOPE_BASE_URL: "https://qwen.example/v1",
        MOONSHOT_BASE_URL: "https://kimi.example/v1",
        ARK_BASE_URL: "https://doubao.example/v1",
        GEMINI_BASE_URL: "https://gemini.example/v1",
        XAI_BASE_URL: "https://grok.example/v1",
        CUSTOM_BASE_URL: "http://localhost:1234/v1",
        [keyName]: key,
        [baseUrlName]: baseUrl,
        THREADLIGHT_MODEL: model,
      });
    },
  );

  it("maps a keyless custom endpoint to the child process", () => {
    expect(
      runtimeEnvironment({
        provider: "custom",
        ...emptyRuntimeSecrets(),
        searchApiKey: "search",
        ...DEFAULT_CONNECTIONS,
        customBaseUrl: "http://localhost:1234/v1",
        model: "local/model",
      }),
    ).toEqual({
      THREADLIGHT_PROVIDER: "custom",
      BRAVE_SEARCH_API_KEY: "search",
      DASHSCOPE_BASE_URL: DEFAULT_QWEN_BASE_URL,
      MOONSHOT_BASE_URL: DEFAULT_KIMI_BASE_URL,
      ARK_BASE_URL: DEFAULT_DOUBAO_BASE_URL,
      GEMINI_BASE_URL: DEFAULT_GEMINI_BASE_URL,
      XAI_BASE_URL: DEFAULT_GROK_BASE_URL,
      CUSTOM_BASE_URL: "http://localhost:1234/v1",
      THREADLIGHT_MODEL: "local/model",
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
    expect(store.snapshot({ THREADLIGHT_PROVIDER: "kimi" })).toMatchObject({
      provider: "kimi",
      model: "kimi-k3",
    });
    expect(store.snapshot({ THREADLIGHT_PROVIDER: "doubao" })).toMatchObject({
      provider: "doubao",
      model: "doubao-seed-2-0-pro-260215",
    });
    expect(store.snapshot({ THREADLIGHT_PROVIDER: "gemini" })).toMatchObject({
      provider: "gemini",
      model: "gemini-3.6-flash",
    });
    expect(store.snapshot({ THREADLIGHT_PROVIDER: "grok" })).toMatchObject({
      provider: "grok",
      model: "grok-4.5",
    });
    expect(store.snapshot({ THREADLIGHT_PROVIDER: "custom" })).toMatchObject({
      provider: "custom",
      model: "llama3.2",
      customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
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
        ...DEFAULT_CONNECTIONS,
        customModel: DEFAULT_CUSTOM_MODEL,
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
        ...DEFAULT_CONNECTIONS,
        customModel: DEFAULT_CUSTOM_MODEL,
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
        ...DEFAULT_CONNECTIONS,
        customModel: DEFAULT_CUSTOM_MODEL,
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

function emptyRuntimeSecrets() {
  return {
    openAIApiKey: undefined,
    deepSeekApiKey: undefined,
    qwenApiKey: undefined,
    kimiApiKey: undefined,
    doubaoApiKey: undefined,
    geminiApiKey: undefined,
    grokApiKey: undefined,
    customApiKey: undefined,
  };
}
