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
  /** One adapter-local replay is safe before any visible output or tool call. */
  maxStreamRetries?: number;
  streamRetryDelayMs?: number;
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
  private readonly maxStreamRetries: number;
  private readonly streamRetryDelayMs: number;

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
    this.maxStreamRetries = boundedInteger(options.maxStreamRetries ?? 1, 0, 3);
    this.streamRetryDelayMs = boundedInteger(
      options.streamRetryDelayMs ?? 500,
      0,
      30_000,
    );
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
    let messages = state.messages
      .filter(hasAssistantPayload)
      .map((message) => ({ ...message }));
    let prepared: ChatProviderState = { ...state, messages };
    while (serializedBytes(prepared) > options.maxBytes) {
      const userIndexes = messages.flatMap((message, index) =>
        message.role === "user" ? [index] : [],
      );
      if (userIndexes.length < 2) break;
      const prefix = messages.filter(
        (message, index) => index < userIndexes[0] && message.role === "system",
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
    const messages = this.messagesFrom(
      request.state,
      request.instructions,
      request.history,
    );

    // Tool results must immediately follow the assistant tool_calls message.
    // Injected user input is appended only after every pending call is closed.
    for (const result of request.toolResults ?? []) {
      messages.push({
        role: "tool",
        tool_call_id: result.callId,
        content: result.output,
      });
    }

    if (request.input) {
      messages.push({ role: "user", content: request.input });
    }

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
      {
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
              tool_choice: "auto",
            }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      };

    let retryAttempt = 0;
    while (true) {
      const pendingCalls = new Map<number, PendingToolCall>();
      let text = "";
      let reasoningContent = "";
      let usage: Partial<TokenUsage> | undefined;

      try {
        const stream = request.signal
          ? await this.client.chat.completions.create(params, {
              signal: request.signal,
            })
          : await this.client.chat.completions.create(params);

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
      } catch (error) {
        const canRetry =
          retryAttempt < this.maxStreamRetries &&
          text.length === 0 &&
          pendingCalls.size === 0 &&
          !request.signal?.aborted &&
          isTransientStreamError(error);
        if (!canRetry) throw error;

        retryAttempt += 1;
        options.onEvent?.({
          type: "retry",
          retryAttempt,
          maxRetries: this.maxStreamRetries,
          reason: "connection_lost",
        });
        await waitForRetry(this.streamRetryDelayMs, request.signal);
        continue;
      }

      const toolCalls = [...pendingCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => ({
          id: call.id,
          name: call.name,
          ...parseToolArguments(call.arguments, call.name),
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

      const stateMessages = hasAssistantPayload(assistantMessage)
        ? [...messages, assistantMessage]
        : messages;

      return {
        text,
        toolCalls,
        state: {
          protocol: "openai-compatible-chat",
          provider: this.stateProvider,
          messages: stateMessages,
        } satisfies ChatProviderState,
        usage,
      };
    }
  }

  private messagesFrom(
    state: unknown,
    instructions: string,
    history: ModelRequest["history"],
  ): ChatMessage[] {
    if (isChatProviderState(state) && state.provider === this.stateProvider) {
      const messages = state.messages
        .filter(hasAssistantPayload)
        .map((message) => ({ ...message }));
      const system = messages.find((message) => message.role === "system");
      if (system) system.content = instructions;
      else messages.unshift({ role: "system", content: instructions });
      return messages;
    }

    return [
      { role: "system", content: instructions },
      ...(history ?? []).flatMap(({ role, text }) =>
        role === "assistant" && !text.trim() ? [] : [{ role, content: text }],
      ),
    ];
  }
}

function hasAssistantPayload(message: ChatMessage): boolean {
  if (message.role !== "assistant") return true;
  const content = message.content;
  const hasContent =
    (typeof content === "string" && content.length > 0) ||
    (Array.isArray(content) && content.length > 0);
  const toolCalls = message.tool_calls;
  return hasContent || (Array.isArray(toolCalls) && toolCalls.length > 0);
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

function parseToolArguments(
  source: string,
  name: string,
): { arguments: unknown; argumentError?: string } {
  try {
    return { arguments: JSON.parse(source || "{}") as unknown };
  } catch {
    return {
      arguments: {},
      argumentError: `Model returned invalid JSON arguments for tool ${name}. Retry the tool call with one valid JSON object matching its schema.`,
    };
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function isTransientStreamError(error: unknown): boolean {
  const retryableStatuses = new Set([
    408, 409, 429, 500, 502, 503, 504, 524, 529,
  ]);
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);
  const retryableMessage =
    /\bterminated\b|fetch failed|socket hang up|premature close|other side closed|connection (?:reset|closed|lost)|network error/i;
  let candidate: unknown = error;

  for (let depth = 0; depth < 4 && candidate; depth += 1) {
    if (typeof candidate !== "object") break;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.status === "number" &&
      retryableStatuses.has(record.status)
    ) {
      return true;
    }
    if (typeof record.code === "string" && retryableCodes.has(record.code)) {
      return true;
    }
    if (
      typeof record.message === "string" &&
      retryableMessage.test(record.message)
    ) {
      return true;
    }
    candidate = record.cause;
  }
  return false;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
