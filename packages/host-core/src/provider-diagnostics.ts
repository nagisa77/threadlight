import type {
  HostModelProvider,
  HostProviderDiagnostic,
  HostProviderTestRequest,
} from "@threadlight/protocol";

import type { RuntimeSettings } from "./settings-store.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export interface ProviderDiagnosticOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export async function testProviderConnection(
  request: HostProviderTestRequest,
  settings: RuntimeSettings,
  options: ProviderDiagnosticOptions = {},
): Promise<HostProviderDiagnostic> {
  const now = options.now ?? (() => new Date());
  const checkedAt = now();
  const startedAt = performance.now();
  const baseUrl =
    request.baseUrl?.trim() || baseUrlFor(request.provider, settings);
  let modelsEndpoint = baseUrl;
  let generationEndpoint = baseUrl;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
    url.search = "";
    url.hash = "";
    modelsEndpoint = url.toString();
    url.pathname = `${new URL(baseUrl).pathname.replace(/\/+$/, "")}/${
      request.provider === "openai" ? "responses" : "chat/completions"
    }`;
    generationEndpoint = url.toString();
  } catch {
    return result(
      "error",
      "invalid_url",
      request,
      generationEndpoint,
      checkedAt,
      startedAt,
    );
  }
  const apiKey =
    request.apiKey === null
      ? undefined
      : request.apiKey?.trim() || apiKeyFor(request.provider, settings);
  if (!apiKey && request.provider !== "custom") {
    return result(
      "error",
      "missing_key",
      request,
      generationEndpoint,
      checkedAt,
      startedAt,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Provider connection test timed out")),
    options.timeoutMs ?? 30_000,
  );
  try {
    const fetcher = options.fetch ?? globalThis.fetch;
    const headers = {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    };
    let modelNotFound = false;
    try {
      const modelsResponse = await fetcher(modelsEndpoint, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      const modelsPayload = await safeJson(modelsResponse);
      const modelIds = modelsResponse.ok
        ? modelsFrom(modelsPayload)
        : undefined;
      modelNotFound = Boolean(modelIds && !modelIds.includes(request.model));
    } catch (error) {
      if (controller.signal.aborted) throw error;
      // Model discovery is optional. The generation probes below are authoritative.
    }

    const textResponse = await fetcher(generationEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(textProbeBody(request)),
      signal: controller.signal,
    });
    const textPayload = await safeJson(textResponse);
    if (!textResponse.ok) {
      return failedResponseResult(
        request,
        generationEndpoint,
        checkedAt,
        startedAt,
        textResponse,
        textPayload,
        apiKey,
      );
    }
    if (!hasVisibleText(request.provider, textPayload)) {
      return result(
        "error",
        "empty_response",
        request,
        generationEndpoint,
        checkedAt,
        startedAt,
        textResponse.status,
        "The provider accepted a text generation request but returned no visible content.",
      );
    }

    const toolResponse = await fetcher(generationEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(toolProbeBody(request)),
      signal: controller.signal,
    });
    const toolPayload = await safeJson(toolResponse);
    if (!toolResponse.ok) {
      return failedResponseResult(
        request,
        generationEndpoint,
        checkedAt,
        startedAt,
        toolResponse,
        toolPayload,
        apiKey,
      );
    }
    if (!hasProbeToolCall(request.provider, toolPayload)) {
      return result(
        "error",
        "tool_call_unsupported",
        request,
        generationEndpoint,
        checkedAt,
        startedAt,
        toolResponse.status,
        "Text generation succeeded, but the model did not return the forced tool call required by Threadlight.",
      );
    }
    return result(
      modelNotFound ? "warning" : "success",
      modelNotFound ? "model_not_found" : "ok",
      request,
      generationEndpoint,
      checkedAt,
      startedAt,
      toolResponse.status,
    );
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return result(
      "error",
      timedOut ? "timeout" : "network",
      request,
      generationEndpoint,
      checkedAt,
      startedAt,
      undefined,
      safeErrorDetail(error, apiKey),
    );
  } finally {
    clearTimeout(timeout);
  }
}

const PROVIDER_PROBE_TOOL = "threadlight_connection_probe";

function textProbeBody(request: HostProviderTestRequest): object {
  if (request.provider === "openai") {
    return {
      model: request.model,
      input: "Reply with exactly OK.",
      max_output_tokens: 64,
    };
  }
  return {
    model: request.model,
    messages: [{ role: "user", content: "Reply with exactly OK." }],
    max_tokens: 64,
    stream: false,
  };
}

