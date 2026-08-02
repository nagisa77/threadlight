import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileSuggestionStore } from "../src/suggestion-store.js";

const directories: string[] = [];
const HOUR_MS = 60 * 60 * 1_000;
const questions = [
  "Which architecture risk should we address first?",
  "Which missing test is most likely to hide a regression?",
  "What is the highest-value feature improvement?",
] as const;

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("FileSuggestionStore", () => {
  it("persists project questions and limits refresh claims by language", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-suggestions-"));
    directories.push(root);
    const path = join(root, ".threadlight", "suggestions.json");
    const firstStore = new FileSuggestionStore(path);
    const firstAttempt = new Date("2026-07-31T08:00:00.000Z");

    expect(
      firstStore.claimRefresh("en", firstAttempt, HOUR_MS),
    ).toEqual({
      status: "refresh",
      attemptedAt: firstAttempt.toISOString(),
    });
    firstStore.completeRefresh(
      "en",
      firstAttempt.toISOString(),
      new Date("2026-07-31T08:00:05.000Z"),
      questions,
    );

    const reopenedStore = new FileSuggestionStore(path);
    expect(
      reopenedStore.claimRefresh(
        "en",
        new Date("2026-07-31T08:59:59.999Z"),
        HOUR_MS,
      ),
    ).toEqual({ status: "cached", suggestions: questions });
    expect(
      reopenedStore.claimRefresh(
        "zh-CN",
        new Date("2026-07-31T08:30:00.000Z"),
        HOUR_MS,
      ),
    ).toMatchObject({ status: "refresh" });

    const nextAttempt = new Date("2026-07-31T09:00:00.000Z");
    expect(
      reopenedStore.claimRefresh("en", nextAttempt, HOUR_MS),
    ).toEqual({
      status: "refresh",
      attemptedAt: nextAttempt.toISOString(),
      staleSuggestions: questions,
    });

    const afterFailedRefresh = new FileSuggestionStore(path);
    expect(
      afterFailedRefresh.claimRefresh(
        "en",
        new Date("2026-07-31T09:30:00.000Z"),
        HOUR_MS,
      ),
    ).toEqual({ status: "cached", suggestions: questions });
    expect(existsSync(path)).toBe(true);
  });
});
