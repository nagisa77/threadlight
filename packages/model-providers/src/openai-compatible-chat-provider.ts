import OpenAI from "openai";

import type {
  JsonSchema,
  ModelGenerateOptions,
  ModelAttachment,
  ModelProvider,
  ModelRequest,
  ModelTurn,
  TokenUsage,
  ToolCall,
  ToolResult,
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
  /** Adapter-local stream replays after transient disconnects. */
  maxStreamRetries?: number;
  /** Adapter-local replays when a successful response has no usable payload. */
  maxEmptyResponseRetries?: number;
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
  private readonly maxEmptyResponseRetries: number;
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
    this.maxEmptyResponseRetries = boundedInteger(
      options.maxEmptyResponseRetries ?? 2,
      0,
      3,
    );
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

    let streamRetryAttempt = 0;
    let emptyResponseRetryAttempt = 0;
    while (true) {
      const pendingCalls = new Map<number, PendingToolCall>();
      let text = "";
      let reasoningContent = "";
      const reasoningDetails: unknown[] = [];
      let finishReason: string | undefined;
      let usage: Partial<TokenUsage> | undefined;
      const textStream = createToolAwareTextStream(
        request.tools.length > 0,
        options,
      );

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

          const choice = chunk.choices[0];
          if (typeof choice?.finish_reason === "string") {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;
          if (!delta) continue;

          if (delta.content) {
            text += delta.content;
            textStream.push(delta.content);
          }

          const rawDelta = delta as Record<string, unknown>;
          const reasoningDelta =
            rawDelta.reasoning_content ?? rawDelta.reasoning;
          if (typeof reasoningDelta === "string") {
            reasoningContent += reasoningDelta;
          }
          if (Array.isArray(rawDelta.reasoning_details)) {
            reasoningDetails.push(...rawDelta.reasoning_details);
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
          streamRetryAttempt < this.maxStreamRetries &&
          !request.signal?.aborted &&
          isTransientStreamError(error);
        if (!canRetry) throw error;

        streamRetryAttempt += 1;
        options.onEvent?.({
          type: "retry",
          retryAttempt: streamRetryAttempt,
          maxRetries: this.maxStreamRetries,
          reason: "connection_lost",
          ...(text.length > 0 ? { discardPartialOutput: true } : {}),
        });
        await waitForRetry(this.streamRetryDelayMs, request.signal);
        continue;
      }

      let toolCalls = [...pendingCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => ({
          id: call.id,
          name: call.name,
          ...parseToolArguments(call.arguments, call.name),
        }));
      const recovered =
        toolCalls.length === 0
          ? recoverTextToolCalls(
              text,
              request.tools.map(({ name }) => name),
            )
          : undefined;
      if (recovered) {
        text = recovered.text;
        toolCalls = recovered.toolCalls;
        textStream.finish(true);
      } else if (request.tools.length > 0 && looksLikeTextToolCall(text)) {
        textStream.finish(true);
        throw new Error(
          "Model returned a textual tool call that could not be converted to the native tool protocol.",
        );
      } else {
        textStream.finish(false);
      }
      if (!text.trim() && toolCalls.length === 0) {
        if (emptyResponseRetryAttempt < this.maxEmptyResponseRetries) {
          emptyResponseRetryAttempt += 1;
          options.onEvent?.({
            type: "retry",
            retryAttempt: emptyResponseRetryAttempt,
            maxRetries: this.maxEmptyResponseRetries,
            reason: "empty_response",
          });
          await waitForRetry(this.streamRetryDelayMs, request.signal);
          continue;
        }
        throw new Error(
          `${this.provider} returned no visible content or tool calls after ${emptyResponseRetryAttempt + 1} attempts${finishReason ? ` (finish reason: ${finishReason})` : ""}. The selected model may not support this provider's tool-calling protocol.`,
        );
      }
      const assistantMessage: ChatMessage = recovered
        ? {
            ...assistantHistoryMessage(text, toolCalls),
            ...(reasoningContent
              ? { reasoning_content: reasoningContent }
              : {}),
            ...(reasoningDetails.length > 0
              ? { reasoning_details: reasoningDetails }
              : {}),
          }
        : {
            role: "assistant",
            content: text || null,
            ...(reasoningContent
              ? { reasoning_content: reasoningContent }
              : {}),
            ...(reasoningDetails.length > 0
              ? { reasoning_details: reasoningDetails }
              : {}),
            ...(toolCalls.length > 0
              ? {
                  tool_calls: [...pendingCalls.entries()]
                    .sort(([left], [right]) => left - right)
                    .map(([, call]) => ({
                      id: call.id,
                      type: "function",
                      function: {
                        name: call.name,
                        arguments: call.arguments,
                      },
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
      ...chatMessagesFromHistory(history),
    ];
  }
}

function chatMessagesFromHistory(
  history: ModelRequest["history"],
): ChatMessage[] {
  return (history ?? []).flatMap((message) => {
    if (message.role === "assistant") {
      const legacy = message.toolCalls?.length
        ? undefined
        : parseLegacyToolCalls(message.text);
      const toolCalls = message.toolCalls ?? legacy?.toolCalls ?? [];
      const text = legacy?.text ?? message.text;
      if (!text.trim() && toolCalls.length === 0) return [];
      return [assistantHistoryMessage(text, toolCalls)];
    }

    const legacy = message.toolResults?.length
      ? undefined
      : parseLegacyToolResults(message.text);
    const toolResults = message.toolResults ?? legacy ?? [];
    if (toolResults.length > 0) {
      return toolResults.map(toolHistoryMessage);
    }
    return message.text.trim()
      ? [{ role: "user" as const, content: message.text }]
      : [];
  });
}

function assistantHistoryMessage(
  text: string,
  toolCalls: readonly ToolCall[],
): ChatMessage {
  return {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length > 0
      ? {
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: {
              name: call.name,
              arguments: serializeToolArguments(call.arguments),
            },
          })),
        }
      : {}),
  };
}

function toolHistoryMessage(result: ToolResult): ChatMessage {
  return {
    role: "tool",
    tool_call_id: result.callId,
    content: result.output,
  };
}

const TEXT_TOOL_CALL_MARKER = "<tool_call";
const LEGACY_TOOL_CALL_BLOCK =
  /<tool_call\s+([^>]*)>\r?\n?([\s\S]*?)\r?\n?<\/tool_call>/g;
const LEGACY_TOOL_RESULT_BLOCK =
  /<tool_result\s+([^>]*)>\r?\n?([\s\S]*?)\r?\n?<\/tool_result>/g;

function createToolAwareTextStream(
  toolsAvailable: boolean,
  options: ModelGenerateOptions,
): {
  push(delta: string): void;
  finish(recoveredToolCall: boolean): void;
} {
  let pending = "";
  let withholdingToolCall = false;
  const emit = (delta: string) => {
    if (delta) options.onEvent?.({ type: "output_text.delta", delta });
  };

  return {
    push(delta) {
      if (!toolsAvailable) {
        emit(delta);
        return;
      }
      pending += delta;
      if (withholdingToolCall) return;
      const markerIndex = pending.indexOf(TEXT_TOOL_CALL_MARKER);
      if (markerIndex >= 0) {
        emit(pending.slice(0, markerIndex));
        pending = pending.slice(markerIndex);
        withholdingToolCall = true;
        return;
      }
      const suffixLength = markerPrefixSuffixLength(pending);
      const safeLength = pending.length - suffixLength;
      emit(pending.slice(0, safeLength));
      pending = pending.slice(safeLength);
    },
    finish(recoveredToolCall) {
      if (!recoveredToolCall) emit(pending);
      pending = "";
    },
  };
}

function markerPrefixSuffixLength(value: string): number {
  const maximum = Math.min(value.length, TEXT_TOOL_CALL_MARKER.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (value.endsWith(TEXT_TOOL_CALL_MARKER.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function recoverTextToolCalls(
  source: string,
  availableToolNames: readonly string[],
): { text: string; toolCalls: ToolCall[] } | undefined {
  const parsed = parseLegacyToolCalls(source);
  if (!parsed) return;
  const available = new Set(availableToolNames);
  return parsed.toolCalls.every(({ name }) => available.has(name))
    ? parsed
    : undefined;
}

function looksLikeTextToolCall(source: string): boolean {
  return (
    source.includes(TEXT_TOOL_CALL_MARKER) &&
    source.includes("call_id=") &&
    source.includes("</tool_call>")
  );
}

function parseLegacyToolCalls(
  source: string,
): { text: string; toolCalls: ToolCall[] } | undefined {
  const toolCalls: ToolCall[] = [];
  let malformed = false;
  const text = source.replace(
    LEGACY_TOOL_CALL_BLOCK,
    (_block, attributes: string, body: string) => {
      const name = jsonAttribute(attributes, "name");
      const id = jsonAttribute(attributes, "call_id");
      if (!name || !id) {
        malformed = true;
        return _block;
      }
      toolCalls.push({
        id,
        name,
        ...parseToolArguments(body.trim(), name),
      });
      return "";
    },
  );
  return !malformed && toolCalls.length > 0
    ? { text: text.trim(), toolCalls }
    : undefined;
}

function parseLegacyToolResults(source: string): ToolResult[] | undefined {
  const toolResults: ToolResult[] = [];
  let malformed = false;
  const remainder = source.replace(
    LEGACY_TOOL_RESULT_BLOCK,
    (_block, attributes: string, body: string) => {
      const name = jsonAttribute(attributes, "name");
      const callId = jsonAttribute(attributes, "call_id");
      if (!name || !callId) {
        malformed = true;
        return _block;
      }
      toolResults.push({
        callId,
        name,
        output: trimBoundaryNewlines(body),
        ...(attributes.includes('error="true"') ? { isError: true } : {}),
      });
      return "";
    },
  );
  return !malformed && !remainder.trim() && toolResults.length > 0
    ? toolResults
    : undefined;
}

function jsonAttribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}=("(?:\\\\.|[^"\\\\])*")`).exec(
    attributes,
  );
  if (!match?.[1]) return;
  try {
    const value = JSON.parse(match[1]) as unknown;
    return typeof value === "string" ? value : undefined;
  } catch {
    return;
  }
}

function trimBoundaryNewlines(value: string): string {
  return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function serializeToolArguments(arguments_: unknown): string {
  try {
    return JSON.stringify(arguments_) ?? "{}";
  } catch {
    return "{}";
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