function toolProbeBody(request: HostProviderTestRequest): object {
  const parameters = {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  };
  if (request.provider === "openai") {
    return {
      model: request.model,
      input: `Call ${PROVIDER_PROBE_TOOL} with value \"ok\".`,
      tools: [
        {
          type: "function",
          name: PROVIDER_PROBE_TOOL,
          description: "Verify model tool-calling compatibility.",
          parameters,
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: PROVIDER_PROBE_TOOL },
      max_output_tokens: 128,
    };
  }
  return {
    model: request.model,
    messages: [
      {
        role: "user",
        content: `Call ${PROVIDER_PROBE_TOOL} with value \"ok\".`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: PROVIDER_PROBE_TOOL,
          description: "Verify model tool-calling compatibility.",
          parameters,
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: PROVIDER_PROBE_TOOL },
    },
    max_tokens: 128,
    stream: false,
  };
}

function hasVisibleText(provider: HostModelProvider, value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (provider === "openai") {
    if (typeof value.output_text === "string" && value.output_text.trim()) {
      return true;
    }
    return (
      Array.isArray(value.output) &&
      value.output.some(
        (item) =>
          isRecord(item) &&
          Array.isArray(item.content) &&
          item.content.some(
            (content) =>
              isRecord(content) &&
              content.type === "output_text" &&
              typeof content.text === "string" &&
              Boolean(content.text.trim()),
          ),
      )
    );
  }
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return false;
  const content = choice.message.content;
  return typeof content === "string" && Boolean(content.trim());
}

function hasProbeToolCall(
  provider: HostModelProvider,
  value: unknown,
): boolean {
  if (!isRecord(value)) return false;
  if (provider === "openai") {
    return (
      Array.isArray(value.output) &&
      value.output.some(
        (item) =>
          isRecord(item) &&
          item.type === "function_call" &&
          item.name === PROVIDER_PROBE_TOOL,
      )
    );
  }
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return false;
  const toolCalls = Array.isArray(choice.message.tool_calls)
    ? choice.message.tool_calls
    : [];
  return toolCalls.some(
    (call) =>
      isRecord(call) &&
      isRecord(call.function) &&
      call.function.name === PROVIDER_PROBE_TOOL,
  );
}

function failedResponseResult(
  request: HostProviderTestRequest,
  endpoint: string,
  checkedAt: Date,
  startedAt: number,
  response: Response,
  payload: unknown,
  apiKey: string | undefined,
): HostProviderDiagnostic {
  return result(
    "error",
    codeForStatus(response.status),
    request,
    endpoint,
    checkedAt,
    startedAt,
    response.status,
    providerDetail(payload, apiKey),
  );
}

function result(
  status: HostProviderDiagnostic["status"],
  code: HostProviderDiagnostic["code"],
  request: HostProviderTestRequest,
  endpoint: string,
  checkedAt: Date,
  startedAt: number,
  httpStatus?: number,
  detail?: string,
): HostProviderDiagnostic {
  return {
    status,
    code,
    provider: request.provider,
    model: request.model,
    endpoint: safeEndpoint(endpoint),
    checkedAt: checkedAt.toISOString(),
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(detail ? { detail } : {}),
  };
}

function baseUrlFor(
  provider: HostModelProvider,
  settings: RuntimeSettings,
): string {
  if (provider === "openai") return OPENAI_BASE_URL;
  if (provider === "deepseek") return DEEPSEEK_BASE_URL;
  if (provider === "qwen") return settings.qwenBaseUrl;
  if (provider === "kimi") return settings.kimiBaseUrl;
  if (provider === "doubao") return settings.doubaoBaseUrl;
  if (provider === "gemini") return settings.geminiBaseUrl;
  if (provider === "grok") return settings.grokBaseUrl;
  return settings.customBaseUrl;
}

function apiKeyFor(
  provider: HostModelProvider,
  settings: RuntimeSettings,
): string | undefined {
  if (provider === "openai") return settings.openAIApiKey;
  if (provider === "deepseek") return settings.deepSeekApiKey;
  if (provider === "qwen") return settings.qwenApiKey;
  if (provider === "kimi") return settings.kimiApiKey;
  if (provider === "doubao") return settings.doubaoApiKey;
  if (provider === "gemini") return settings.geminiApiKey;
  if (provider === "grok") return settings.grokApiKey;
  return settings.customApiKey;
}

function codeForStatus(status: number): HostProviderDiagnostic["code"] {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  return "provider_error";
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return;
  }
}

function modelsFrom(value: unknown): readonly string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.data)) return;
  return value.data.flatMap((model) =>
    isRecord(model) && typeof model.id === "string" ? [model.id] : [],
  );
}

function providerDetail(
  value: unknown,
  apiKey: string | undefined,
): string | undefined {
  if (!isRecord(value)) return;
  const error = isRecord(value.error) ? value.error : value;
  return typeof error.message === "string"
    ? sanitizeDetail(error.message, apiKey)
    : undefined;
}

function safeErrorDetail(
  error: unknown,
  apiKey: string | undefined,
): string | undefined {
  return error instanceof Error
    ? sanitizeDetail(error.message, apiKey)
    : undefined;
}

function sanitizeDetail(value: string, apiKey: string | undefined): string {
  const redacted = apiKey ? value.split(apiKey).join("[redacted]") : value;
  return redacted
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 300);
}

function safeEndpoint(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.slice(0, 200);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
