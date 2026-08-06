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
  qualifier: string;
  description: string;
}

export interface ProviderOption {
  value: ModelProviderId;
  label: string;
  description: string;
  keyLabel: string;
  keyDescription: string;
  defaultModel: string;
  models: readonly ModelOption[];
}

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    value: "openai",
    label: "OpenAI",
    description: "使用 OpenAI Responses API，适合 GPT 系列模型。",
    keyLabel: "OpenAI API Key",
    keyDescription: "用于 OpenAI 模型请求和语音输入转写，通常以 sk- 开头。",
    defaultModel: "gpt-5.6-sol",
    models: [
      {
        value: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        qualifier: "性能优先",
        description: "适合复杂推理和编程任务，优先获得最佳质量。",
      },
      {
        value: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        qualifier: "均衡",
        description: "在能力、速度和成本之间取得平衡。",
      },
      {
        value: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        qualifier: "成本优先",
        description: "适合成本敏感的高频和轻量任务。",
      },
      {
        value: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        qualifier: "强力 mini",
        description: "更快的编程和工具调用模型，兼顾能力与成本。",
      },
      {
        value: "gpt-5-mini",
        label: "GPT-5 mini",
        qualifier: "经济 mini",
        description: "适合目标清晰、低延迟和高吞吐的任务。",
      },
      {
        value: "gpt-4.1-mini",
        label: "GPT-4.1 mini",
        qualifier: "低延迟 mini",
        description: "无额外推理步骤，擅长指令遵循和工具调用。",
      },
    ],
  },
  {
    value: "kimi",
    label: "Kimi",
    description: "直连 Moonshot AI 开放平台，支持 Kimi K3 与 K2 系列。",
    keyLabel: "Moonshot API Key",
    keyDescription: "用于 Kimi 模型请求。",
    defaultModel: "kimi-k3",
    models: [
      {
        value: "kimi-k3",
        label: "Kimi K3",
        qualifier: "性能优先",
        description: "旗舰模型，适合长程编程、知识工作和深度推理。",
      },
      {
        value: "kimi-k2.6",
        label: "Kimi K2.6",
        qualifier: "均衡",
        description:
          "成熟的 256K 上下文 Agent 模型，支持编程、推理与工具调用。",
      },
      {
        value: "kimi-k2.5",
        label: "Kimi K2.5",
        qualifier: "上一代",
        description: "上一代模型，适合需要兼容既有工作流的任务。",
      },
    ],
  },
  {
    value: "doubao",
    label: "豆包",
    description: "通过火山方舟 OpenAI 兼容接口使用豆包 Seed 系列。",
    keyLabel: "Ark API Key",
    keyDescription: "用于火山方舟在线推理请求。",
    defaultModel: "doubao-seed-2-0-pro-260215",
    models: [
      {
        value: "doubao-seed-2-0-pro-260215",
        label: "Doubao Seed 2.0 Pro",
        qualifier: "性能优先",
        description: "旗舰 Agent 模型，适合复杂推理和长链路任务。",
      },
      {
        value: "doubao-seed-2-0-code-preview-260215",
        label: "Doubao Seed 2.0 Code",
        qualifier: "编程优化",
        description: "面向代码生成、调试和仓库级开发任务。",
      },
      {
        value: "doubao-seed-2-0-lite-260215",
        label: "Doubao Seed 2.0 Lite",
        qualifier: "均衡",
        description: "兼顾能力、速度和 Token 消耗，适合多数 Agent 任务。",
      },
    ],
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "通过 Google Gemini API 的 OpenAI 兼容接口调用 Gemini。",
    keyLabel: "Gemini API Key",
    keyDescription: "用于 Google AI Studio / Gemini API 模型请求。",
    defaultModel: "gemini-3.6-flash",
    models: [
      {
        value: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro Preview",
        qualifier: "性能优先",
        description: "适合高难度推理、编程和复杂 Agent 任务。",
      },
      {
        value: "gemini-3.6-flash",
        label: "Gemini 3.6 Flash",
        qualifier: "均衡",
        description: "最新稳定 Flash 模型，兼顾智能、速度和成本。",
      },
      {
        value: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite",
        qualifier: "成本优先",
        description: "面向低成本、高吞吐和轻量任务。",
      },
    ],
  },
  {
    value: "grok",
    label: "Grok",
    description: "直连 xAI API，支持 Grok 推理、编程与工具调用。",
    keyLabel: "xAI API Key",
    keyDescription: "用于 xAI Grok 模型请求。",
    defaultModel: "grok-4.5",
    models: [
      {
        value: "grok-4.5",
        label: "Grok 4.5",
        qualifier: "性能优先",
        description: "面向编程、Agent 和知识工作的旗舰模型。",
      },
      {
        value: "grok-build-0.1",
        label: "Grok Build 0.1",
        qualifier: "编程优化",
        description: "针对 Agent 编程与 Web 开发优化。",
      },
      {
        value: "grok-4.3",
        label: "Grok 4.3",
        qualifier: "均衡",
        description: "长上下文通用模型，兼顾能力与成本。",
      },
    ],
  },
  {
    value: "custom",
    label: "自定义",
    description: "连接任意 OpenAI 兼容的本地、自建或代理服务。",
    keyLabel: "API Key（可选）",
    keyDescription: "本地服务通常无需密钥；远程服务可按需填写。",
    defaultModel: "llama3.2",
    models: [
      {
        value: "llama3.2",
        label: "自定义模型",
        qualifier: "手动配置",
        description: "输入服务实际提供的模型 ID。",
      },
    ],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    description: "直连 DeepSeek API，支持推理和工具调用。",
    keyLabel: "DeepSeek API Key",
    keyDescription: "用于 DeepSeek 模型请求。",
    defaultModel: "deepseek-v4-pro",
    models: [
      {
        value: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        qualifier: "性能优先",
        description: "面向复杂推理、编程和长上下文 Agent 任务。",
      },
      {
        value: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        qualifier: "速度优先",
        description: "更低延迟和成本，适合日常 Agent 与高频任务。",
      },
    ],
  },
  {
    value: "qwen",
    label: "阿里云百炼 · 千问",
    description: "通过百炼 OpenAI 兼容接口使用千问模型。",
    keyLabel: "百炼 API Key",
    keyDescription: "用于阿里云百炼模型请求；密钥与服务地域对应。",
    defaultModel: "qwen3.7-plus",
    models: [
      {
        value: "qwen3.7-max",
        label: "Qwen3.7 Max",
        qualifier: "性能优先",
        description: "适合复杂、多步骤推理和高难度 Agent 任务。",
      },
      {
        value: "qwen3.7-plus",
        label: "Qwen3.7 Plus",
        qualifier: "均衡",
        description: "在能力、速度和成本之间取得平衡，适合多数任务。",
      },
      {
        value: "qwen3.6-flash",
        label: "Qwen3.6 Flash",
        qualifier: "低延迟",
        description: "面向简单、高频任务，优先响应速度与成本。",
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
  if (provider === "custom") return t("providerCustomLabel");
  return providerDetails(provider).label;
}

export function modelDescription(
  provider: ModelProviderId,
  model: string,
  t: Translate,
): string {
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
  return (
    (key ? t(key) : undefined) ??
    providerDetails(provider).models.find((option) => option.value === model)
      ?.description ??
    t("externalModelDescription")
  );
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
