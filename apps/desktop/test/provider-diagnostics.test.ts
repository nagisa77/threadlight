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
  it("tests the configured endpoint and verifies the selected model", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ data: [{ id: "gpt-test" }] }),
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
      endpoint: "https://api.openai.com/v1/models",
      checkedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer stored-secret" },
      }),
    );
  });

  it("classifies authentication failures and redacts provider details", async () => {
    const result = await testProviderConnection(
      {
        provider: "custom",
        model: "local-model",
        baseUrl: "https://user:password@example.com/v1?key=secret",
        apiKey: "sk-private",
      },
      settings,
      {
        fetch: async () =>
          Response.json(
            { error: { message: "Bad Bearer sk-private" } },
            { status: 401 },
          ),
      },
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
