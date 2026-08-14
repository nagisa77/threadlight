export interface ProductivityMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly { name: string }[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DRAFT_PREFIX = "threadlight:composer-draft:v1:";
const BOOKMARK_PREFIX = "threadlight:message-bookmarks:v1:";

export function composerDraftScope(
  projectId: string | undefined,
  threadId: string | undefined,
  newTaskDraft: boolean,
): string | undefined {
  if (!projectId) return;
  return threadId && !newTaskDraft
    ? `thread:${threadId}`
    : `project:${projectId}:new-task`;
}

export function loadComposerDraft(
  storage: KeyValueStorage | undefined,
  scope: string | undefined,
): string {
  if (!storage || !scope) return "";
  try {
    return storage.getItem(`${DRAFT_PREFIX}${scope}`) ?? "";
  } catch {
    return "";
  }
}

export function saveComposerDraft(
  storage: KeyValueStorage | undefined,
  scope: string | undefined,
  value: string,
): void {
  if (!storage || !scope) return;
  try {
    if (value.trim()) storage.setItem(`${DRAFT_PREFIX}${scope}`, value);
    else storage.removeItem(`${DRAFT_PREFIX}${scope}`);
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
}

export function loadMessageBookmarks(
  storage: KeyValueStorage | undefined,
  threadId: string | undefined,
): readonly string[] {
  if (!storage || !threadId) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(`${BOOKMARK_PREFIX}${threadId}`) ?? "[]",
    );
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter(
              (value): value is string => typeof value === "string",
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

export function saveMessageBookmarks(
  storage: KeyValueStorage | undefined,
  threadId: string | undefined,
  messageIds: readonly string[],
): void {
  if (!storage || !threadId) return;
  try {
    if (messageIds.length > 0) {
      storage.setItem(
        `${BOOKMARK_PREFIX}${threadId}`,
        JSON.stringify([...new Set(messageIds)]),
      );
    } else {
      storage.removeItem(`${BOOKMARK_PREFIX}${threadId}`);
    }
  } catch {
    // Bookmarks remain usable in memory for the current session.
  }
}

export function toggleMessageBookmark(
  messageIds: readonly string[],
  messageId: string,
): readonly string[] {
  return messageIds.includes(messageId)
    ? messageIds.filter((id) => id !== messageId)
    : [...messageIds, messageId];
}

export interface ComposerHistoryNavigation {
  index: number;
  value: string;
  draft: string;
}

export function navigateComposerHistory({
  messages,
  current,
  draft,
  index,
  direction,
}: {
  messages: readonly Pick<ProductivityMessage, "role" | "text">[];
  current: string;
  draft: string;
  index: number;
  direction: "older" | "newer";
}): ComposerHistoryNavigation | undefined {
  const history = messages
    .filter((message) => message.role === "user" && message.text.trim())
    .map((message) => message.text)
    .reverse();
  if (history.length === 0) return;
  const preservedDraft = index < 0 ? current : draft;
  const nextIndex =
    direction === "older"
      ? Math.min(history.length - 1, index + 1)
      : Math.max(-1, index - 1);
  if (nextIndex === index) return;
  return {
    index: nextIndex,
    value: nextIndex < 0 ? preservedDraft : history[nextIndex]!,
    draft: preservedDraft,
  };
}

export function taskShareReference(
  threadId: string,
  currentHref?: string,
): string {
  if (currentHref) {
    try {
      const url = new URL(currentHref);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.hash = "";
        return url.toString();
      }
    } catch {
      // Fall through to a portable Threadlight task reference.
    }
  }
  return `threadlight:task:${threadId}`;
}

export function conversationMarkdown({
  title,
  projectName,
  threadId,
  messages,
}: {
  title: string;
  projectName?: string;
  threadId: string;
  messages: readonly ProductivityMessage[];
}): string {
  const metadata = [
    `# ${title.trim() || "Threadlight task"}`,
    "",
    projectName ? `- Project: ${projectName}` : undefined,
    `- Task: ${threadId}`,
    "",
  ].filter((line): line is string => line !== undefined);
  const transcript = messages.flatMap((message) => {
    const role = message.role === "user" ? "User" : "Threadlight";
    const attachments = (message.attachments ?? []).map(
      (attachment) => `- Attachment: ${attachment.name}`,
    );
    return [
      `## ${role}`,
      "",
      message.text || "_(No text)_",
      ...(attachments.length > 0 ? ["", ...attachments] : []),
      "",
    ];
  });
  return [...metadata, ...transcript].join("\n").trimEnd() + "\n";
}

export function exportFilename(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .replace(/[. ]+$/g, "");
  return `${safe || "threadlight-task"}.md`;
}
