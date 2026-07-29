import type {
  DesktopModelProvider,
  DesktopProviderDiagnostic,
  DesktopProviderTestRequest,
} from "../shared/desktop-api.js";
import type { RuntimeSettings } from "./settings-store.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export interface ProviderDiagnosticOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export async function testProviderConnection(
  request: DesktopProviderTestRequest,
  settings: RuntimeSettings,
  options: ProviderDiagnosticOptions = {},
): Promise<DesktopProviderDiagnostic> {
  const now = options.now ?? (() => new Date());
  const checkedAt = now();
  const startedAt = performance.now();
  const baseUrl = request.baseUrl?.trim() || baseUrlFor(request.provider, settings);
  let endpoint = baseUrl;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
    url.search = "";
    url.hash = "";
    endpoint = url.toString();
  } catch {
    return result("error", "invalid_url", request, endpoint, checkedAt, startedAt);
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
      endpoint,
      checkedAt,
      startedAt,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Provider connection test timed out")),
    options.timeoutMs ?? 15_000,
  );
  try {
    const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    const payload = await safeJson(response);
    if (!response.ok) {
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
    const modelIds = modelsFrom(payload);
    if (modelIds && !modelIds.includes(request.model)) {
      return result(
        "warning",
        "model_not_found",
        request,
        endpoint,
        checkedAt,
        startedAt,
        response.status,
      );
    }
    return result(
      "success",
      "ok",
      request,
      endpoint,
      checkedAt,
      startedAt,
      response.status,
    );
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return result(
      "error",
      timedOut ? "timeout" : "network",
      request,
      endpoint,
      checkedAt,
      startedAt,
      undefined,
      safeErrorDetail(error, apiKey),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function result(
  status: DesktopProviderDiagnostic["status"],
  code: DesktopProviderDiagnostic["code"],
  request: DesktopProviderTestRequest,
  endpoint: string,
  checkedAt: Date,
  startedAt: number,
  httpStatus?: number,
  detail?: string,
): DesktopProviderDiagnostic {
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
  provider: DesktopModelProvider,
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
  provider: DesktopModelProvider,
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

function codeForStatus(
  status: number,
): DesktopProviderDiagnostic["code"] {
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

function sanitizeDetail(
  value: string,
  apiKey: string | undefined,
): string {
  const redacted = apiKey
    ? value.split(apiKey).join("[redacted]")
    : value;
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
