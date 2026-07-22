import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import { OpenAICompatibleChatProvider } from "../src/openai-compatible-chat-provider.js";

describe("OpenAICompatibleChatProvider", () => {
  it("streams text and preserves reasoning plus tool linkage across turns", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        chunks([
          {
            choices: [{ delta: { reasoning_content: "reasoning" } }],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: {
                        name: "double",
                        arguments: '{"value":',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: "21}" } },
                  ],
                },
              },
            ],
          },
          {
            choices: [],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 4,
              total_tokens: 12,
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        chunks([
          { choices: [{ delta: { content: "The answer is " } }] },
          { choices: [{ delta: { content: "42" } }] },
        ]),
      );
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = new OpenAICompatibleChatProvider({
      provider: "deepseek",
      baseURL: "https://api.deepseek.test",
      defaultModel: "deepseek-v4-pro",
      client,
    });

    const first = await provider.generate({
      instructions: "Use tools",
      input: "Double 21",
      tools: [
        {
          name: "double",
          description: "Double a number",
          parameters: { type: "object" },
        },
      ],
    });
    const deltas: string[] = [];
    const second = await provider.generate(
      {
        instructions: "Use tools",
        state: first.state,
        toolResults: [
          { callId: "call-1", name: "double", output: "42" },
        ],
        tools: [],
      },
      {
        onEvent: (event) => deltas.push(event.delta),
      },
    );

    expect(first).toMatchObject({
      toolCalls: [
        { id: "call-1", name: "double", arguments: { value: 21 } },
      ],
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
    expect(create.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "Use tools" },
      { role: "user", content: "Double 21" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "reasoning",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "double", arguments: '{"value":21}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "42" },
    ]);
    expect(deltas).toEqual(["The answer is ", "42"]);
    expect(second.text).toBe("The answer is 42");
  });

  it("does not replay opaque state from another provider", async () => {
    const create = vi.fn().mockResolvedValue(
      chunks([{ choices: [{ delta: { content: "Fresh" } }] }]),
    );
    const client = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = new OpenAICompatibleChatProvider({
      provider: "qwen",
      baseURL: "https://qwen.test/v1",
      defaultModel: "qwen3.7-plus",
      client,
    });

    await provider.generate({
      instructions: "Qwen instructions",
      input: "Hello",
      state: {
        protocol: "openai-compatible-chat",
        provider: "deepseek",
        messages: [{ role: "user", content: "private history" }],
      },
      tools: [],
    });

    expect(create.mock.calls[0]?.[0].messages).toEqual([
      { role: "system", content: "Qwen instructions" },
      { role: "user", content: "Hello" },
    ]);
  });
});

async function* chunks(values: readonly unknown[]) {
  for (const value of values) yield value;
}
