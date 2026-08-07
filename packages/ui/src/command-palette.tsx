import {
  Activity,
  CornerDownLeft,
  FileCode2,
  FileText,
  LoaderCircle,
  MessageSquareText,
  NotebookText,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useI18n } from "./i18n.js";
import { Dialog } from "./dialog.js";
import {
  isCommandPaletteShortcut,
  isFileSearchShortcut,
} from "./keyboard-shortcuts.js";

export type CommandPaletteMode = "all" | "files";

export interface SearchResult {
  id: string;
  kind: "message" | "file" | "command" | "tool" | "memory";
  projectId: string;
  threadId?: string;
  messageId?: string;
  activityId?: string;
  path?: string;
  line?: number;
  title: string;
  subtitle: string;
  snippet: string;
}

export interface SearchAdapter {
  search(
    projectId: string,
    threadId: string | undefined,
    query: string,
    mode: CommandPaletteMode,
  ): Promise<readonly SearchResult[]>;
}

export interface CommandPaletteEntry {
  id: string;
  kind: SearchResult["kind"] | "action" | "task";
  title: string;
  subtitle: string;
  snippet?: string;
  keywords?: string;
  actionId?: string;
  projectId?: string;
  threadId?: string;
  messageId?: string;
  activityId?: string;
  path?: string;
  line?: number;
}

