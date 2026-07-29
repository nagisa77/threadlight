import OpenAI from "openai";

import type {
  JsonSchema,
  ModelGenerateOptions,
  ModelAttachment,
  ModelProvider,
  ModelRequest,
  ModelTurn,
  TokenUsage,
} from "@threadlight/agent-loop";

interface ChatMessage extends Record<string, unknown> {
  role: "system" | "user" | "assistant" | "tool";
}

interface ChatProviderState {
  protocol: "openai-compatible-chat";
  provider: string;
  messages: ChatMessage[];
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface OpenAICompatibleChatProviderOptions {
  apiKey?: string;
  baseURL: string;
  defaultModel: string;
  provider: string;
  stateProvider?: string;
  client?: OpenAI;
}

/**
 * Adapter for providers that expose the OpenAI-compatible Chat Completions
 * wire protocol. Its state is tagged with the provider so opaque history is
 * never replayed to a different vendor after a settings change.
 */
export class OpenAICompatibleChatProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly provider: string;
  private readonly stateProvider: string;

  constructor(options: OpenAICompatibleChatProviderOptions) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
      });
    this.defaultModel = options.defaultModel;
    this.provider = options.provider;
    this.stateProvider = options.stateProvider ?? options.provider;
  }

  async uploadAttachment(
    _attachment: ModelAttachment,
  ): Promise<ModelAttachment> {
    throw new Error(
      `${this.provider} 当前不支持通过文件上传接口发送附件，请切换到 OpenAI。`,
    );
  }

  prepareStateForPersistence(
    state: unknown,
    options: { maxBytes: number },
  ): unknown {
    if (!isChatProviderState(state) || state.provider !== this.stateProvider) {
      return state;
    }
    let messages = state.messages.map((message) => ({ ...message }));
    let prepared: ChatProviderState = { ...state, messages };
    while (serializedBytes(prepared) > options.maxBytes) {
      const userIndexes = messages.flatMap((message, index) =>
        message.role === "user" ? [index] : [],
      );
      if (userIndexes.length < 2) break;
      const prefix = messages.filter(
        (message, index) =>
          index < userIndexes[0] && message.role === "system",
      );
      messages = [...prefix, ...messages.slice(userIndexes[1])];
      prepared = { ...state, messages };
    }
    return prepared;
  }

  async generate(
    request: ModelRequest,
    options: ModelGenerateOptions = {},
  ): Promise<ModelTurn> {
    if (request.attachments?.length) {
      throw new Error(
        `${this.provider} 当前不支持通过文件上传接口发送附件，请切换到 OpenAI。`,
      );
    }
    const messages = this.messagesFrom(request.state, request.instructions);

    if (request.input) {
      messages.push({ role: "user", content: request.input });
    }

    for (const result of request.toolResults ?? []) {
      messages.push({
        role: "tool",
        tool_call_id: result.callId,
        content: result.output,
      });
    }

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: request.model ?? this.defaultModel,
      messages:
        messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as JsonSchema,
              },
            })),
          }
        : {}),
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = request.signal
      ? await this.client.chat.completions.create(params, {
          signal: request.signal,
        })
      : await this.client.chat.completions.create(params);
    const pendingCalls = new Map<number, PendingToolCall>();
    let text = "";
    let reasoningContent = "";
    let usage: Partial<TokenUsage> | undefined;

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        options.onEvent?.({
          type: "output_text.delta",
          delta: delta.content,
        });
      }

      const reasoningDelta = (delta as Record<string, unknown>)[
        "reasoning_content"
      ];
      if (typeof reasoningDelta === "string") {
        reasoningContent += reasoningDelta;
      }

      for (const toolCall of delta.tool_calls ?? []) {
        const pending = pendingCalls.get(toolCall.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        if (toolCall.id) pending.id += toolCall.id;
        if (toolCall.function?.name) pending.name += toolCall.function.name;
        if (toolCall.function?.arguments) {
          pending.arguments += toolCall.function.arguments;
        }
        pendingCalls.set(toolCall.index, pending);
      }
    }

    const toolCalls = [...pendingCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => ({
        id: call.id,
        name: call.name,
        arguments: parseToolArguments(call.arguments, call.name),
      }));
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: text || null,
      ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      ...(toolCalls.length > 0
        ? {
            tool_calls: [...pendingCalls.entries()]
              .sort(([left], [right]) => left - right)
              .map(([, call]) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
          }
        : {}),
    };

    return {
      text,
      toolCalls,
      state: {
        protocol: "openai-compatible-chat",
        provider: this.stateProvider,
        messages: [...messages, assistantMessage],
      } satisfies ChatProviderState,
      usage,
    };
  }

  private messagesFrom(state: unknown, instructions: string): ChatMessage[] {
    if (isChatProviderState(state) && state.provider === this.stateProvider) {
      const messages = state.messages.map((message) => ({ ...message }));
      const system = messages.find((message) => message.role === "system");
      if (system) system.content = instructions;
      else messages.unshift({ role: "system", content: instructions });
      return messages;
    }

    return [{ role: "system", content: instructions }];
  }
}

function isChatProviderState(value: unknown): value is ChatProviderState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    state.protocol === "openai-compatible-chat" &&
    typeof state.provider === "string" &&
    Array.isArray(state.messages) &&
    state.messages.every(isChatMessage)
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const role = (value as Record<string, unknown>).role;
  return ["system", "user", "assistant", "tool"].includes(String(role));
}

function parseToolArguments(source: string, name: string): unknown {
  try {
    return JSON.parse(source || "{}") as unknown;
  } catch {
    throw new Error(`Model returned invalid JSON arguments for tool ${name}`);
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
