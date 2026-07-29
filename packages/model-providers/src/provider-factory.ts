import type OpenAI from "openai";

import { OpenAICompatibleChatProvider } from "./openai-compatible-chat-provider.js";
import { OpenAIResponsesProvider } from "./openai-provider.js";
import type {
  ModelAttachment,
  ModelProvider,
} from "@threadlight/agent-loop";

export type ModelProviderId =
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "doubao"
  | "gemini"
  | "grok"
  | "custom";

export interface ModelProviderConfig {
  provider: ModelProviderId;
  apiKey?: string;
  defaultModel: string;
  baseURL?: string;
  client?: OpenAI;
}

export interface ConfiguredModelProvider extends ModelProvider {
  validateAttachment?(
    attachment: ModelAttachment,
  ): void | Promise<void>;
  uploadAttachment(
    attachment: ModelAttachment,
    signal?: AbortSignal,
  ): Promise<ModelAttachment>;
  prepareStateForPersistence(
    state: unknown,
    options: { maxBytes: number },
  ): unknown;
}

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const QWEN_DEFAULT_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const KIMI_DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";
export const DOUBAO_DEFAULT_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/v3";
export const GEMINI_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
export const GROK_DEFAULT_BASE_URL = "https://api.x.ai/v1";
export const CUSTOM_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

export function createModelProvider(
  config: ModelProviderConfig,
): ConfiguredModelProvider {
  if (config.provider === "openai") {
    return new OpenAIResponsesProvider({
      apiKey: config.apiKey,
      defaultModel: config.defaultModel,
      client: config.client,
    });
  }

  const baseURL = compatibleBaseUrl(config);
  return new OpenAICompatibleChatProvider({
    apiKey:
      config.provider === "custom"
        ? (config.apiKey ?? "threadlight-local")
        : config.apiKey,
    baseURL,
    defaultModel: config.defaultModel,
    provider: config.provider,
    ...(config.provider === "custom"
      ? { stateProvider: `custom:${baseURL}` }
      : {}),
    client: config.client,
  });
}

function compatibleBaseUrl(config: ModelProviderConfig): string {
  if (config.provider === "deepseek") return DEEPSEEK_BASE_URL;
  if (config.provider === "kimi") return config.baseURL ?? KIMI_DEFAULT_BASE_URL;
  if (config.provider === "doubao") {
    return config.baseURL ?? DOUBAO_DEFAULT_BASE_URL;
  }
  if (config.provider === "gemini") {
    return config.baseURL ?? GEMINI_DEFAULT_BASE_URL;
  }
  if (config.provider === "grok") return config.baseURL ?? GROK_DEFAULT_BASE_URL;
  if (config.provider === "custom") {
    return config.baseURL ?? CUSTOM_DEFAULT_BASE_URL;
  }
  return config.baseURL ?? QWEN_DEFAULT_BASE_URL;
}
