import type { ConversationSummary } from "../../projects.js";

export type RestoredThreadRoute =
  { ready: false } | { ready: true; threadId?: string };

export function restoredThreadRoute(input: {
  restoreComplete: boolean;
  newTaskDraft: boolean;
  activeThreadId?: string;
  conversations?: readonly Pick<ConversationSummary, "id">[];
}): RestoredThreadRoute {
  if (!input.restoreComplete) return { ready: false };
  const threadId =
    !input.newTaskDraft &&
    input.activeThreadId &&
    input.conversations?.some((item) => item.id === input.activeThreadId)
      ? input.activeThreadId
      : undefined;
  return { ready: true, ...(threadId ? { threadId } : {}) };
}
