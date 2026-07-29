import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import {
  createModelProvider,
  CUSTOM_DEFAULT_BASE_URL,
  DOUBAO_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_BASE_URL,
  GROK_DEFAULT_BASE_URL,
  KIMI_DEFAULT_BASE_URL,
  OpenAICompatibleChatProvider,
} from "../src/index.js";

describe("createModelProvider", () => {
  it("allows a keyless custom OpenAI-compatible endpoint", () => {
    expect(() =>
      createModelProvider({
        provider: "custom",
        baseURL: "http://localhost:1234/v1",
        defaultModel: "local/model",
      }),
    ).not.toThrow();
  });

  it.each([
    {
      providerId: "kimi" as const,
      model: "kimi-k3",
      baseUrl: KIMI_DEFAULT_BASE_URL,
      expectedBaseUrl: "https://api.moonshot.ai/v1",
    },
    {
      providerId: "doubao" as const,
      model: "doubao-seed-2-0-pro-260215",
      baseUrl: DOUBAO_DEFAULT_BASE_URL,
      expectedBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    },
    {
      providerId: "gemini" as const,
      model: "gemini-3.6-flash",
      baseUrl: GEMINI_DEFAULT_BASE_URL,
      expectedBaseUrl:
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    },
    {
      providerId: "grok" as const,
      model: "grok-4.5",
      baseUrl: GROK_DEFAULT_BASE_URL,
      expectedBaseUrl: "https://api.x.ai/v1",
    },
    {
      providerId: "custom" as const,
      model: "local/model",
      baseUrl: CUSTOM_DEFAULT_BASE_URL,
      expectedBaseUrl: "http://127.0.0.1:11434/v1",
      expectedStateProvider: `custom:${CUSTOM_DEFAULT_BASE_URL}`,
    },
  ])(
    "creates an offline $providerId chat provider with preserved reasoning state",
    async ({
      providerId,
      model,
      baseUrl,
      expectedBaseUrl,
      ...entry
    }) => {
      const create = vi.fn().mockResolvedValue(
        chunks([
          {
            choices: [
              {
                delta: {
                  reasoning_content: "inspect the repository",
                  content: "Done",
                },
              },
            ],
          },
        ]),
      );
      const client = {
        chat: { completions: { create } },
      } as unknown as OpenAI;

      const provider = createModelProvider({
        provider: providerId,
        apiKey: "fixture-key",
        defaultModel: model,
        client,
      });
      const turn = await provider.generate({
        instructions: "Work carefully",
        input: "Fix the issue",
        tools: [],
      });

      expect(baseUrl).toBe(expectedBaseUrl);
      expect(provider).toBeInstanceOf(OpenAICompatibleChatProvider);
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        model,
        stream: true,
        messages: [
          { role: "system", content: "Work carefully" },
          { role: "user", content: "Fix the issue" },
        ],
      });
      expect(turn).toMatchObject({
        text: "Done",
        state: {
          protocol: "openai-compatible-chat",
          provider: entry.expectedStateProvider ?? providerId,
          messages: [
            { role: "system", content: "Work carefully" },
            { role: "user", content: "Fix the issue" },
            {
              role: "assistant",
              content: "Done",
              reasoning_content: "inspect the repository",
            },
          ],
        },
      });
    },
  );
});

async function* chunks(values: readonly unknown[]) {
  for (const value of values) yield value;
}
