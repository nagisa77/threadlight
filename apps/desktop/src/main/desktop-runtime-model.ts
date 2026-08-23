import type { JsonRpcOutgoing } from "@threadlight/protocol";

import type { ProjectStore } from "./project-store.js";
import {
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_DOUBAO_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GROK_BASE_URL,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_QWEN_BASE_URL,
  runtimeEnvironment,
} from "./settings-store.js";
import type { WorktreeDeliveryManager } from "./worktree-delivery.js";

export function appServerEnvironment(
  projectRoot: string,
  settings: Parameters<typeof runtimeEnvironment>[0],
  scope?: "project" | "standalone",
): NodeJS.ProcessEnv {
  return {
    ...runtimeEnvironment(settings),
    THREADLIGHT_PROJECT_ROOT: projectRoot,
    ...(scope === "standalone" ? { THREADLIGHT_TASK_SCOPE: "standalone" } : {}),
  };
}

export function defaultAppServerSettings(): Parameters<
  typeof runtimeEnvironment
>[0] {
  return {
    provider: "openai",
    searchProvider: "brave",
    qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
    kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
    doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
    geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
    grokBaseUrl: DEFAULT_GROK_BASE_URL,
    customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
    model: DEFAULT_MODEL,
  };
}

export function processSessionIdFromMessage(
  message: JsonRpcOutgoing,
): string | undefined {
  if (!("method" in message) || message.method !== "agent/event") return;
  const event = (
    message.params as
      { event?: { type?: unknown; result?: { output?: unknown } } } | undefined
  )?.event;
  if (
    event?.type !== "tool.completed" ||
    typeof event.result?.output !== "string"
  ) {
    return;
  }
  try {
    const output = JSON.parse(event.result.output) as { sessionId?: unknown };
    return typeof output.sessionId === "string" ? output.sessionId : undefined;
  } catch {
    return;
  }
}

export async function reconcileLegacyNoChangesAttention(
  projects: ProjectStore,
  delivery: WorktreeDeliveryManager,
): Promise<void> {
  for (const project of projects.snapshot().projects) {
    for (const conversation of project.conversations) {
      if (
        conversation.status !== "attention" ||
        conversation.workspace?.mode !== "worktree"
      ) {
        continue;
      }
      try {
        if (
          await delivery.hasLegacyNoChangesFailure({
            projectId: project.id,
            threadId: conversation.id,
            projectPath: project.basePath,
          })
        ) {
          projects.markConversationCompleted({
            projectId: project.id,
            id: conversation.id,
          });
        }
      } catch {
        // A malformed legacy journal must not delay Desktop startup.
      }
    }
  }
}
