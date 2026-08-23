const EVENT_NAMES = new Set([
  "site_visited",
  "download_clicked",
  "install_command_copied",
  "install_succeeded",
  "first_task_completed",
]);
const EVENT_SOURCES = new Set(["website", "desktop", "self_host", "source"]);
const ALLOWED_ORIGINS = new Set([
  "https://threadlight.xyz",
  "https://www.threadlight.xyz",
  "https://nagisa77.github.io",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/events") {
      return handleProductEvent(request, env);
    }
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    return env.ASSETS.fetch(request);
  },
};

export async function handleProductEvent(request, env) {
  const corsHeaders = corsHeadersFor(request);
  if (corsHeaders === undefined) {
    return jsonError("Origin is not allowed", 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonError("Method not allowed", 405, corsHeaders);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return jsonError("Content-Type must be application/json", 415, corsHeaders);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    return jsonError("Invalid content length", 413, corsHeaders);
  }

  let input;
  try {
    const body = await request.text();
    const bodyLength = new TextEncoder().encode(body).byteLength;
    if (bodyLength < 2 || bodyLength > MAX_BODY_BYTES) {
      return jsonError("Invalid content length", 413, corsHeaders);
    }
    input = JSON.parse(body);
  } catch {
    return jsonError("Invalid JSON", 400, corsHeaders);
  }
  const event = parseEvent(input);
  if (!event) return jsonError("Invalid event", 400, corsHeaders);

  try {
    await env.TELEMETRY_DB.prepare(
      `INSERT OR IGNORE INTO product_events (
        event_id, anonymous_id, event_name, source, occurred_at,
        app_version, platform, path, variant
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        event.eventId,
        event.anonymousId,
        event.name,
        event.source,
        event.occurredAt,
        event.appVersion,
        event.platform,
        event.path,
        event.variant,
      )
      .run();
    return new Response(null, { status: 202, headers: corsHeaders });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "product telemetry insert failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return jsonError("Event could not be stored", 500, corsHeaders);
  }
}

export function parseEvent(input) {
  if (!isRecord(input) || input.schemaVersion !== 1) return;
  if (!isUuid(input.eventId) || !isUuid(input.anonymousId)) return;
  if (!EVENT_NAMES.has(input.name) || !EVENT_SOURCES.has(input.source)) return;
  if (!isIsoTimestamp(input.occurredAt)) return;
  const appVersion = optionalShortString(input.appVersion, 40);
  const platform = optionalShortString(input.platform, 40);
  const path = optionalShortString(input.path, 160);
  const variant = optionalShortString(input.variant, 40);
  if (
    appVersion === false ||
    platform === false ||
    path === false ||
    variant === false
  ) {
    return;
  }
  return {
    eventId: input.eventId,
    anonymousId: input.anonymousId,
    name: input.name,
    source: input.source,
    occurredAt: input.occurredAt,
    appVersion,
    platform,
    path,
    variant,
  };
}

function corsHeadersFor(request) {
  const origin = request.headers.get("origin");
  if (!origin) return new Headers();
  if (!isAllowedOrigin(origin)) return;
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
}

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function jsonError(message, status, headers = new Headers()) {
  headers.set("content-type", "application/json; charset=utf-8");
  if (status === 405) headers.set("allow", "POST, OPTIONS");
  return Response.json({ error: message }, { status, headers });
}

function optionalShortString(value, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return false;
  return normalized;
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
