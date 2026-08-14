import type { Translate } from "./i18n.js";

export type ModelProviderId =
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "doubao"
  | "gemini"
  | "grok"
  | "custom";

export interface ModelOption {
  value: string;
  label: string;
}

export interface ProviderOption {
  value: ModelProviderId;
  label: string;
  keyLabel: string;
  defaultModel: string;
  models: readonly ModelOption[];
}

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    value: "openai",
    label: "OpenAI",
    keyLabel: "OpenAI API Key",
    defaultModel: "gpt-5.6-sol",
    models: [
      {
        value: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
      },
      {
        value: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
      },
      {
        value: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
      },
      {
        value: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
      },
      {
        value: "gpt-5-mini",
        label: "GPT-5 mini",
      },
      {
        value: "gpt-4.1-mini",
        label: "GPT-4.1 mini",
      },
    ],
  },
  {
    value: "kimi",
    label: "Kimi",
    keyLabel: "Moonshot API Key",
    defaultModel: "kimi-k3",
    models: [
      {
        value: "kimi-k3",
        label: "Kimi K3",
      },
      {
        value: "kimi-k2.6",
        label: "Kimi K2.6",
      },
      {
        value: "kimi-k2.5",
        label: "Kimi K2.5",
      },
    ],
  },
  {
    value: "doubao",
    label: "Doubao",
    keyLabel: "Ark API Key",
    defaultModel: "doubao-seed-2-0-pro-260215",
    models: [
      {
        value: "doubao-seed-2-0-pro-260215",
        label: "Doubao Seed 2.0 Pro",
      },
      {
        value: "doubao-seed-2-0-code-preview-260215",
        label: "Doubao Seed 2.0 Code",
      },
      {
        value: "doubao-seed-2-0-lite-260215",
        label: "Doubao Seed 2.0 Lite",
      },
    ],
  },
  {
    value: "gemini",
    label: "Gemini",
    keyLabel: "Gemini API Key",
    defaultModel: "gemini-3.6-flash",
    models: [
      {
        value: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro Preview",
      },
      {
        value: "gemini-3.6-flash",
        label: "Gemini 3.6 Flash",
      },
      {
        value: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite",
      },
    ],
  },
  {
    value: "grok",
    label: "Grok",
    keyLabel: "xAI API Key",
    defaultModel: "grok-4.5",
    models: [
      {
        value: "grok-4.5",
        label: "Grok 4.5",
      },
      {
        value: "grok-build-0.1",
        label: "Grok Build 0.1",
      },
      {
        value: "grok-4.3",
        label: "Grok 4.3",
      },
    ],
  },
  {
    value: "custom",
    label: "Custom",
    keyLabel: "API Key (optional)",
    defaultModel: "llama3.2",
    models: [],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    keyLabel: "DeepSeek API Key",
    defaultModel: "deepseek-v4-pro",
    models: [
      {
        value: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
      },
      {
        value: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
      },
    ],
  },
  {
    value: "qwen",
    label: "Qwen",
    keyLabel: "Model Studio API Key",
    defaultModel: "qwen3.7-plus",
    models: [
      {
        value: "qwen3.7-max",
        label: "Qwen3.7 Max",
      },
      {
        value: "qwen3.7-plus",
        label: "Qwen3.7 Plus",
      },
      {
        value: "qwen3.6-flash",
        label: "Qwen3.6 Flash",
      },
    ],
  },
];

export function providerDetails(provider: ModelProviderId): ProviderOption {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    PROVIDER_OPTIONS[0]
  );
}

export function isKnownModel(
  provider: ModelProviderId,
  model: string,
): boolean {
  return providerDetails(provider).models.some(
    (option) => option.value === model,
  );
}

export function providerLabel(provider: ModelProviderId, t: Translate): string {
  if (provider === "qwen") return t("providerQwenLabel");
  if (provider === "doubao") return t("providerDoubaoLabel");
  if (provider === "custom") return t("providerCustomLabel");
  return providerDetails(provider).label;
}

