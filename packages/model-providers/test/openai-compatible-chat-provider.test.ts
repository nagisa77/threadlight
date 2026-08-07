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
        history: [
          { role: "user", text: "This fallback must not be duplicated" },
        ],
        toolResults: [
          { callId: "call-1", name: "double", output: "42" },
        ],
        tools: [],
      },
      {
        onEvent: (event) => deltas.push(event.delta),
      },
    );

    expect(create.mock.calls[0]?.[0].tool_choice).toBe("auto");
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

  it("closes pending tool calls before appending injected user input", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        chunks([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-stale",
                      function: {
                        name: "write",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        chunks([{ choices: [{ delta: { content: "Re-evaluated" } }] }]),
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
      input: "Make the stale edit",
      tools: [
        {
          name: "write",
          description: "Write a file",
          parameters: { type: "object" },
        },
      ],
    });
    await provider.generate({
      instructions: "Use tools",
      input:
        "[Additional user instruction received while the run was active]\nDo not edit; explain instead",
      state: first.state,
      toolResults: [
        {
          callId: "call-stale",
          name: "write",
          output: "Skipped because the user added a newer instruction.",
          isError: true,
        },
      ],
      tools: [],
    });

    expect(create.mock.calls[1]?.[0].messages).toEqual([
      { role: "system", content: "Use tools" },
      { role: "user", content: "Make the stale edit" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-stale",
            type: "function",
            function: { name: "write", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call-stale",
        content: "Skipped because the user added a newer instruction.",
      },
      {
        role: "user",
        content:
          "[Additional user instruction received while the run was active]\nDo not edit; explain instead",
      },
    ]);
  });

  it("falls back to visible history instead of replaying another provider's state", async () => {
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
      history: [
        { role: "user", text: "Remember bluebird" },
        { role: "assistant", text: "I will remember bluebird" },
      ],
      tools: [],
    });

    expect(create.mock.calls[0]?.[0].messages).toEqual([
      { role: "system", content: "Qwen instructions" },
      { role: "user", content: "Remember bluebird" },
      { role: "assistant", content: "I will remember bluebird" },
      { role: "user", content: "Hello" },
    ]);
  });

  it("drops complete old chat turns before persistence when state exceeds the limit", () => {
    const provider = new OpenAICompatibleChatProvider({
      provider: "deepseek",
      baseURL: "https://api.deepseek.test",
      defaultModel: "deepseek-v4-pro",
      client: {} as OpenAI,
    });
    const prepared = provider.prepareStateForPersistence(
      {
        protocol: "openai-compatible-chat",
        provider: "deepseek",
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "old question" },
          { role: "assistant", content: "old".repeat(600) },
          { role: "user", content: "current question" },
          { role: "assistant", content: "current answer" },
        ],
      },
      { maxBytes: 500 },
    );
    const serialized = JSON.stringify(prepared);

    expect(serialized).toContain("System");
    expect(serialized).not.toContain("old question");
    expect(serialized).toContain("current question");
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(500);
  });
});

async function* chunks(values: readonly unknown[]) {
  for (const value of values) yield value;
}
