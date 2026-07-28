import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenAIResponsesProvider } from "../src/openai-provider.js";

describe("OpenAIResponsesProvider", () => {
  it("runs the native computer tool protocol alongside function tools", async () => {
    const responses = [
      {
        output_text: "",
        output: [
          {
            type: "computer_call",
            id: "computer-item-1",
            call_id: "computer-call-1",
            actions: [
              { type: "screenshot" },
              { type: "click", x: 200, y: 120, button: "left", keys: [] },
            ],
            pending_safety_checks: [
              {
                id: "safety-1",
                code: "confirm_action",
                message: "Confirm the click",
              },
            ],
            status: "completed",
          },
        ],
      },
      {
        output_text: "done",
        output: [
          {
            type: "message",
            id: "message-1",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "done",
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
      },
    ] as unknown as OpenAI.Responses.Response[];
    const stream = vi.fn(() => {
      const response = responses.shift();
      if (!response) throw new Error("missing scripted response");
      const responseStream = {
        on() {
          return responseStream;
        },
        async finalResponse() {
          return response;
        },
      };
      return responseStream;
    });
    const client = { responses: { stream } } as unknown as OpenAI;
    const provider = new OpenAIResponsesProvider({ client });
    const tools = [
      {
        name: "computer",
        description: "Control the computer",
        parameters: {},
        kind: "computer" as const,
      },
      {
        name: "lookup",
        description: "Look up a value",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
    ];

    const first = await provider.generate({
      instructions: "Use tools",
      input: "Click the control",
      tools,
    });

    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      tools: [
        { type: "computer" },
        { type: "function", name: "lookup", strict: true },
      ],
    });
    expect(first.toolCalls).toEqual([
      {
        id: "computer-call-1",
        name: "computer",
        arguments: {
          actions: [
            { type: "screenshot" },
            {
              type: "click",
              x: 200,
              y: 120,
              button: "left",
              keys: [],
            },
          ],
          pendingSafetyChecks: [
            {
              id: "safety-1",
              code: "confirm_action",
              message: "Confirm the click",
            },
          ],
        },
      },
    ]);

    const second = await provider.generate({
      instructions: "Use tools",
      state: first.state,
      toolResults: [
        {
          callId: "computer-call-1",
          name: "computer",
          output: JSON.stringify({
            type: "computer_screenshot",
            imageUrl: "data:image/png;base64,iVBORw==",
            detail: "original",
            acknowledgedSafetyChecks: [
              {
                id: "safety-1",
                code: "confirm_action",
                message: "Confirm the click",
              },
            ],
          }),
        },
      ],
      tools,
    });

    const secondParams = stream.mock.calls[1]?.[0] as
      | OpenAI.Responses.ResponseCreateParams
      | undefined;
    expect(secondParams?.input).toEqual([
      { role: "user", content: "Click the control" },
      expect.objectContaining({
        type: "computer_call",
        call_id: "computer-call-1",
      }),
      {
        type: "computer_call_output",
        call_id: "computer-call-1",
        output: {
          type: "computer_screenshot",
          image_url: "data:image/png;base64,iVBORw==",
          detail: "original",
        },
        acknowledged_safety_checks: [
          {
            id: "safety-1",
            code: "confirm_action",
            message: "Confirm the click",
          },
        ],
      },
    ]);
    expect(second).toMatchObject({ text: "done", toolCalls: [] });
  });

  it("returns computer execution errors to the model so it can recover", async () => {
    const response = {
      output_text: "",
      output: [
        {
          type: "function_call",
          id: "function-item-1",
          call_id: "share-call-1",
          name: "computer_share",
          arguments:
            '{"action":"list","mode":null,"target_ids":null,"picture_in_picture":null,"input_mode":null}',
          status: "completed",
        },
      ],
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
    const provider = new OpenAIResponsesProvider({ client });
    const turn = await provider.generate({
      instructions: "Recover from tool errors",
      state: [
        {
          type: "computer_call_output",
          call_id: "previous-computer-call",
          output: {
            type: "computer_screenshot",
            image_url: "data:image/png;base64,iVBORw==",
          },
        },
        {
          type: "computer_call",
          call_id: "computer-call-2",
          actions: [{ type: "keypress", keys: ["CMD", "L"] }],
          pending_safety_checks: [
            {
              id: "safety-2",
              code: "confirm_action",
              message: "Confirm navigation",
            },
          ],
          status: "completed",
        },
      ],
      toolResults: [
        {
          callId: "computer-call-2",
          name: "computer",
          output:
            "No content is shared. Call computer_share list and set before using computer.",
          isError: true,
        },
      ],
      tools: [
        {
          name: "computer",
          description: "Control the computer",
          parameters: {},
          kind: "computer",
        },
        {
          name: "computer_share",
          description: "Select shared content",
          parameters: { type: "object" },
        },
      ],
    });

    const params = stream.mock.calls[0]?.[0] as
      | OpenAI.Responses.ResponseCreateParams
      | undefined;
    expect(params?.input).toEqual([
      expect.objectContaining({
        type: "computer_call_output",
        call_id: "previous-computer-call",
      }),
      expect.objectContaining({
        type: "computer_call",
        call_id: "computer-call-2",
      }),
      {
        type: "computer_call_output",
        call_id: "computer-call-2",
        status: "incomplete",
        output: {
          type: "computer_screenshot",
          image_url: expect.stringMatching(
            /^data:image\/png;base64,/,
          ),
        },
        acknowledged_safety_checks: [
          {
            id: "safety-2",
            code: "confirm_action",
            message: "Confirm navigation",
          },
        ],
      },
      {
        role: "developer",
        content: expect.stringContaining(
          "No content is shared. Call computer_share list and set",
        ),
      },
    ]);
    expect(turn.toolCalls).toEqual([
      {
        id: "share-call-1",
        name: "computer_share",
        arguments: {
          action: "list",
          mode: null,
          target_ids: null,
          picture_in_picture: null,
          input_mode: null,
        },
      },
    ]);
  });

  it("marks computer permission errors as requiring user action", async () => {
    const response = {
      output_text: "Follow the Threadlight permission prompt.",
      output: [],
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
      instructions: "Finish without tools",
      state: [
        {
          type: "computer_call",
          call_id: "computer-call-1",
          actions: [{ type: "click", x: 10, y: 20, button: "left" }],
          status: "completed",
        },
      ],
      toolResults: [
        {
          callId: "computer-call-1",
          name: "computer",
          output: "Accessibility permission is required",
          kind: "computer",
          isError: true,
          error: {
            code: "computer_permission_required",
            retryable: false,
            userAction: {
              kind: "grant_permission",
              data: { capability: "accessibility" },
            },
          },
        },
      ],
      tools: [],
    });

    const params = stream.mock.calls[0]?.[0] as
      | OpenAI.Responses.ResponseCreateParams
      | undefined;
    expect(params?.input).toContainEqual({
      role: "developer",
      content: expect.stringContaining(
        "Do not retry computer tools, change input modes, run shell commands",
      ),
    });
    expect(
      (params?.input as Array<{ content?: string }>).some((item) =>
        item.content?.includes("recoverable execution error"),
      ),
    ).toBe(false);
  });

  it("disables strict mode for open MCP-style argument objects", async () => {
    const response = {
      output_text: "done",
      output: [],
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
      instructions: "Use tools",
      tools: [
        {
          name: "closed",
          description: "Closed schema",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
        {
          name: "mcp_call",
          description: "Open arguments",
          parameters: {
            type: "object",
            properties: {
              arguments: {
                type: "object",
                additionalProperties: true,
              },
            },
            required: ["arguments"],
            additionalProperties: false,
          },
        },
      ],
    });

    const params = stream.mock.calls[0]?.[0] as OpenAI.Responses.ResponseCreateParams;
    expect(params.tools).toMatchObject([
      { name: "closed", strict: true },
      { name: "mcp_call", strict: false },
    ]);
  });

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

  it("redacts persisted computer screenshots and drops complete old turns to fit", () => {
    const provider = new OpenAIResponsesProvider({
      client: {} as OpenAI,
    });
    const sensitiveScreenshot =
      "data:image/png;base64," + "sensitive-pixels".repeat(200);
    const prepared = provider.prepareStateForPersistence(
      [
        { role: "user", content: "old question" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "old".repeat(600) }],
        },
        { role: "user", content: "current question" },
        {
          type: "computer_call_output",
          call_id: "computer-call-1",
          output: {
            type: "computer_screenshot",
            image_url: sensitiveScreenshot,
          },
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "current answer" }],
        },
      ],
      { maxBytes: 1_000 },
    );
    const serialized = JSON.stringify(prepared);

    expect(serialized).not.toContain("sensitive-pixels");
    expect(serialized).not.toContain("old question");
    expect(serialized).toContain("current question");
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(1_000);
  });
});
