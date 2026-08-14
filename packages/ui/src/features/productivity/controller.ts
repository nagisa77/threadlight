import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  conversationMarkdown,
  exportFilename,
  loadComposerDraft,
  loadMessageBookmarks,
  saveComposerDraft,
  saveMessageBookmarks,
  taskShareReference,
  toggleMessageBookmark,
  type KeyValueStorage,
  type ProductivityMessage,
} from "./model.js";

export type DraftPersistenceStatus = "restored" | "saving" | "saved";

export function browserStorage(): KeyValueStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Owns the composer persistence lifecycle, including flushing the old scope
 * before restoring a newly selected task. */
export function usePersistedComposerDraft({
  scope,
  value,
  setValue,
  valueRef,
  storage = browserStorage(),
  delayMs = 350,
}: {
  scope?: string;
  value: string;
  setValue(value: string): void;
  valueRef: RefObject<string>;
  storage?: KeyValueStorage;
  delayMs?: number;
}): DraftPersistenceStatus | undefined {
  const activeScope = useRef<string | undefined>(undefined);
  const activeValue = useRef(value);
  const [status, setStatus] = useState<DraftPersistenceStatus>();

  if (activeScope.current === scope) activeValue.current = value;

  useLayoutEffect(() => {
    if (activeScope.current === scope) return;
    saveComposerDraft(storage, activeScope.current, activeValue.current);
    const restored = loadComposerDraft(storage, scope);
    activeScope.current = scope;
    activeValue.current = restored;
    valueRef.current = restored;
    setValue(restored);
    setStatus(restored ? "restored" : undefined);
  }, [scope, setValue, storage, valueRef]);

  useEffect(() => {
    if (!scope || activeScope.current !== scope) return;
    if (value !== activeValue.current) return;
    setStatus("saving");
    const timer = window.setTimeout(() => {
      saveComposerDraft(storage, scope, value);
      setStatus(value.trim() ? "saved" : undefined);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, scope, storage, value]);

  useEffect(
    () => () => {
      saveComposerDraft(storage, activeScope.current, activeValue.current);
    },
    [storage],
  );

  return status;
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useTaskProductivity({
  threadId,
  title,
  projectName,
  messages,
  writeClipboard,
  currentHref,
  storage = browserStorage(),
}: {
  threadId?: string;
  title: string;
  projectName?: string;
  messages: readonly ProductivityMessage[];
  writeClipboard(value: string): Promise<void>;
  currentHref?: string;
  storage?: KeyValueStorage;
}) {
  const [bookmarkedIds, setBookmarkedIds] = useState<readonly string[]>([]);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  useEffect(() => {
    setBookmarkedIds(loadMessageBookmarks(storage, threadId));
    setBookmarksOpen(false);
  }, [storage, threadId]);

  const bookmarkedMessages = messages.filter((message) =>
    bookmarkedIds.includes(message.id),
  );

  return {
    bookmarkedIds,
    bookmarkedMessages,
    bookmarksOpen,
    setBookmarksOpen,
    toggleBookmark(messageId: string) {
      if (!threadId) return;
      setBookmarkedIds((current) => {
        const next = toggleMessageBookmark(current, messageId);
        saveMessageBookmarks(storage, threadId, next);
        return next;
      });
    },
    copyReference() {
      return threadId
        ? writeClipboard(taskShareReference(threadId, currentHref))
        : Promise.resolve();
    },
    exportConversation() {
      if (!threadId) return;
      downloadMarkdown(
        exportFilename(title),
        conversationMarkdown({
          title,
          projectName,
          threadId,
          messages,
        }),
      );
    },
  };
}
