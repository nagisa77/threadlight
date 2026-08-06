import { describe, expect, it, vi } from "vitest";

import { createRoutingModelProvider } from "../src/index.js";
import type { ConfiguredModelProvider } from "../src/provider-factory.js";

function backend(
  onGenerate: (provider: string, model: string | undefined) => void,
): ConfiguredModelProvider {
  return {
    async generate(request) {
      onGenerate(request.provider ?? "unset", request.model);
      return {
        text: `answered:${request.provider ?? "default"}`,
        toolCalls: [],
      };
    },
    prepareStateForPersistence(state) {
      return state;
    },
  };
}

describe("createRoutingModelProvider", () => {
  it("dispatches to the backend named by the request provider hint", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const openai = backend((provider, model) => seen.push([provider, model]));
    const deepseek = backend((provider, model) => seen.push([provider, model]));
    const router = createRoutingModelProvider({
      providers: { openai, deepseek },
      defaultProvider: "openai",
    });

    const turn = await router.generate({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      instructions: "Work",
      input: "hi",
      tools: [],
    });
    expect(turn.text).toBe("answered:deepseek");
    expect(seen).toEqual([["deepseek", "deepseek-v4-pro"]]);
  });

  it("falls back to the default backend when no hint is present", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const openai = backend((provider, model) => seen.push([provider, model]));
    const router = createRoutingModelProvider({
      providers: { openai },
      defaultProvider: "openai",
    });

    await router.generate({
      instructions: "Work",
      input: "hi",
      tools: [],
    });
    expect(seen).toEqual([["unset", undefined]]);
  });

  it("routes attachment uploads and state persistence by their provider tag", async () => {
    const upload = vi.fn(async () => ({}));
    const openai = {
      generate: vi.fn(async () => ({ text: "", toolCalls: [] })),
      uploadAttachment: upload,
      prepareStateForPersistence: vi.fn((state: unknown) => state),
    };
    const router = createRoutingModelProvider({
      providers: { openai },
      defaultProvider: "openai",
    });

    await router.uploadAttachment({
      id: "a",
      name: "a.png",
      mimeType: "image/png",
      size: 1,
      kind: "image",
      path: "/a.png",
      provider: "openai",
    });
    expect(upload).toHaveBeenCalledTimes(1);

    router.prepareStateForPersistence(
      { protocol: "openai-compatible-chat", provider: "openai", messages: [] },
      { maxBytes: 100 },
    );
    expect(openai.prepareStateForPersistence).toHaveBeenCalledTimes(1);
  });

  it("rejects generation when the hinted backend is missing", async () => {
    const router = createRoutingModelProvider({
      providers: {},
      defaultProvider: "openai",
    });
    await expect(
      router.generate({ instructions: "Work", input: "hi", tools: [] }),
    ).rejects.toThrow("No model provider is configured");
  });
});