export function providerDescription(
  provider: ModelProviderId,
  t: Translate,
): string {
  const keys: Record<ModelProviderId, Parameters<Translate>[0]> = {
    openai: "providerOpenAIDescription",
    deepseek: "providerDeepSeekDescription",
    qwen: "providerQwenDescription",
    kimi: "providerKimiDescription",
    doubao: "providerDoubaoDescription",
    gemini: "providerGeminiDescription",
    grok: "providerGrokDescription",
    custom: "providerCustomDescription",
  };
  return t(keys[provider]);
}

export function providerKeyLabel(
  provider: ModelProviderId,
  t: Translate,
): string {
  if (provider === "qwen") return t("qwenApiKey");
  if (provider === "custom") return t("customApiKey");
  return providerDetails(provider).keyLabel;
}

export function providerKeyDescription(
  provider: ModelProviderId,
  t: Translate,
): string {
  const keys: Record<ModelProviderId, Parameters<Translate>[0]> = {
    openai: "providerOpenAIKeyDescription",
    deepseek: "providerDeepSeekKeyDescription",
    qwen: "providerQwenKeyDescription",
    kimi: "providerKimiKeyDescription",
    doubao: "providerDoubaoKeyDescription",
    gemini: "providerGeminiKeyDescription",
    grok: "providerGrokKeyDescription",
    custom: "providerCustomKeyDescription",
  };
  return t(keys[provider]);
}

export function modelDescription(
  provider: ModelProviderId,
  model: string,
  t: Translate,
): string {
  if (provider === "custom") return t("customModelDescription");
  const descriptions: Record<string, Parameters<Translate>[0]> = {
    "gpt-5.6-sol": "modelComplex",
    "gpt-5.6-terra": "modelBalanced",
    "gpt-5.6-luna": "modelCost",
    "gpt-5.4-mini": "modelFastCoding",
    "gpt-5-mini": "modelClearGoals",
    "gpt-4.1-mini": "modelNoReasoning",
    "deepseek-v4-pro": "modelAgentComplex",
    "deepseek-v4-flash": "modelAgentFast",
    "qwen3.7-max": "modelQwenMax",
    "qwen3.7-plus": "modelQwenPlus",
    "qwen3.6-flash": "modelQwenFlash",
    "kimi-k3": "modelKimiK3",
    "kimi-k2.6": "modelKimiK26",
    "kimi-k2.5": "modelKimiK25",
    "doubao-seed-2-0-pro-260215": "modelDoubaoPro",
    "doubao-seed-2-0-code-preview-260215": "modelDoubaoCode",
    "doubao-seed-2-0-lite-260215": "modelDoubaoLite",
    "gemini-3.1-pro-preview": "modelGeminiPro",
    "gemini-3.6-flash": "modelGeminiFlash",
    "gemini-3.5-flash-lite": "modelGeminiLite",
    "grok-4.5": "modelGrok45",
    "grok-build-0.1": "modelGrokBuild",
    "grok-4.3": "modelGrok43",
  };
  const key = descriptions[model];
  return key ? t(key) : t("externalModelDescription");
}

export function modelQualifier(model: string, t: Translate): string {
  if (
    model === "gpt-5.6-sol" ||
    model === "deepseek-v4-pro" ||
    model === "qwen3.7-max" ||
    model === "kimi-k3" ||
    model === "doubao-seed-2-0-pro-260215" ||
    model === "gemini-3.1-pro-preview" ||
    model === "grok-4.5"
  ) {
    return t("performanceFirst");
  }
  if (
    model === "gpt-5.6-terra" ||
    model === "qwen3.7-plus" ||
    model === "kimi-k2.6" ||
    model === "doubao-seed-2-0-lite-260215" ||
    model === "gemini-3.6-flash" ||
    model === "grok-4.3"
  ) {
    return t("balanced");
  }
  if (model === "kimi-k2.5") return t("previousGeneration");
  if (
    model === "doubao-seed-2-0-code-preview-260215" ||
    model === "grok-build-0.1"
  ) {
    return t("codingOptimized");
  }
  if (model === "gemini-3.5-flash-lite") return t("costFirst");
  if (model === "gpt-5.6-luna") return t("costFirst");
  if (model === "gpt-5.4-mini") return t("powerfulMini");
  if (model === "gpt-5-mini") return t("economicalMini");
  if (model === "gpt-4.1-mini") return t("lowLatencyMini");
  if (model === "deepseek-v4-flash") return t("speedFirst");
  return t("lowLatency");
}
