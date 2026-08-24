import { describe, expect, it, vi } from "vitest";

import { testProviderConnection } from "../src/main/provider-diagnostics.js";
import type { RuntimeSettings } from "../src/main/settings-store.js";

const settings: RuntimeSettings = {
  provider: "openai",
  openAIApiKey: "stored-secret",
  qwenBaseUrl: "https://qwen.example/v1",
  kimiBaseUrl: "https://kimi.example/v1",
  doubaoBaseUrl: "https://doubao.example/v1",
  geminiBaseUrl: "https://gemini.example/v1",
  grokBaseUrl: "https://grok.example/v1",
  customBaseUrl: "http://127.0.0.1:11434/v1",
  model: "gpt-test",
};

describe("provider diagnostics", () => {
  it("verifies authentication, text generation, and forced tool calling", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "gpt-test" }] }))
      .mockResolvedValueOnce(Response.json({ output_text: "OK" }))
      .mockResolvedValueOnce(
        Response.json({
          output: [
            {
              type: "function_call",
              name: "threadlight_connection_probe",
              arguments: '{"value":"ok"}',
            },
          ],
        }),
      );
    const result = await testProviderConnection(
      { provider: "openai", model: "gpt-test" },
      settings,
      {
        fetch,
        now: () => new Date("2026-07-29T12:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      status: "success",
      code: "ok",
      endpoint: "https://api.openai.com/v1/responses",
      checkedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer stored-secret",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"input":"Reply with exactly OK."'),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        body: expect.stringContaining("threadlight_connection_probe"),
      }),
    );
  });

  it("classifies generation authentication failures even when model listing is public", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "local-model" }] }))
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Bad Bearer sk-private" } },
          { status: 401 },
        ),
      );
    const result = await testProviderConnection(
      {
        provider: "custom",
        model: "local-model",
        baseUrl: "https://user:password@example.com/v1?key=secret",
        apiKey: "sk-private",
      },
      settings,
      { fetch },
    );

    expect(result).toMatchObject({
      status: "error",
      code: "unauthorized",
      httpStatus: 401,
      detail: "Bad Bearer [redacted]",
    });
    expect(result.endpoint).not.toContain("password");
    expect(result.endpoint).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("sk-private");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports successful-but-empty text responses", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "stealth/ox-alpha" }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: null } }],
        }),
      );

    const result = await testProviderConnection(
      {
        provider: "custom",
        model: "stealth/ox-alpha",
        baseUrl: "https://openrouter.example/api/v1",
        apiKey: "test-key",
      },
      settings,
      { fetch },
    );

    expect(result).toMatchObject({
      status: "error",
      code: "empty_response",
      endpoint: "https://openrouter.example/api/v1/chat/completions",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports models that generate text but ignore a forced tool call", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "stealth/ox-alpha" }] }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: "OK" } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: "Cannot call it" } }],
        }),
      );

    const result = await testProviderConnection(
      {
        provider: "custom",
        model: "stealth/ox-alpha",
        baseUrl: "https://openrouter.example/api/v1",
        apiKey: "test-key",
      },
      settings,
      { fetch },
    );

    expect(result).toMatchObject({
      status: "error",
      code: "tool_call_unsupported",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("reports missing keys before making a network request", async () => {
    const fetch = vi.fn();
    const result = await testProviderConnection(
      { provider: "deepseek", model: "deepseek-test", apiKey: null },
      settings,
      { fetch },
    );

    expect(result.code).toBe("missing_key");
    expect(fetch).not.toHaveBeenCalled();
  });
});
