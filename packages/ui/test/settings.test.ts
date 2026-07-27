import { describe, expect, it } from "vitest";

import {
  DEFAULT_QWEN_BASE_URL,
  PROVIDER_OPTIONS,
  createSettingsUpdate,
} from "../src/settings.js";

describe("settings", () => {
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
      provider: "qwen",
      qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
      model: "qwen3.7-plus",
    });
  });
});
