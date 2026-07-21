import OpenAI from "openai";

import type {
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

  async generate(request: ModelRequest): Promise<ModelTurn> {
    const input: OpenAI.Responses.ResponseInput = Array.isArray(request.state)
      ? [...(request.state as OpenAI.Responses.ResponseInput)]
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

    const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: request.model ?? this.defaultModel,
      instructions: request.instructions,
      input,
      tools,
    };

    const response = request.signal
      ? await this.client.responses.create(params, { signal: request.signal })
      : await this.client.responses.create(params);

    return {
      text: response.output_text,
      toolCalls: response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          id: item.call_id,
          name: item.name,
          arguments: JSON.parse(item.arguments) as unknown,
        })),
      state: [...input, ...response.output],
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
