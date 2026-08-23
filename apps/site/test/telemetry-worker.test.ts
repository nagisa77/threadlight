import { describe, expect, it, vi } from "vitest";

import worker, { handleProductEvent, parseEvent } from "../public/_worker.js";

const validEvent = {
  schemaVersion: 1,
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  anonymousId: "123e4567-e89b-42d3-a456-426614174001",
  name: "install_command_copied",
  occurredAt: "2026-08-23T12:00:00.000Z",
  source: "website",
  appVersion: "1.1.0",
  path: "/",
  variant: "host_web",
};

describe("product telemetry Pages worker", () => {
  it("stores a bounded anonymous event and returns 202", async () => {
    const run = vi.fn(async () => ({ success: true }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const request = jsonRequest(validEvent, "https://threadlight.xyz");

    const response = await handleProductEvent(request, {
      TELEMETRY_DB: { prepare },
    });

    expect(response.status).toBe(202);
    expect(prepare).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledWith(
      validEvent.eventId,
      validEvent.anonymousId,
      validEvent.name,
      validEvent.source,
      validEvent.occurredAt,
      validEvent.appVersion,
      null,
      validEvent.path,
      validEvent.variant,
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it("accepts a valid chunked request without a declared content length", async () => {
    const run = vi.fn(async () => ({ success: true }));
    const prepare = vi.fn(() => ({ bind: () => ({ run }) }));
    const response = await handleProductEvent(
      jsonRequest(validEvent, "https://threadlight.xyz", false),
      { TELEMETRY_DB: { prepare } },
    );

    expect(response.status).toBe(202);
    expect(run).toHaveBeenCalledOnce();
  });

  it("rejects unknown fields, malformed identifiers, and foreign origins", async () => {
    expect(parseEvent({ ...validEvent, name: "prompt_saved" })).toBeUndefined();
    expect(
      parseEvent({ ...validEvent, anonymousId: "user@example.com" }),
    ).toBeUndefined();

    const foreign = await handleProductEvent(
      jsonRequest(validEvent, "https://malicious.example"),
      { TELEMETRY_DB: { prepare: vi.fn() } },
    );
    expect(foreign.status).toBe(403);
  });

  it("serves static assets for non-API paths", async () => {
    const fetch = vi.fn(async () => new Response("homepage"));
    const response = await worker.fetch(
      new Request("https://threadlight.xyz/"),
      { ASSETS: { fetch } },
    );

    expect(await response.text()).toBe("homepage");
    expect(fetch).toHaveBeenCalledOnce();
  });
});

function jsonRequest(
  payload: unknown,
  origin?: string,
  includeContentLength = true,
): Request {
  const body = JSON.stringify(payload);
  return new Request("https://threadlight.xyz/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(includeContentLength
        ? { "content-length": String(Buffer.byteLength(body)) }
        : {}),
      ...(origin ? { origin } : {}),
    },
    body,
  });
}
