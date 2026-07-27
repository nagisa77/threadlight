import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_QWEN_BASE_URL,
  PROVIDER_OPTIONS,
  SettingsSelectField,
  ThemePicker,
  createSettingsUpdate,
} from "../src/settings.js";

describe("settings", () => {
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
        },
        { value: "", cleared: false },
        "deepseek",
        DEFAULT_QWEN_BASE_URL,
        "deepseek-v4-pro",
      ),
    ).toEqual({
      language: "zh-CN",
      theme: "system",
      provider: "deepseek",
      deepSeekApiKey: "ds-new",
      qwenApiKey: null,
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
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
        },
        { value: "", cleared: false },
        "qwen",
        `  ${DEFAULT_QWEN_BASE_URL}  `,
        "qwen3.7-plus",
      ),
    ).toEqual({
      language: "zh-CN",
      theme: "system",
      provider: "qwen",
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      model: "qwen3.7-plus",
    });
  });

  it("includes the selected interface language in persisted settings", () => {
    expect(
      createSettingsUpdate(
        {
          openai: { value: "", cleared: false },
          deepseek: { value: "", cleared: false },
          qwen: { value: "", cleared: false },
        },
        { value: "", cleared: false },
        "openai",
        DEFAULT_QWEN_BASE_URL,
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
        },
        { value: "", cleared: false },
        "openai",
        DEFAULT_QWEN_BASE_URL,
        "gpt-5.6-sol",
        "zh-CN",
        "dark",
      ).theme,
    ).toBe("dark");
  });
});
