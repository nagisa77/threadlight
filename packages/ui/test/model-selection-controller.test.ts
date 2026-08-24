import { describe, expect, it } from "vitest";

import {
  loadConversationModelOverride,
  modelSelectionKey,
  resolveConversationModel,
  resolveDraftModel,
  settingsModelSelection,
} from "../src/model-selection-controller.js";
import type { KeyValueStorage } from "../src/features/productivity/model.js";

const settingsModel = { provider: "custom", model: "stealth/ox-alpha" };

describe("conversation model selection", () => {
  it("uses the current settings model instead of a model stored on an old thread", () => {
    expect(
      resolveConversationModel({
        settings: settingsModel,
        storedOverride: undefined,
        fallback: { provider: "openai", model: "gpt-old" },
      }),
    ).toEqual(settingsModel);
  });

  it("applies one matching override to every existing conversation", () => {
    const storedOverride = {
      version: 1 as const,
      settingsKey: modelSelectionKey(settingsModel)!,
      selection: { provider: "deepseek", model: "deepseek-v4-pro" },
    };

    expect(
      resolveConversationModel({
        settings: settingsModel,
        storedOverride,
        fallback: { provider: "openai", model: "first-thread-model" },
      }),
    ).toEqual(storedOverride.selection);
    expect(
      resolveConversationModel({
        settings: settingsModel,
        storedOverride,
        fallback: { provider: "qwen", model: "second-thread-model" },
      }),
    ).toEqual(storedOverride.selection);
  });

  it("invalidates the global override synchronously when settings change", () => {
    expect(
      resolveConversationModel({
        settings: { provider: "openai", model: "gpt-5.6-sol" },
        storedOverride: {
          version: 1,
          settingsKey: modelSelectionKey(settingsModel)!,
          selection: { provider: "deepseek", model: "deepseek-v4-pro" },
        },
        fallback: { provider: "qwen", model: "thread-model" },
      }),
    ).toEqual({ provider: "openai", model: "gpt-5.6-sol" });
  });

  it("starts a new draft from settings rather than the conversation override", () => {
    expect(
      resolveDraftModel({
        settings: settingsModel,
        draft: undefined,
        fallback: { provider: "deepseek", model: "global-override" },
      }),
    ).toEqual(settingsModel);
    expect(
      resolveDraftModel({
        settings: settingsModel,
        draft: { provider: "qwen", model: "draft-choice" },
        fallback: undefined,
      }),
    ).toEqual({ provider: "qwen", model: "draft-choice" });
  });

  it("loads only a valid persisted override and trims empty settings", () => {
    const values = new Map<string, string>([
      [
        "threadlight:conversation-model-override:v1",
        JSON.stringify({
          version: 1,
          settingsKey: modelSelectionKey(settingsModel),
          selection: { provider: "deepseek", model: "deepseek-v4-pro" },
        }),
      ],
    ]);
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };

    expect(loadConversationModelOverride(storage)).toMatchObject({
      settingsKey: modelSelectionKey(settingsModel),
      selection: { provider: "deepseek", model: "deepseek-v4-pro" },
    });
    expect(
      settingsModelSelection({ provider: "custom", model: "   " }),
    ).toBeUndefined();
  });
});
