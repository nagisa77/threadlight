import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_DOUBAO_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GROK_BASE_URL,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_QWEN_BASE_URL,
  PROVIDER_OPTIONS,
  SettingsPage,
  SettingsSelectField,
  ThemePicker,
  createAppearanceSettingsUpdate,
  createSettingsUpdate,
  type SettingsSnapshot,
} from "../src/settings.js";
import { I18nProvider } from "../src/i18n.js";

describe("settings", () => {
  it.each([
    {
      boundary: "system" as const,
      expected: "this device&#x27;s secure system storage",
      excluded: "AES-256-GCM",
    },
    {
      boundary: "host-file" as const,
      expected: "AES-256-GCM",
      excluded: "this device&#x27;s secure system storage",
    },
  ])(
    "describes the $boundary secret protection boundary",
    ({ boundary, expected, excluded }) => {
      const adapter = {
        load: async () => {
          throw new Error("not used during server render");
        },
        save: async () => {
          throw new Error("not used during server render");
        },
      };
      const html = renderToStaticMarkup(
        createElement(
          I18nProvider,
          { language: "en" },
          createElement(SettingsPage, {
            adapter,
            secretStorageBoundary: boundary,
            onRuntimeRestart: async () => {},
          }),
        ),
      );

      expect(html).toContain(expected);
      expect(html).not.toContain(excluded);
      if (boundary === "host-file") {
        expect(html).toContain("0600");
        expect(html).toContain("same OS account");
      }
    },
  );

  it("renders Codex-style system, light, and dark theme previews", () => {
    const html = renderToStaticMarkup(
      createElement(ThemePicker, {
        value: "system",
        onChange: () => {},
      }),
    );

    expect(html).toContain('class="theme-preview system"');
    expect(html).toContain('class="theme-preview light"');
    expect(html).toContain('class="theme-preview dark"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('checked="" value="system"');
  });

  it("renders the custom accessible settings popover instead of a native select", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSelectField, {
        id: "provider-select",
        label: "服务厂商",
        description: "选择服务厂商",
        value: "openai",
        options: [
          { value: "openai", label: "OpenAI" },
          { value: "deepseek", label: "DeepSeek" },
        ],
        onChange: () => {},
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("<select");
  });

  it("scopes the available models to each provider", () => {
    expect(
      PROVIDER_OPTIONS.map((provider) => ({
        provider: provider.value,
        models: provider.models.map((model) => model.value),
      })),
    ).toEqual([
      {
        provider: "openai",
        models: [
          "gpt-5.6-sol",
          "gpt-5.6-terra",
          "gpt-5.6-luna",
          "gpt-5.4-mini",
          "gpt-5-mini",
          "gpt-4.1-mini",
        ],
      },
      {
        provider: "kimi",
        models: ["kimi-k3", "kimi-k2.6", "kimi-k2.5"],
      },
      {
        provider: "doubao",
        models: [
          "doubao-seed-2-0-pro-260215",
          "doubao-seed-2-0-code-preview-260215",
          "doubao-seed-2-0-lite-260215",
        ],
      },
      {
        provider: "gemini",
        models: [
          "gemini-3.1-pro-preview",
          "gemini-3.6-flash",
          "gemini-3.5-flash-lite",
        ],
      },
      {
        provider: "grok",
        models: ["grok-4.5", "grok-build-0.1", "grok-4.3"],
      },
      {
        provider: "custom",
        models: [],
      },
      {
        provider: "deepseek",
        models: ["deepseek-v4-pro", "deepseek-v4-flash"],
      },
      {
        provider: "qwen",
        models: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash"],
      },
    ]);
  });

  it("sends provider-specific keys, removals, and connection settings", () => {
    expect(
      createSettingsUpdate(
        {
          openai: { value: "", cleared: false },
          deepseek: { value: "  ds-new  ", cleared: false },
          qwen: { value: "", cleared: true },
          kimi: { value: "  kimi-new  ", cleared: false },
          doubao: { value: "  doubao-new  ", cleared: false },
          gemini: { value: "", cleared: false },
          grok: { value: "", cleared: true },
          custom: { value: "", cleared: false },
        },
        { value: "", cleared: false },
        "deepseek",
        DEFAULT_QWEN_BASE_URL,
        DEFAULT_KIMI_BASE_URL,
        DEFAULT_DOUBAO_BASE_URL,
        DEFAULT_GEMINI_BASE_URL,
        DEFAULT_GROK_BASE_URL,
        DEFAULT_CUSTOM_BASE_URL,
        "llama3.2",
        "deepseek-v4-pro",
      ),
    ).toEqual({
      language: "zh-CN",
      theme: "system",
      preferredProjectOpener: "",
      provider: "deepseek",
      deepSeekApiKey: "ds-new",
      qwenApiKey: null,
      kimiApiKey: "kimi-new",
      doubaoApiKey: "doubao-new",
      grokApiKey: null,
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
      doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
      geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
      grokBaseUrl: DEFAULT_GROK_BASE_URL,
      customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
      customModel: "llama3.2",
      model: "deepseek-v4-pro",
    });
  });

  it("does not overwrite unchanged secrets", () => {
    expect(
      createSettingsUpdate(
        {
          openai: { value: "", cleared: false },
          deepseek: { value: "", cleared: false },
          qwen: { value: "", cleared: false },
          kimi: { value: "", cleared: false },
          doubao: { value: "", cleared: false },
          gemini: { value: "", cleared: false },
          grok: { value: "", cleared: false },
          custom: { value: "", cleared: false },
        },
        { value: "", cleared: false },
        "qwen",
        `  ${DEFAULT_QWEN_BASE_URL}  `,
        `  ${DEFAULT_KIMI_BASE_URL}  `,
        `  ${DEFAULT_DOUBAO_BASE_URL}  `,
        `  ${DEFAULT_GEMINI_BASE_URL}  `,
        `  ${DEFAULT_GROK_BASE_URL}  `,
        `  ${DEFAULT_CUSTOM_BASE_URL}  `,
        "llama3.2",
        "qwen3.7-plus",
      ),
    ).toEqual({
      language: "zh-CN",
      theme: "system",
      preferredProjectOpener: "",
      provider: "qwen",
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
      doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
      geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
      grokBaseUrl: DEFAULT_GROK_BASE_URL,
      customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
      customModel: "llama3.2",
      model: "qwen3.7-plus",
    });
  });

  it("persists a custom model, endpoint, and optional key", () => {
    const drafts = Object.fromEntries(
      PROVIDER_OPTIONS.map(({ value }) => [
        value,
        { value: "", cleared: false },
      ]),
    ) as Parameters<typeof createSettingsUpdate>[0];
    drafts.custom = { value: "  local-token  ", cleared: false };

    expect(
      createSettingsUpdate(
        drafts,
        { value: "", cleared: false },
        "custom",
        DEFAULT_QWEN_BASE_URL,
        DEFAULT_KIMI_BASE_URL,
        DEFAULT_DOUBAO_BASE_URL,
        DEFAULT_GEMINI_BASE_URL,
        DEFAULT_GROK_BASE_URL,
        "  http://localhost:1234/v1  ",
        "local/model",
        "local/model",
      ),
    ).toMatchObject({
      provider: "custom",
      customApiKey: "local-token",
      customBaseUrl: "http://localhost:1234/v1",
      model: "local/model",
    });
  });

  it("stores the custom model separately from the active provider model", () => {
    const update = createSettingsUpdate(
      Object.fromEntries(PROVIDER_OPTIONS.map(({ value }) => [value, { value: "", cleared: false }])) as Parameters<typeof createSettingsUpdate>[0],
      { value: "", cleared: false },
      "openai",
      DEFAULT_QWEN_BASE_URL,
      DEFAULT_KIMI_BASE_URL,
      DEFAULT_DOUBAO_BASE_URL,
      DEFAULT_GEMINI_BASE_URL,
      DEFAULT_GROK_BASE_URL,
      DEFAULT_CUSTOM_BASE_URL,
      "local/model",
      "gpt-5.6-sol",
    );

    expect(update).toMatchObject({
      provider: "openai",
      model: "gpt-5.6-sol",
      customModel: "local/model",
    });
  });

  it("includes the selected interface language in persisted settings", () => {
    expect(
      createSettingsUpdate(
        {
          openai: { value: "", cleared: false },
          deepseek: { value: "", cleared: false },
          qwen: { value: "", cleared: false },
          kimi: { value: "", cleared: false },
          doubao: { value: "", cleared: false },
          gemini: { value: "", cleared: false },
          grok: { value: "", cleared: false },
          custom: { value: "", cleared: false },
        },
        { value: "", cleared: false },
        "openai",
        DEFAULT_QWEN_BASE_URL,
        DEFAULT_KIMI_BASE_URL,
        DEFAULT_DOUBAO_BASE_URL,
        DEFAULT_GEMINI_BASE_URL,
        DEFAULT_GROK_BASE_URL,
        DEFAULT_CUSTOM_BASE_URL,
        "llama3.2",
        "gpt-5.6-sol",
        "ja",
      ).language,
    ).toBe("ja");
  });

  it("includes the selected theme in persisted settings", () => {
    expect(
      createSettingsUpdate(
        {
          openai: { value: "", cleared: false },
          deepseek: { value: "", cleared: false },
          qwen: { value: "", cleared: false },
          kimi: { value: "", cleared: false },
          doubao: { value: "", cleared: false },
          gemini: { value: "", cleared: false },
          grok: { value: "", cleared: false },
          custom: { value: "", cleared: false },
        },
        { value: "", cleared: false },
        "openai",
        DEFAULT_QWEN_BASE_URL,
        DEFAULT_KIMI_BASE_URL,
        DEFAULT_DOUBAO_BASE_URL,
        DEFAULT_GEMINI_BASE_URL,
        DEFAULT_GROK_BASE_URL,
        DEFAULT_CUSTOM_BASE_URL,
        "llama3.2",
        "gpt-5.6-sol",
        "zh-CN",
        "dark",
      ).theme,
    ).toBe("dark");
  });

  it("auto-saves appearance from the persisted snapshot without submitting secret drafts", () => {
    const snapshot: SettingsSnapshot = {
      language: "en",
      theme: "dark",
      preferredProjectOpener: "cursor",
      provider: "kimi",
      openAIApiKeyConfigured: true,
      deepSeekApiKeyConfigured: false,
      qwenApiKeyConfigured: false,
      kimiApiKeyConfigured: true,
      doubaoApiKeyConfigured: false,
      geminiApiKeyConfigured: false,
      grokApiKeyConfigured: false,
      customApiKeyConfigured: false,
      searchApiKeyConfigured: true,
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
      doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
      geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
      grokBaseUrl: DEFAULT_GROK_BASE_URL,
      customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
      customModel: "llama3.2",
      model: "kimi-k3",
    };

    const update = createAppearanceSettingsUpdate(snapshot);

    expect(update).toMatchObject({
      language: "en",
      theme: "dark",
      preferredProjectOpener: "cursor",
      provider: "kimi",
      model: "kimi-k3",
    });
    expect(update).not.toHaveProperty("openAIApiKey");
    expect(update).not.toHaveProperty("kimiApiKey");
    expect(update).not.toHaveProperty("searchApiKey");
  });

  it("includes the selected preferred project opener", () => {
    expect(
      createSettingsUpdate(
        {
          openai: { value: "", cleared: false },
          deepseek: { value: "", cleared: false },
          qwen: { value: "", cleared: false },
          kimi: { value: "", cleared: false },
          doubao: { value: "", cleared: false },
          gemini: { value: "", cleared: false },
          grok: { value: "", cleared: false },
          custom: { value: "", cleared: false },
        },
        { value: "", cleared: false },
        "openai",
        DEFAULT_QWEN_BASE_URL,
        DEFAULT_KIMI_BASE_URL,
        DEFAULT_DOUBAO_BASE_URL,
        DEFAULT_GEMINI_BASE_URL,
        DEFAULT_GROK_BASE_URL,
        DEFAULT_CUSTOM_BASE_URL,
        "llama3.2",
        "gpt-5.6-sol",
        "zh-CN",
        "system",
        "cursor",
      ).preferredProjectOpener,
    ).toBe("cursor");
  });
});
