import { useCallback, useEffect, useState } from "react";

import type { SettingsSnapshot } from "./settings.js";

export interface ModelSelection {
  provider: string;
  model: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredConversationModelOverride {
  version: 1;
  settingsKey: string;
  selection: ModelSelection;
}

const CONVERSATION_MODEL_OVERRIDE_KEY =
  "threadlight:conversation-model-override:v1";

export function settingsModelSelection(
  settings: Pick<SettingsSnapshot, "provider" | "model"> | undefined,
): ModelSelection | undefined {
  const provider = settings?.provider?.trim();
  const model = settings?.model?.trim();
  return provider && model ? { provider, model } : undefined;
}

export function modelSelectionKey(
  selection: ModelSelection | undefined,
): string | undefined {
  return selection
    ? `${selection.provider}\u0000${selection.model}`
    : undefined;
}

export function resolveConversationModel({
  settings,
  storedOverride,
  fallback,
}: {
  settings: ModelSelection | undefined;
  storedOverride: StoredConversationModelOverride | undefined;
  fallback: ModelSelection | undefined;
}): ModelSelection | undefined {
  const settingsKey = modelSelectionKey(settings);
  return storedOverride && storedOverride.settingsKey === settingsKey
    ? storedOverride.selection
    : (settings ?? fallback);
}

export function resolveDraftModel({
  settings,
  draft,
  fallback,
}: {
  settings: ModelSelection | undefined;
  draft: ModelSelection | undefined;
  fallback: ModelSelection | undefined;
}): ModelSelection | undefined {
  return draft ?? settings ?? fallback;
}

export function loadConversationModelOverride(
  storage: StorageLike | undefined,
): StoredConversationModelOverride | undefined {
  if (!storage) return;
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(CONVERSATION_MODEL_OVERRIDE_KEY) ?? "null",
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== 1
    ) {
      return;
    }
    const candidate = parsed as Partial<StoredConversationModelOverride>;
    const selection = candidate.selection;
    return typeof candidate.settingsKey === "string" &&
      selection &&
      typeof selection.provider === "string" &&
      typeof selection.model === "string" &&
      selection.provider.trim() &&
      selection.model.trim()
      ? {
          version: 1,
          settingsKey: candidate.settingsKey,
          selection: {
            provider: selection.provider,
            model: selection.model,
          },
        }
      : undefined;
  } catch {
    return;
  }
}

function saveConversationModelOverride(
  storage: StorageLike | undefined,
  value: StoredConversationModelOverride | undefined,
): void {
  if (!storage) return;
  try {
    if (value) {
      storage.setItem(CONVERSATION_MODEL_OVERRIDE_KEY, JSON.stringify(value));
    } else {
      storage.removeItem(CONVERSATION_MODEL_OVERRIDE_KEY);
    }
  } catch {
    // The in-memory selection still works when browser storage is unavailable.
  }
}

export function useConversationModelController(
  settings: Pick<SettingsSnapshot, "provider" | "model"> | undefined,
  storage: StorageLike | undefined,
) {
  const settingsSelection = settingsModelSelection(settings);
  const settingsKey = modelSelectionKey(settingsSelection);
  const [storedOverride, setStoredOverride] = useState<
    StoredConversationModelOverride | undefined
  >(() => loadConversationModelOverride(storage));

  useEffect(() => {
    if (
      !storedOverride ||
      !settingsKey ||
      storedOverride.settingsKey === settingsKey
    ) {
      return;
    }
    setStoredOverride(undefined);
    saveConversationModelOverride(storage, undefined);
  }, [settingsKey, storage, storedOverride]);

  const setConversationModel = useCallback(
    (selection: ModelSelection) => {
      if (!settingsKey) return;
      const next: StoredConversationModelOverride = {
        version: 1,
        settingsKey,
        selection,
      };
      setStoredOverride(next);
      saveConversationModelOverride(storage, next);
    },
    [settingsKey, storage],
  );

  return {
    settingsModel: settingsSelection,
    conversationModel: resolveConversationModel({
      settings: settingsSelection,
      storedOverride,
      fallback: undefined,
    }),
    setConversationModel,
  };
}

export function useActiveModelSelection({
  settings,
  storage,
  newTaskDraft,
  draftModel,
  fallbackProvider,
  fallbackModel,
  threadId,
  updateThreadModel,
}: {
  settings: Pick<SettingsSnapshot, "provider" | "model"> | undefined;
  storage: StorageLike | undefined;
  newTaskDraft: boolean;
  draftModel: ModelSelection | undefined;
  fallbackProvider: string | undefined;
  fallbackModel: string | undefined;
  threadId: string | undefined;
  updateThreadModel(threadId: string, provider: string, model: string): void;
}) {
  const controller = useConversationModelController(settings, storage);
  const fallback =
    fallbackProvider && fallbackModel
      ? { provider: fallbackProvider, model: fallbackModel }
      : undefined;
  const active = newTaskDraft
    ? resolveDraftModel({
        settings: controller.settingsModel,
        draft: draftModel,
        fallback,
      })
    : (controller.conversationModel ?? fallback);
  const setConversationModel = useCallback(
    (selection: ModelSelection) => {
      controller.setConversationModel(selection);
      if (threadId) {
        updateThreadModel(threadId, selection.provider, selection.model);
      }
    },
    [controller, threadId, updateThreadModel],
  );
  return {
    selectedProvider: active?.provider,
    selectedModel: active?.model,
    setConversationModel,
  };
}
