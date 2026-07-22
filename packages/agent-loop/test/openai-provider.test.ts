import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import { OpenAIResponsesProvider } from "../src/openai-provider.js";

describe("OpenAIResponsesProvider", () => {
  it("uses the Responses stream and preserves the completed opaque state", async () => {
    let onTextDelta: ((event: { delta: string }) => void) | undefined;
    const response = {
      output_text: "Hello world",
      output: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "lookup",
          arguments: '{"query":"threadlight"}',
          parsed_arguments: { query: "threadlight" },
        },
        {
          type: "message",
          id: "message-1",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Hello world",
              annotations: [],
              logprobs: [],
              parsed: null,
            },
          ],
        },
      ],
      usage: {
        input_tokens: 3,
        output_tokens: 2,
        total_tokens: 5,
      },
    } as unknown as OpenAI.Responses.Response;
    const responseStream = {
      on(event: string, listener: (event: { delta: string }) => void) {
        expect(event).toBe("response.output_text.delta");
        onTextDelta = listener;
        return responseStream;
      },
      async finalResponse() {
        onTextDelta?.({ delta: "Hello" });
        await Promise.resolve();
        onTextDelta?.({ delta: " world" });
        return response;
      },
    };
    const stream = vi.fn(() => responseStream);
    const client = {
      responses: { stream },
    } as unknown as OpenAI;
    const signal = new AbortController().signal;
    const deltas: string[] = [];

    const result = await new OpenAIResponsesProvider({ client }).generate(
      {
        instructions: "Reply",
        input: "Hello",
        state: [
          {
            type: "function_call",
            call_id: "previous-call",
            name: "lookup",
            arguments: '{"query":"previous"}',
            parsed_arguments: null,
          },
        ],
        tools: [],
        signal,
      },
      {
        onEvent(event) {
          if (event.type === "output_text.delta") deltas.push(event.delta);
        },
      },
    );

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        instructions: "Reply",
        input: [
          {
            type: "function_call",
            call_id: "previous-call",
            name: "lookup",
            arguments: '{"query":"previous"}',
          },
          { role: "user", content: "Hello" },
        ],
      }),
      { signal },
    );
    expect(deltas).toEqual(["Hello", " world"]);
    expect(result).toMatchObject({
      text: "Hello world",
      toolCalls: [
        {
          id: "call-1",
          name: "lookup",
          arguments: { query: "threadlight" },
        },
      ],
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(result.state).toEqual([
      {
        type: "function_call",
        call_id: "previous-call",
        name: "lookup",
        arguments: '{"query":"previous"}',
      },
      { role: "user", content: "Hello" },
      {
        type: "function_call",
        call_id: "call-1",
        name: "lookup",
        arguments: '{"query":"threadlight"}',
      },
      {
        type: "message",
        id: "message-1",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Hello world",
            annotations: [],
            logprobs: [],
          },
        ],
      },
    ]);
  });
});
