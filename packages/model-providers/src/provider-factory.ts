import type OpenAI from "openai";

import { OpenAICompatibleChatProvider } from "./openai-compatible-chat-provider.js";
import { OpenAIResponsesProvider } from "./openai-provider.js";
import type { ModelProvider } from "@threadlight/agent-loop";

export type ModelProviderId = "openai" | "deepseek" | "qwen";

export interface ModelProviderConfig {
  provider: ModelProviderId;
  apiKey?: string;
  defaultModel: string;
  baseURL?: string;
  client?: OpenAI;
}

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const QWEN_DEFAULT_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

export function createModelProvider(
  config: ModelProviderConfig,
): ModelProvider {
  if (config.provider === "openai") {
    return new OpenAIResponsesProvider({
      apiKey: config.apiKey,
      defaultModel: config.defaultModel,
      client: config.client,
    });
  }

  return new OpenAICompatibleChatProvider({
    apiKey: config.apiKey,
    baseURL:
      config.provider === "deepseek"
        ? DEEPSEEK_BASE_URL
        : (config.baseURL ?? QWEN_DEFAULT_BASE_URL),
    defaultModel: config.defaultModel,
    provider: config.provider,
    client: config.client,
  });
}