export function CommandPalette({
  adapter,
  projectId,
  threadId,
  mode,
  actions,
  tasks,
  onModeChange,
  onSelect,
  onClose,
}: {
  adapter: SearchAdapter;
  projectId: string;
  threadId?: string;
  mode: CommandPaletteMode;
  actions: readonly CommandPaletteEntry[];
  tasks: readonly CommandPaletteEntry[];
  onModeChange(mode: CommandPaletteMode): void;
  onSelect(entry: CommandPaletteEntry): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const onSelectRef = useRef(onSelect);
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<readonly SearchResult[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [activeIndex, setActiveIndex] = useState(0);
  onSelectRef.current = onSelect;

  const entries = useMemo(() => {
    const remote = remoteResults.map(searchResultEntry);
    if (mode === "files") return remote;
    const local = [...actions, ...tasks].filter((entry) =>
      paletteEntryMatches(entry, query),
    );
    return orderPaletteEntries([...local, ...remote]);
  }, [actions, mode, query, remoteResults, tasks]);
  const resultKey = entries.map(({ id }) => id).join("\u0000");

  useEffect(() => {
    const operation = ++request.current;
    const normalized = query.trim();
    if (mode === "all" && !normalized) {
      setRemoteResults([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    const timer = window.setTimeout(() => {
      void adapter
        .search(projectId, threadId, normalized, mode)
        .then((results) => {
          if (operation === request.current) setRemoteResults(results);
        })
        .catch((reason) => {
          if (operation === request.current) {
            setRemoteResults([]);
            setError(errorMessage(reason));
          }
        })
        .finally(() => {
          if (operation === request.current) setLoading(false);
        });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [adapter, mode, projectId, query, threadId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mode, query, resultKey]);

  useEffect(() => {
    document
      .getElementById(`command-palette-result-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activeEntry = entries[activeIndex];
  return (
    <Dialog
      backdropClassName="command-palette-backdrop"
      className="command-palette"
      aria-labelledby="command-palette-title"
      initialFocusRef={input}
      onClose={onClose}
      onKeyDown={(event) => {
        if (isCommandPaletteShortcut(event.nativeEvent)) {
          event.preventDefault();
          onModeChange("all");
        } else if (isFileSearchShortcut(event.nativeEvent)) {
          event.preventDefault();
          onModeChange("files");
        }
      }}
    >
      <h2 id="command-palette-title" className="sr-only">
        {t("commandPalette")}
      </h2>
      <div className="command-palette-input">
        {loading ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : (
          <Search size={17} aria-hidden="true" />
        )}
        <input
          ref={input}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={
            activeEntry ? `command-palette-result-${activeIndex}` : undefined
          }
          placeholder={
            mode === "files" ? t("searchFilePaths") : t("searchEverything")
          }
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                entries.length ? (index + 1) % entries.length : 0,
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) =>
                entries.length
                  ? (index - 1 + entries.length) % entries.length
                  : 0,
              );
            } else if (event.key === "Enter" && activeEntry) {
              event.preventDefault();
              onSelectRef.current(activeEntry);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="command-palette-clear pressable"
            aria-label={t("clearSearch")}
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
        <kbd>esc</kbd>
      </div>
      <div className="command-palette-modes" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "all"}
          className={mode === "all" ? "active" : ""}
          onClick={() => {
            onModeChange("all");
            input.current?.focus();
          }}
        >
          {t("allResults")}
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "files"}
          className={mode === "files" ? "active" : ""}
          onClick={() => {
            onModeChange("files");
            input.current?.focus();
          }}
        >
          {t("files")}
          <kbd>⌘P</kbd>
        </button>
      </div>
      <div
        id="command-palette-results"
        className="command-palette-results"
        role="listbox"
        aria-label={t("searchResults")}
      >
        {error ? (
          <div className="command-palette-empty error">
            <Activity size={18} aria-hidden="true" />
            <span>{t("searchFailed")}</span>
            <small>{error}</small>
          </div>
        ) : entries.length === 0 && !loading ? (
          <div className="command-palette-empty">
            <Search size={19} aria-hidden="true" />
            <span>
              {query ? t("noSearchResults") : t("startTypingToSearch")}
            </span>
          </div>
        ) : (
          groupEntries(entries).map(([kind, group]) => (
            <section
              className="command-palette-group"
              role="group"
              aria-label={paletteGroupLabel(kind, t)}
              key={kind}
            >
              <h3 aria-hidden="true">{paletteGroupLabel(kind, t)}</h3>
              {group.map(({ entry, index }) => (
                <button
                  id={`command-palette-result-${index}`}
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`command-palette-result ${
                    index === activeIndex ? "active" : ""
                  }`}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => onSelect(entry)}
                >
                  <span className={`command-palette-icon ${entry.kind}`}>
                    {paletteIcon(entry.kind)}
                  </span>
                  <span className="command-palette-result-copy">
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.subtitle}</small>
                    </span>
                    {entry.snippet && <p>{entry.snippet}</p>}
                  </span>
                  {index === activeIndex && (
                    <CornerDownLeft size={13} aria-hidden="true" />
                  )}
                </button>
              ))}
            </section>
          ))
        )}
      </div>
      <footer className="command-palette-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t("navigate")}
        </span>
        <span>
          <kbd>↵</kbd> {t("open")}
        </span>
      </footer>
    </Dialog>
  );
}

export function paletteEntryMatches(
  entry: CommandPaletteEntry,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = [entry.title, entry.subtitle, entry.snippet, entry.keywords]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function searchResultEntry(result: SearchResult): CommandPaletteEntry {
  return { ...result };
}

function orderPaletteEntries(
  entries: readonly CommandPaletteEntry[],
): CommandPaletteEntry[] {
  const order: readonly CommandPaletteEntry["kind"][] = [
    "action",
    "task",
    "message",
    "command",
    "tool",
    "file",
    "memory",
  ];
  return [...entries].sort(
    (left, right) => order.indexOf(left.kind) - order.indexOf(right.kind),
  );
}

function groupEntries(entries: readonly CommandPaletteEntry[]): Array<
  [
    CommandPaletteEntry["kind"],
    Array<{
      entry: CommandPaletteEntry;
      index: number;
    }>,
  ]
> {
  const groups = new Map<
    CommandPaletteEntry["kind"],
    Array<{ entry: CommandPaletteEntry; index: number }>
  >();
  entries.forEach((entry, index) => {
    const group = groups.get(entry.kind) ?? [];
    group.push({ entry, index });
    groups.set(entry.kind, group);
  });
  return [...groups.entries()];
}

function paletteIcon(kind: CommandPaletteEntry["kind"]): ReactNode {
  if (kind === "action") return <Sparkles size={15} />;
  if (kind === "task") return <FileText size={15} />;
  if (kind === "message") return <MessageSquareText size={15} />;
  if (kind === "file") return <FileCode2 size={15} />;
  if (kind === "command") return <Terminal size={15} />;
  if (kind === "tool") return <Wrench size={15} />;
  return <NotebookText size={15} />;
}

function paletteGroupLabel(
  kind: CommandPaletteEntry["kind"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (kind === "action") return t("commands");
  if (kind === "task") return t("tasks");
  if (kind === "message") return t("messages");
  if (kind === "file") return t("files");
  if (kind === "command") return t("commandOutputs");
  if (kind === "tool") return t("tools");
  return t("projectMemory");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
