import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenAIResponsesProvider } from "../src/openai-provider.js";

describe("OpenAIResponsesProvider", () => {
  it("sends uploaded files by file_id without the mutually exclusive filename", async () => {
    const response = {
      output_text: "done",
      output: [],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    } as unknown as OpenAI.Responses.Response;
    const responseStream = {
      on() {
        return responseStream;
      },
      async finalResponse() {
        return response;
      },
    };
    const stream = vi.fn(() => responseStream);
    const client = { responses: { stream } } as unknown as OpenAI;

    await new OpenAIResponsesProvider({ client }).generate({
      instructions: "Inspect the file",
      input: "Summarize it",
      state: [
        {
          type: "function_call",
          call_id: "upload-1",
          name: "attach_to_model_context",
          arguments: '{"attachmentId":"attachment-1"}',
        },
      ],
      attachments: [
        {
          id: "attachment-1",
          name: "notes.txt",
          mimeType: "text/plain",
          size: 42,
          kind: "file",
          path: "/workspace/notes.txt",
          providerReference: {
            protocol: "openai-files",
            fileId: "file-1",
          },
        },
      ],
      toolResults: [
        {
          callId: "upload-1",
          name: "attach_to_model_context",
          output: '{"status":"attached"}',
        },
      ],
      tools: [],
    });

    const params = stream.mock.calls[0]?.[0] as OpenAI.Responses.ResponseCreateParams;
    expect(params.input).toEqual([
      {
        type: "function_call",
        call_id: "upload-1",
        name: "attach_to_model_context",
        arguments: '{"attachmentId":"attachment-1"}',
      },
      {
        type: "function_call_output",
        call_id: "upload-1",
        output: '{"status":"attached"}',
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Summarize it" },
          { type: "input_file", file_id: "file-1" },
        ],
      },
    ]);
    expect(JSON.stringify(params.input)).not.toContain("filename");
  });

  it("uses the Files API for attachments instead of inlining base64", async () => {
    const directory = mkdtempSync(join(tmpdir(), "threadlight-provider-"));
    const path = join(directory, "diagram.png");
    writeFileSync(path, Uint8Array.from([1, 2, 3]));
    const create = vi.fn(
      async (params: { file: NodeJS.ReadableStream; purpose: string }) => {
        for await (const _chunk of params.file) {
          // Consume the stream like the SDK upload request does.
        }
        return { id: "file-1" };
      },
    );
    const client = { files: { create } } as unknown as OpenAI;

    try {
      const result = await new OpenAIResponsesProvider({ client }).uploadAttachment({
        id: "attachment-1",
        name: "diagram.png",
        mimeType: "image/png",
        size: 3,
        kind: "image",
        path,
      });

      expect(create).toHaveBeenCalledOnce();
      expect(create.mock.calls[0]?.[0]).toMatchObject({ purpose: "user_data" });
      expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("base64");
      expect(result.providerReference).toEqual({
        protocol: "openai-files",
        fileId: "file-1",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "diagram.PNG",
      mimeType: "image/png",
      kind: "image" as const,
      error: "Expected image type to be a supported format",
    },
    {
      name: "song.mp3",
      mimeType: "audio/mpeg",
      kind: "file" as const,
      error: "Expected context stuffing file type to be a supported format",
    },
  ])("rejects unsupported $kind formats before uploading", async ({
    name,
    mimeType,
    kind,
    error,
  }) => {
    const create = vi.fn();
    const client = { files: { create } } as unknown as OpenAI;
    const provider = new OpenAIResponsesProvider({ client });

    await expect(
      provider.uploadAttachment({
        id: "attachment-1",
        name,
        mimeType,
        size: 3,
        kind,
        path: `/workspace/${name}`,
      }),
    ).rejects.toThrow(error);
    expect(create).not.toHaveBeenCalled();
  });

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

    const result = await new OpenAIResponsesProvider({
      client,
      defaultModel: "gpt-5.6-terra",
    }).generate(
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
        model: "gpt-5.6-terra",
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
