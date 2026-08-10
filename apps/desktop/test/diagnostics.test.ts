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
    const conversationDirectory = join(root, ".threadlight", "conversations");
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

  it("uses total scoped metrics when aggregating multi-agent turns", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-diagnostics-scoped-"));
    directories.push(root);
    const conversationDirectory = join(root, ".threadlight", "conversations");
    mkdirSync(conversationDirectory, { recursive: true });
    const rootStep = {
      step: 1,
      durationMs: 100,
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
      agentId: "root-agent",
      agentRole: "root",
    };
    const childSteps = [
      {
        step: 1,
        durationMs: 80,
        usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
        agentId: "child-agent",
        agentRole: "explorer",
      },
      {
        step: 2,
        durationMs: 70,
        usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
        agentId: "child-agent",
        agentRole: "explorer",
      },
    ];
    const rootTool = {
      callId: "spawn-agent",
      name: "spawn_agent",
      durationMs: 2,
      isError: false,
      agentId: "root-agent",
      agentRole: "root",
    };
    const childTool = {
      callId: "inspect",
      name: "workspace_inspect",
      durationMs: 3,
      isError: false,
      agentId: "child-agent",
      agentRole: "explorer",
    };
    writeFileSync(
      join(conversationDirectory, "thread-1.json"),
      JSON.stringify({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            text: "done",
            diagnostics: {
              status: "completed",
              startedAt: "2026-08-08T00:00:00.000Z",
              completedAt: "2026-08-08T00:00:01.000Z",
              durationMs: 1_000,
              usage: { inputTokens: 13, outputTokens: 3, totalTokens: 16 },
              modelSteps: [rootStep],
              toolCalls: [rootTool],
              metrics: {
                root: {
                  usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
                  modelSteps: [rootStep],
                  toolCalls: [rootTool],
                },
                children: {
                  usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
                  modelSteps: childSteps,
                  toolCalls: [childTool],
                },
                total: {
                  usage: { inputTokens: 13, outputTokens: 3, totalTokens: 16 },
                  modelSteps: [rootStep, ...childSteps],
                  toolCalls: [rootTool, childTool],
                },
              },
            },
          },
        ],
      }),
    );

    const snapshot = projectDiagnostics({
      id: "project-1",
      name: "Scoped",
      basePath: root,
      conversations: [{ id: "thread-1", title: "Multi-agent" }],
    });

    expect(snapshot.totals).toMatchObject({
      inputTokens: 13,
      outputTokens: 3,
      totalTokens: 16,
      modelSteps: 3,
      toolCalls: 2,
      toolDurationMs: 5,
    });
    expect(snapshot.turns[0]).toMatchObject({
      inputTokens: 13,
      totalTokens: 16,
      modelSteps: [
        { agentRole: "root" },
        { agentRole: "explorer" },
        { agentRole: "explorer" },
      ],
      toolCalls: [{ agentRole: "root" }, { agentRole: "explorer" }],
      metrics: {
        root: { totalTokens: 6, modelSteps: 1, toolCalls: 1 },
        children: { totalTokens: 10, modelSteps: 2, toolCalls: 1 },
        total: { totalTokens: 16, modelSteps: 3, toolCalls: 2 },
      },
    });
  });

  it("reads interrupted root-only activity directly from persisted agent runs", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "threadlight-diagnostics-root-run-"),
    );
    const snapshots = mkdtempSync(
      join(tmpdir(), "threadlight-snapshots-root-run-"),
    );
    directories.push(root, snapshots);
    const conversationDirectory = join(root, ".threadlight", "conversations");
    mkdirSync(conversationDirectory, { recursive: true });
    writeFileSync(
      join(conversationDirectory, "thread-1.json"),
      JSON.stringify({
        version: 1,
        threadId: "thread-1",
        createdAt: "2026-08-10T08:00:00.000Z",
        updatedAt: "2026-08-10T08:00:01.000Z",
        model: "scripted-model",
        messages: [
          {
            id: "agent-interrupted:turn-root",
            role: "assistant",
            text: "Transport stopped.",
            error: true,
          },
        ],
        agentRuns: [
          {
            version: 1,
            turnId: "turn-root",
            rootId: "root-agent",
            maxConcurrent: 3,
            status: "interrupted",
            createdAt: "2026-08-10T08:00:00.000Z",
            updatedAt: "2026-08-10T08:00:01.000Z",
            agents: [
              {
                pendingInput: [],
                collected: false,
                agent: {
                  id: "root-agent",
                  name: "threadlight",
                  role: "root",
                  task: "Diagnose transport backpressure",
                  status: "interrupted",
                  phase: "done",
                  createdAt: "2026-08-10T08:00:00.000Z",
                  startedAt: "2026-08-10T08:00:00.000Z",
                  completedAt: "2026-08-10T08:00:01.000Z",
                  elapsedMs: 1_000,
                  error: "JSON line output exceeded the buffer",
                  activities: [],
                  transcript: [
                    {
                      id: "model:1",
                      kind: "model",
                      step: 1,
                      status: "completed",
                      text: "Inspecting the transport.",
                      startedAt: "2026-08-10T08:00:00.000Z",
                      completedAt: "2026-08-10T08:00:00.600Z",
                      durationMs: 600,
                      usage: {
                        inputTokens: 8,
                        outputTokens: 3,
                        totalTokens: 11,
                      },
                    },
                    {
                      id: "tool-1",
                      kind: "tool",
                      name: "exec_command",
                      status: "completed",
                      arguments: '{"cmd":"npm test"}',
                      output: "ok",
                      startedAt: "2026-08-10T08:00:00.600Z",
                      completedAt: "2026-08-10T08:00:00.800Z",
                      durationMs: 200,
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    );
    const project = {
      id: "project-1",
      name: "Root recovery",
      basePath: root,
      conversations: [{ id: "thread-1", title: "Interrupted root" }],
    };

    const snapshot = projectDiagnostics(project);
    expect(snapshot.totals).toMatchObject({
      turns: 1,
      failedTurns: 1,
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
      modelSteps: 1,
      toolCalls: 1,
      toolDurationMs: 200,
    });
    expect(snapshot.turns[0]).toMatchObject({
      status: "failed",
      model: "scripted-model",
      modelSteps: [{ agentId: "root-agent", agentRole: "root" }],
      toolCalls: [{ agentId: "root-agent", agentRole: "root" }],
    });

    const bundle = await projectDiagnosticBundle(project, {
      changes: new ConversationChangeTracker(snapshots),
      environment: {
        runtime: "desktop",
        platform: "darwin",
        architecture: "arm64",
        nodeVersion: "v22.0.0",
      },
    });
    expect(bundle.agents).toEqual([
      expect.objectContaining({
        agentId: "root-agent",
        rootId: "root-agent",
        messageId: "agent-run:turn-root",
        status: "interrupted",
      }),
    ]);
    expect(bundle.timeline.map(({ kind }) => kind)).toEqual([
      "agent",
      "model",
      "tool",
    ]);
    expect(bundle.errors.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["TURN_FAILED", "AGENT_INTERRUPTED"]),
    );
    expect(bundle.summary.totals).toMatchObject({
      failedTurns: 1,
      totalTokens: 11,
      modelSteps: 1,
      toolCalls: 1,
    });
  });

  it("exports redacted task conversations, timings, errors, and changed file bodies", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-bundle-"));
    const snapshots = mkdtempSync(join(tmpdir(), "threadlight-snapshots-"));
    directories.push(root, snapshots);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "config.ts"),
      "export const mode = 'before';\n",
    );
    const tracker = new ConversationChangeTracker(snapshots);
    await tracker.ensureSnapshot("project-1", "thread-1", root);
    writeFileSync(
      join(root, "src", "config.ts"),
      "export const apiKey = 'sk-1234567890abcdefghijkl';\n",
    );
    const conversationDirectory = join(root, ".threadlight", "conversations");
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
        modelState: {
          never: "include-model-state",
          token: "provider-state-secret",
          endpoint: "https://example.test/run?token=query-leak-secret",
        },
        agentSnapshot: { never: "include-agent-snapshot" },
        queuedTurns: [
          {
            id: "queued-1",
            input: "Follow up",
            delivery: "queued",
            createdAt: "2026-08-07T01:00:01.000Z",
            attachments: [
              {
                id: "queued-attachment",
                name: "trace.txt",
                mimeType: "text/plain",
                size: 12,
                kind: "file",
                path: "/Users/alice/private/trace.txt",
              },
            ],
          },
        ],
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
            agentTree: {
              rootId: "root-agent",
              maxConcurrent: 3,
              agents: [
                {
                  id: "root-agent",
                  name: "threadlight",
                  role: "root",
                  task: "Diagnose the failure",
                  status: "completed",
                  phase: "done",
                  createdAt: "2026-08-07T01:00:00.250Z",
                  startedAt: "2026-08-07T01:00:00.250Z",
                  completedAt: "2026-08-07T01:00:01.750Z",
                  elapsedMs: 1_500,
                  activities: [],
                  transcript: [],
                },
                {
                  id: "child-agent",
                  parentId: "root-agent",
                  name: "explorer",
                  role: "explorer",
                  task: "Inspect password=agent-task-secret",
                  status: "completed",
                  phase: "done",
                  createdAt: "2026-08-07T01:00:00.500Z",
                  startedAt: "2026-08-07T01:00:00.500Z",
                  completedAt: "2026-08-07T01:00:01.500Z",
                  elapsedMs: 1_000,
                  output: "Found password=agent-output-secret",
                  activities: [],
                  transcript: [
                    {
                      id: "model:1",
                      kind: "model",
                      step: 1,
                      status: "completed",
                      text: "Inspecting password=agent-model-secret",
                      startedAt: "2026-08-07T01:00:00.500Z",
                      completedAt: "2026-08-07T01:00:00.800Z",
                      durationMs: 300,
                      usage: {
                        inputTokens: 3,
                        outputTokens: 1,
                        totalTokens: 4,
                      },
                    },
                    {
                      id: "agent-tool",
                      kind: "tool",
                      name: "workspace_inspect",
                      status: "completed",
                      arguments: '{"token":"agent-argument-secret"}',
                      output: "ok",
                      startedAt: "2026-08-07T01:00:00.800Z",
                      completedAt: "2026-08-07T01:00:01.000Z",
                      durationMs: 200,
                    },
                  ],
                },
              ],
            },
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
              usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
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
              metrics: {
                root: {
                  usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
                  modelSteps: [
                    {
                      step: 1,
                      durationMs: 800,
                      usage: {
                        inputTokens: 4,
                        outputTokens: 2,
                        totalTokens: 6,
                      },
                      agentId: "root-agent",
                      agentRole: "root",
                    },
                  ],
                  toolCalls: [
                    {
                      callId: "tool-1",
                      name: "exec_command",
                      durationMs: 500,
                      isError: true,
                      errorCode: "command_failed",
                      agentId: "root-agent",
                      agentRole: "root",
                    },
                  ],
                },
                children: {
                  usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
                  modelSteps: [
                    {
                      step: 1,
                      durationMs: 300,
                      usage: {
                        inputTokens: 3,
                        outputTokens: 1,
                        totalTokens: 4,
                      },
                      agentId: "child-agent",
                      agentRole: "explorer",
                    },
                  ],
                  toolCalls: [
                    {
                      callId: "agent-tool",
                      name: "workspace_inspect",
                      durationMs: 200,
                      isError: false,
                      agentId: "child-agent",
                      agentRole: "explorer",
                    },
                  ],
                },
                total: {
                  usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
                  modelSteps: [
                    {
                      step: 1,
                      durationMs: 800,
                      usage: {
                        inputTokens: 4,
                        outputTokens: 2,
                        totalTokens: 6,
                      },
                      agentId: "root-agent",
                      agentRole: "root",
                    },
                    {
                      step: 1,
                      durationMs: 300,
                      usage: {
                        inputTokens: 3,
                        outputTokens: 1,
                        totalTokens: 4,
                      },
                      agentId: "child-agent",
                      agentRole: "explorer",
                    },
                  ],
                  toolCalls: [
                    {
                      callId: "tool-1",
                      name: "exec_command",
                      durationMs: 500,
                      isError: true,
                      errorCode: "command_failed",
                      agentId: "root-agent",
                      agentRole: "root",
                    },
                    {
                      callId: "agent-tool",
                      name: "workspace_inspect",
                      durationMs: 200,
                      isError: false,
                      agentId: "child-agent",
                      agentRole: "explorer",
                    },
                  ],
                },
              },
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
    expect(bundle.project).toMatchObject({
      exportScope: "project",
      conversationIds: ["thread-1"],
    });
    expect(bundle.conversations[0]?.record).toMatchObject({
      version: 1,
      threadId: "thread-1",
      modelState: {
        never: "include-model-state",
        token: "[REDACTED]",
      },
      agentSnapshot: { never: "include-agent-snapshot" },
      queuedTurns: [
        expect.objectContaining({
          input: "Follow up",
          attachments: [expect.objectContaining({ path: "<attachment-path>" })],
        }),
      ],
      messages: [
        {
          text: "Inspect <workspace:thread-1>; Authorization: Bearer [REDACTED]",
          attachments: [{ name: "badcase.png", path: "<attachment-path>" }],
        },
        expect.objectContaining({
          text: "Tool failed with password=[REDACTED]",
          progress: expect.any(Array),
          diagnostics: expect.any(Object),
        }),
      ],
    });
    expect(bundle.conversations[0]?.source).toBe(
      ".threadlight/conversations/thread-1.json",
    );
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
      "agent",
      "agent",
      "model",
      "tool",
    ]);
    expect(bundle.summary.totals).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
      modelSteps: 2,
      toolCalls: 2,
      toolDurationMs: 700,
    });
    expect(bundle.agents).toEqual([
      expect.objectContaining({
        agentId: "root-agent",
        role: "root",
      }),
      expect.objectContaining({
        agentId: "child-agent",
        parentId: "root-agent",
        role: "explorer",
        record: expect.objectContaining({
          task: "Inspect password=[REDACTED]",
          output: "Found password=[REDACTED]",
        }),
      }),
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
    expect(serialized).not.toContain("provider-state-secret");
    expect(serialized).not.toContain("query-leak-secret");
    expect(serialized).not.toContain("sk-1234567890abcdefghijkl");
    expect(serialized).not.toContain("agent-task-secret");
    expect(serialized).not.toContain("agent-output-secret");
    expect(serialized).not.toContain("agent-model-secret");
    expect(serialized).not.toContain("agent-argument-secret");
    expect(serialized).not.toContain("/Users/alice/private/badcase.png");
    expect(serialized).toContain("include-model-state");
    expect(serialized).toContain("include-agent-snapshot");
  });

  it("exports only the selected conversations and rejects unknown ids", async () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-bundle-selection-"));
    const snapshots = mkdtempSync(join(tmpdir(), "threadlight-snapshots-"));
    directories.push(root, snapshots);
    const conversationDirectory = join(root, ".threadlight", "conversations");
    mkdirSync(conversationDirectory, { recursive: true });
    for (const id of ["thread-1", "thread-2"]) {
      writeFileSync(
        join(conversationDirectory, `${id}.json`),
        JSON.stringify({
          version: 1,
          threadId: id,
          createdAt: "2026-08-07T01:00:00.000Z",
          updatedAt: "2026-08-07T01:00:01.000Z",
          messages: [{ id: `${id}-message`, role: "user", text: id }],
          modelState: { stateFor: id },
        }),
      );
    }
    const project = {
      id: "project-1",
      name: "Selection",
      basePath: root,
      conversations: [
        { id: "thread-1", title: "First" },
        { id: "thread-2", title: "Second" },
      ],
    };
    const options = {
      changes: new ConversationChangeTracker(snapshots),
      environment: {
        runtime: "desktop" as const,
        platform: "darwin",
        architecture: "arm64",
        nodeVersion: "v22.0.0",
      },
      now: () => new Date("2026-08-07T02:03:04.000Z"),
    };

    const bundle = await projectDiagnosticBundle(project, {
      ...options,
      conversationIds: ["thread-2"],
    });

    expect(bundle.filename).toBe(
      "threadlight-diagnostics-selection-1-chats-20260807T020304Z.json",
    );
    expect(bundle.project).toMatchObject({
      exportScope: "conversations",
      conversationCount: 1,
      conversationIds: ["thread-2"],
    });
    expect(bundle.conversations).toHaveLength(1);
    expect(bundle.conversations[0]).toMatchObject({
      threadId: "thread-2",
      record: {
        threadId: "thread-2",
        modelState: { stateFor: "thread-2" },
      },
    });
    expect(JSON.stringify(bundle)).not.toContain('"threadId":"thread-1"');
    await expect(
      projectDiagnosticBundle(project, {
        ...options,
        conversationIds: ["missing-thread"],
      }),
    ).rejects.toThrow("Unknown conversation");
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
