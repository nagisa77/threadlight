import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SuggestionLanguage } from "@threadlight/protocol";

export const DEFAULT_SUGGESTION_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

export type SuggestedQuestions = readonly [string, string, string];

interface SuggestionEntry {
  attemptedAt: string;
  generatedAt?: string;
  suggestions?: SuggestedQuestions;
}

export type SuggestionRefreshClaim =
  | {
      status: "cached";
      suggestions: SuggestedQuestions;
    }
  | {
      status: "throttled";
      suggestions?: SuggestedQuestions;
    }
  | {
      status: "refresh";
      attemptedAt: string;
      staleSuggestions?: SuggestedQuestions;
    };

export interface SuggestionStore {
  claimRefresh(
    language: SuggestionLanguage,
    now: Date,
    refreshIntervalMs: number,
  ): SuggestionRefreshClaim | Promise<SuggestionRefreshClaim>;
  completeRefresh(
    language: SuggestionLanguage,
    attemptedAt: string,
    generatedAt: Date,
    suggestions: SuggestedQuestions,
  ): void | Promise<void>;
}

export class MemorySuggestionStore implements SuggestionStore {
  private readonly entries = new Map<SuggestionLanguage, SuggestionEntry>();

  claimRefresh(
    language: SuggestionLanguage,
    now: Date,
    refreshIntervalMs: number,
  ): SuggestionRefreshClaim {
    const entry = this.entries.get(language);
    const claim = claimEntry(entry, now, refreshIntervalMs);
    if (claim.status === "refresh") {
      this.entries.set(language, {
        ...entry,
        attemptedAt: claim.attemptedAt,
      });
    }
    return claim;
  }

  completeRefresh(
    language: SuggestionLanguage,
    attemptedAt: string,
    generatedAt: Date,
    suggestions: SuggestedQuestions,
  ): void {
    const entry = this.entries.get(language);
    if (entry?.attemptedAt !== attemptedAt) return;
    this.entries.set(language, {
      attemptedAt,
      generatedAt: generatedAt.toISOString(),
      suggestions: [...suggestions] as [string, string, string],
    });
  }
}

interface StoredSuggestions {
  version: 1;
  languages: Partial<Record<SuggestionLanguage, SuggestionEntry>>;
}

const EMPTY_STORE: StoredSuggestions = {
  version: 1,
  languages: {},
};

export class FileSuggestionStore implements SuggestionStore {
  private readonly lockPath: string;

  constructor(private readonly path: string) {
    this.lockPath = `${path}.lock`;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }

  claimRefresh(
    language: SuggestionLanguage,
    now: Date,
    refreshIntervalMs: number,
  ): SuggestionRefreshClaim {
    return this.withLock(
      () => {
        const store = this.read();
        const entry = store.languages[language];
        const claim = claimEntry(entry, now, refreshIntervalMs);
        if (claim.status === "refresh") {
          store.languages[language] = {
            ...entry,
            attemptedAt: claim.attemptedAt,
          };
          this.write(store);
        }
        return claim;
      },
      () => {
        const entry = this.read().languages[language];
        return {
          status: "throttled",
          ...(entry?.suggestions
            ? { suggestions: cloneSuggestions(entry.suggestions) }
            : {}),
        };
      },
    );
  }

  completeRefresh(
    language: SuggestionLanguage,
    attemptedAt: string,
    generatedAt: Date,
    suggestions: SuggestedQuestions,
  ): void {
    this.withLock(
      () => {
        const store = this.read();
        if (store.languages[language]?.attemptedAt !== attemptedAt) return;
        store.languages[language] = {
          attemptedAt,
          generatedAt: generatedAt.toISOString(),
          suggestions: cloneSuggestions(suggestions),
        };
        this.write(store);
      },
      () => undefined,
    );
  }

  private read(): StoredSuggestions {
    let source: string;
    try {
      source = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return structuredClone(EMPTY_STORE);
      }
      throw error;
    }

    const value = JSON.parse(source) as unknown;
    if (!isStoredSuggestions(value)) {
      throw new Error("Suggestion cache has an unsupported format");
    }
    return value;
  }

  private write(store: StoredSuggestions): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(store, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporaryPath, this.path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private withLock<T>(run: () => T, busy: () => T): T {
    try {
      mkdirSync(this.lockPath, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (!this.removeStaleLock()) return busy();
      try {
        mkdirSync(this.lockPath, { mode: 0o700 });
      } catch (retryError) {
        if (isNodeError(retryError) && retryError.code === "EEXIST") {
          return busy();
        }
        throw retryError;
      }
    }

    try {
      return run();
    } finally {
      rmSync(this.lockPath, { recursive: true, force: true });
    }
  }

  private removeStaleLock(): boolean {
    try {
      const ageMs = Date.now() - statSync(this.lockPath).mtimeMs;
      if (ageMs < 10_000) return false;
      rmSync(this.lockPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return true;
      throw error;
    }
  }
}

function claimEntry(
  entry: SuggestionEntry | undefined,
  now: Date,
  refreshIntervalMs: number,
): SuggestionRefreshClaim {
  const attemptedAtMs = entry ? Date.parse(entry.attemptedAt) : Number.NaN;
  if (
    Number.isFinite(attemptedAtMs) &&
    now.getTime() - attemptedAtMs < refreshIntervalMs
  ) {
    return entry?.suggestions
      ? {
          status: "cached",
          suggestions: cloneSuggestions(entry.suggestions),
        }
      : { status: "throttled" };
  }

  return {
    status: "refresh",
    attemptedAt: now.toISOString(),
    ...(entry?.suggestions
      ? { staleSuggestions: cloneSuggestions(entry.suggestions) }
      : {}),
  };
}

function isStoredSuggestions(value: unknown): value is StoredSuggestions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const store = value as Record<string, unknown>;
  if (
    store.version !== 1 ||
    !store.languages ||
    typeof store.languages !== "object" ||
    Array.isArray(store.languages)
  ) {
    return false;
  }
  return Object.values(store.languages).every(isSuggestionEntry);
}

function isSuggestionEntry(value: unknown): value is SuggestionEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.attemptedAt === "string" &&
    Number.isFinite(Date.parse(entry.attemptedAt)) &&
    (entry.generatedAt === undefined ||
      (typeof entry.generatedAt === "string" &&
        Number.isFinite(Date.parse(entry.generatedAt)))) &&
    (entry.suggestions === undefined ||
      (Array.isArray(entry.suggestions) &&
        entry.suggestions.length === 3 &&
        entry.suggestions.every(
          (suggestion) =>
            typeof suggestion === "string" && suggestion.length > 0,
        )))
  );
}

function cloneSuggestions(
  suggestions: SuggestedQuestions,
): [string, string, string] {
  return [...suggestions];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
