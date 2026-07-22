import OpenAI from "openai";

import type {
  ModelGenerateOptions,
  ModelProvider,
  ModelRequest,
  ModelTurn,
} from "./types.js";

export interface OpenAIResponsesProviderOptions {
  apiKey?: string;
  defaultModel?: string;
  client?: OpenAI;
}

export class OpenAIResponsesProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
      });
    this.defaultModel = options.defaultModel ?? "gpt-5.6-sol";
  }

  async generate(
    request: ModelRequest,
    options: ModelGenerateOptions = {},
  ): Promise<ModelTurn> {
    const input: OpenAI.Responses.ResponseInput = Array.isArray(request.state)
      ? sanitizeResponseInput(request.state)
      : [];

    if (request.input) {
      input.push({ role: "user", content: request.input });
    }

    for (const result of request.toolResults ?? []) {
      input.push({
        type: "function_call_output",
        call_id: result.callId,
        output: result.output,
      });
    }

    const tools: OpenAI.Responses.Tool[] = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    }));

    const params = {
      model: request.model ?? this.defaultModel,
      instructions: request.instructions,
      input,
      tools,
    };

    const stream = request.signal
      ? this.client.responses.stream(params, { signal: request.signal })
      : this.client.responses.stream(params);
    stream.on("response.output_text.delta", (event) => {
      options.onEvent?.({
        type: "output_text.delta",
        delta: event.delta,
      });
    });
    const response = await stream.finalResponse();
    const output = sanitizeResponseInput(response.output);

    return {
      text: response.output_text,
      toolCalls: response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          id: item.call_id,
          name: item.name,
          arguments: JSON.parse(item.arguments) as unknown,
        })),
      state: [...input, ...output],
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}

function sanitizeResponseInput(
  items: readonly unknown[],
): OpenAI.Responses.ResponseInput {
  return items.map((item) => {
    if (!isObject(item)) return item;

    if (item.type === "function_call") {
      const { parsed_arguments: _parsedArguments, ...wireItem } = item;
      return wireItem;
    }

    if (item.type === "message" && Array.isArray(item.content)) {
      return {
        ...item,
        content: item.content.map((content) => {
          if (!isObject(content) || content.type !== "output_text") {
            return content;
          }
          const { parsed: _parsed, ...wireContent } = content;
          return wireContent;
        }),
      };
    }

    return item;
  }) as OpenAI.Responses.ResponseInput;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
