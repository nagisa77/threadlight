import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationChangeTracker } from "../src/main/conversation-changes.js";
import {
  projectDiagnosticBundle,
  projectDiagnostics,
} from "../src/main/diagnostics.js";

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

  it("exports redacted task conversations, timings, errors, and changed file bodies", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-bundle-"));
    const snapshots = mkdtempSync(join(tmpdir(), "threadlight-snapshots-"));
    directories.push(root, snapshots);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "config.ts"), "export const mode = 'before';\n");
    const tracker = new ConversationChangeTracker(snapshots);
    await tracker.ensureSnapshot("project-1", "thread-1", root);
    writeFileSync(
      join(root, "src", "config.ts"),
      "export const apiKey = 'sk-1234567890abcdefghijkl';\n",
    );
    const conversationDirectory = join(
      root,
      ".threadlight",
      "conversations",
    );
    mkdirSync(conversationDirectory, { recursive: true });
    writeFileSync(
      join(conversationDirectory, "thread-1.json"),
      JSON.stringify({
        version: 1,
        threadId: "thread-1",
        createdAt: "2026-08-07T01:00:00.000Z",
        updatedAt: "2026-08-07T01:00:02.000Z",
        provider: "scripted",
        model: "scripted-model",
        modelState: { never: "include-model-state" },
        agentSnapshot: { never: "include-agent-snapshot" },
        messages: [
          {
            id: "user-1",
            role: "user",
            text: `Inspect ${root}; Authorization: Bearer top-secret-token`,
            attachments: [
              {
                id: "attachment-1",
                name: "badcase.png",
                mimeType: "image/png",
                size: 42,
                kind: "image",
                path: "/Users/alice/private/badcase.png",
              },
            ],
          },
          {
            id: "assistant-1",
            role: "assistant",
            text: "Tool failed with password=hunter2",
            error: true,
            progress: [
              {
                text: "running",
                activities: [
                  {
                    id: "process-1",
                    name: "npm test",
                    status: "failed",
                    process: {
                      sessionId: "session-1",
                      command: "npm test",
                      cwd: root,
                      status: "failed",
                      exitCode: 2,
                      signal: null,
                      stdout: "",
                      stderr: "failed",
                      truncated: false,
                      startedAt: "2026-08-07T01:00:00.000Z",
                      completedAt: "2026-08-07T01:00:01.000Z",
                    },
                  },
                ],
              },
            ],
            diagnostics: {
              status: "failed",
              startedAt: "2026-08-07T01:00:00.000Z",
              completedAt: "2026-08-07T01:00:02.000Z",
              durationMs: 2_000,
              model: "scripted-model",
              usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
              modelSteps: [
                {
                  step: 1,
                  durationMs: 800,
                  usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
                },
              ],
              toolCalls: [
                {
                  callId: "tool-1",
                  name: "exec_command",
                  durationMs: 500,
                  isError: true,
                  errorCode: "command_failed",
                },
              ],
            },
          },
        ],
      }),
    );

    const bundle = await projectDiagnosticBundle(
      {
        id: "project-1",
        name: "Badcase Lab",
        basePath: root,
        scope: "project",
        conversations: [
          {
            id: "thread-1",
            title: "Broken test",
            workspace: { mode: "folder", path: root },
          },
        ],
      },
      {
        changes: tracker,
        environment: {
          runtime: "desktop",
          appVersion: "0.1.0",
          platform: "darwin",
          architecture: "arm64",
          nodeVersion: "v22.0.0",
          electronVersion: "38.0.0",
        },
        now: () => new Date("2026-08-07T02:03:04.000Z"),
      },
    );

    expect(bundle.filename).toBe(
      "threadlight-diagnostics-badcase-lab-20260807T020304Z.json",
    );
    expect(bundle.environment).toMatchObject({
      runtime: "desktop",
      platform: "darwin",
    });
    expect(bundle.conversations[0]?.messages).toHaveLength(2);
    expect(bundle.conversations[0]?.messages[0]).toMatchObject({
      text: "Inspect <workspace:thread-1>; Authorization: Bearer [REDACTED]",
      attachments: [{ name: "badcase.png" }],
    });
    expect(bundle.files[0]).toMatchObject({
      path: "src/config.ts",
      oldContent: "export const mode = 'before';\n",
      newContent: "export const apiKey = '[REDACTED]';\n",
    });
    expect(bundle.timeline.map(({ kind }) => kind)).toEqual([
      "turn",
      "model",
      "tool",
      "process",
    ]);
    expect(bundle.errors.map(({ code }) => code)).toEqual([
      "PROCESS_EXIT_2",
      "command_failed",
      "TURN_FAILED",
    ]);
    expect(bundle.redaction.count).toBeGreaterThanOrEqual(2);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("top-secret-token");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("sk-1234567890abcdefghijkl");
    expect(serialized).not.toContain("/Users/alice/private/badcase.png");
    expect(serialized).not.toContain("include-model-state");
    expect(serialized).not.toContain("include-agent-snapshot");
  });

  it("does not create a file snapshot while exporting diagnostics", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-bundle-readonly-"));
    const snapshots = mkdtempSync(join(tmpdir(), "threadlight-snapshots-"));
    directories.push(root, snapshots);
    const tracker = new ConversationChangeTracker(snapshots);

    const bundle = await projectDiagnosticBundle(
      {
        id: "project-1",
        name: "Readonly",
        basePath: root,
        conversations: [{ id: "thread-1", title: "No snapshot" }],
      },
      {
        changes: tracker,
        environment: {
          runtime: "host",
          platform: "linux",
          architecture: "x64",
          nodeVersion: "v22.0.0",
        },
      },
    );

    expect(bundle.files).toEqual([]);
    expect(bundle.warnings.join(" ")).toContain("no tracked file baseline");
    expect(JSON.stringify(bundle)).not.toContain(root);
    expect(existsSync(join(snapshots, "project-1", "thread-1"))).toBe(false);
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
