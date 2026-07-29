import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { projectDiagnostics } from "../src/main/diagnostics.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("project diagnostics", () => {
  it("aggregates persisted turns without exposing conversation content", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-diagnostics-"));
    directories.push(root);
    const conversationDirectory = join(
      root,
      ".threadlight",
      "conversations",
    );
    mkdirSync(conversationDirectory, { recursive: true });
    writeFileSync(
      join(conversationDirectory, "thread-1.json"),
      JSON.stringify({
        messages: [
          { id: "user-1", role: "user", text: "secret prompt" },
          {
            id: "assistant-1",
            role: "assistant",
            text: "secret answer",
            diagnostics: diagnostic("completed", 12, 900, 120),
          },
          {
            id: "assistant-2",
            role: "assistant",
            text: "failed answer",
            diagnostics: diagnostic("failed", 4, 300, 0),
          },
        ],
      }),
    );

    const snapshot = projectDiagnostics(
      {
        id: "project-1",
        name: "Sample",
        basePath: root,
        lastOpenedAt: "2026-07-29T00:00:00.000Z",
        conversations: [
          {
            id: "thread-1",
            title: "Diagnose",
            createdAt: "2026-07-29T00:00:00.000Z",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
      },
      () => new Date("2026-07-29T12:00:00.000Z"),
    );

    expect(snapshot.totals).toEqual({
      turns: 2,
      failedTurns: 1,
      inputTokens: 10,
      outputTokens: 6,
      totalTokens: 16,
      durationMs: 1_200,
      modelSteps: 2,
      toolCalls: 2,
      toolDurationMs: 120,
    });
    expect(snapshot.turns[0]).toMatchObject({
      threadId: "thread-1",
      title: "Diagnose",
      model: "scripted",
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret prompt");
    expect(JSON.stringify(snapshot)).not.toContain("secret answer");
  });
});

function diagnostic(
  status: "completed" | "failed",
  totalTokens: number,
  durationMs: number,
  toolDurationMs: number,
) {
  return {
    status,
    startedAt: "2026-07-29T10:00:00.000Z",
    completedAt:
      status === "completed"
        ? "2026-07-29T10:00:01.000Z"
        : "2026-07-29T10:00:02.000Z",
    durationMs,
    model: "scripted",
    usage: {
      inputTokens: totalTokens - 3,
      outputTokens: 3,
      totalTokens,
    },
    modelSteps: [
      {
        step: 1,
        durationMs,
        usage: {
          inputTokens: totalTokens - 3,
          outputTokens: 3,
          totalTokens,
        },
      },
    ],
    toolCalls: [
      {
        callId: `${status}-tool`,
        name: "check",
        durationMs: toolDurationMs,
        isError: status === "failed",
      },
    ],
  };
}
