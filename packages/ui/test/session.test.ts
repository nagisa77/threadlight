import { describe, expect, it } from "vitest";

import {
  initialSessionState,
  requestTurnStart,
  sessionReducer,
  type SessionState,
} from "../src/session.js";

describe("sessionReducer", () => {
  it("rolls back the optimistic message when turn/start is rejected", async () => {
    let state = sessionReducer(
      {
        ...initialSessionState,
        connection: "ready",
        threadId: "thread-1",
      },
      {
        type: "message.sent",
        id: "message-1",
        text: "Keep this draft",
      },
    );
    const started = await requestTurnStart(
      {
        startTurn: async () => {
          throw new Error("conversation could not be persisted");
        },
      },
      "thread-1",
      "Keep this draft",
      [],
    );
    expect(started).toEqual({
      ok: false,
      error: "conversation could not be persisted",
    });

    if (!started.ok) {
      state = sessionReducer(state, {
        type: "message.rejected",
        id: "message-1",
        error: started.error,
      });
    }
    expect(state).toMatchObject({
      isRunning: false,
      isThinking: false,
      submissionError: "conversation could not be persisted",
      messages: [],
    });
  });

  it("keeps uploaded attachments outside the optimistic user text", () => {
    const attachment = {
      id: "attachment-1",
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image" as const,
      path: "/workspace/.threadlight/uploads/diagram.png",
    };
    const state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "",
      attachments: [attachment],
    });

    expect(state.messages[0]).toEqual({
      id: "message-1",
      role: "user",
      text: "",
      attachments: [attachment],
    });
  });

  it("accumulates real model deltas and commits one completed message", () => {
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "Hello",
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: { type: "model.started", runId: "run-1", step: 1 },
    });
    for (const delta of ["Hello", " world"]) {
      state = sessionReducer(state, {
        type: "agent.event",
        event: {
          type: "model.output_text.delta",
          runId: "run-1",
          step: 1,
          delta,
        },
      });
    }

    expect(state.streamingText).toBe("Hello world");
    expect(state.isThinking).toBe(false);
    expect(state.messages).toHaveLength(1);

    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "Hello world",
        toolCalls: [],
      },
    });
    state = sessionReducer(state, {
      type: "turn.completed",
      id: "message-2",
      output: "Hello world",
    });

    expect(state.streamingText).toBe("");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      text: "Hello world",
    });
  });

  it("moves streamed model commentary into its tool progress step", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: { type: "model.started", runId: "run-1", step: 1 },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.output_text.delta",
        runId: "run-1",
        step: 1,
        delta: "我先检查配置。",
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "我先检查配置。",
        toolCalls: [{ id: "call-1", name: "read_config", arguments: {} }],
      },
    });

    expect(state.streamingText).toBe("");
    expect(state.progress).toEqual([
      { text: "我先检查配置。", activities: [] },
    ]);
  });

  it("keeps the exec command with the completed assistant message", () => {
    let state: SessionState = {
      ...initialSessionState,
      connection: "ready",
      threadId: "thread-1",
    };

    state = sessionReducer(state, {
      type: "message.sent",
      id: "message-1",
      text: "Run tests",
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: {
          id: "call-1",
          name: "exec_command",
          arguments: { command: "npm test" },
        },
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "exec_command",
          output: "10 tests passed",
        },
      },
    });
    state = sessionReducer(state, {
      type: "turn.completed",
      id: "message-2",
      output: "Everything passes.",
    });

    expect(state.isRunning).toBe(false);
    expect(state.progress).toEqual([]);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      text: "Everything passes.",
      progress: [
        {
          text: "",
          activities: [
            {
              id: "call-1",
              name: "exec_command",
              status: "completed",
              detail: "$ npm test",
            },
          ],
        },
      ],
    });
  });

  it("keeps results for non-command tools", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: { id: "call-1", name: "web_search", arguments: {} },
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "web_search",
          output: "search result",
        },
      },
    });

    expect(state.progress[0]?.activities[0]?.detail).toBe("search result");
  });

  it("shows detailed computer actions and the screenshot result", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: {
          id: "call-1",
          name: "computer",
          arguments: {
            actions: [
              { type: "screenshot" },
              { type: "click", x: 120, y: 80 },
            ],
          },
        },
      },
    });
    expect(state.progress[0]?.activities[0]?.detail).toBe(
      [
        "操作 1 · screenshot",
        "操作 2 · click · 坐标 (120, 80)",
      ].join("\n"),
    );
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "computer",
          output: '{"type":"computer_screenshot","status":"captured"}',
        },
      },
    });

    expect(state.progress[0]?.activities[0]).toMatchObject({
      status: "completed",
      detail: [
        "操作 1 · screenshot",
        "操作 2 · click · 坐标 (120, 80)",
        "结果 · 已捕获更新后的屏幕截图",
      ].join("\n"),
    });
  });

  it("shows computer failures without recording typed content", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: {
          id: "call-1",
          name: "computer",
          arguments: {
            actions: [
              { type: "click", x: 120, y: 80, button: "left" },
              { type: "type", text: "private message" },
              { type: "wait" },
            ],
          },
        },
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "computer",
          output:
            "action 2/2 type input=virtual pid=42 failed: focused={role=AXWindow}",
          isError: true,
        },
      },
    });

    const activity = state.progress[0]?.activities[0];
    expect(activity).toMatchObject({ status: "failed" });
    expect(activity?.detail).toContain(
      "操作 2 · type · 15 个字符（内容未记录）",
    );
    expect(activity?.detail).toContain(
      "错误 · action 2/2 type input=virtual pid=42 failed",
    );
    expect(activity?.detail).not.toContain("private message");
  });

  it("tracks managed command output and a user-terminated state", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: {
          id: "call-1",
          name: "exec_command",
          arguments: { command: "sleep 1000" },
        },
      },
    });
    const running = {
      sessionId: "session-1",
      command: "sleep 1000",
      cwd: "/workspace",
      status: "running" as const,
      exitCode: null,
      signal: null,
      stdout: "started\n",
      stderr: "",
      truncated: false,
      startedAt: "2026-07-22T08:00:00.000Z",
    };
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "exec_command",
          output: JSON.stringify({ ...running, timedOut: true }),
        },
      },
    });

    expect(state.progress[0]?.activities[0]).toMatchObject({
      status: "running",
      process: { sessionId: "session-1", stdout: "started\n" },
    });

    state = sessionReducer(state, {
      type: "process.updated",
      process: {
        ...running,
        status: "terminated",
        signal: "SIGTERM",
        completedAt: "2026-07-22T08:00:01.000Z",
      },
    });
    expect(state.progress[0]?.activities[0]).toMatchObject({
      status: "terminated",
      process: { status: "terminated", signal: "SIGTERM" },
    });
  });

  it("keeps model commentary before every multi-tool batch", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "我先检查配置和测试。",
        toolCalls: [
          { id: "call-1", name: "read_config", arguments: {} },
          { id: "call-2", name: "run_tests", arguments: {} },
        ],
      },
    });

    for (const call of [
      { id: "call-1", name: "read_config" },
      { id: "call-2", name: "run_tests" },
    ]) {
      state = sessionReducer(state, {
        type: "agent.event",
        event: {
          type: "tool.started",
          runId: "run-1",
          call: { ...call, arguments: {} },
        },
      });
    }

    expect(state.progress).toMatchObject([
      {
        text: "我先检查配置和测试。",
        activities: [
          { id: "call-1", name: "read_config" },
          { id: "call-2", name: "run_tests" },
        ],
      },
    ]);
  });

  it("returns to thinking after a tool result is sent to the model", () => {
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "Search and summarize",
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "",
        toolCalls: [{ id: "call-1", name: "web_search", arguments: {} }],
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: { id: "call-1", name: "web_search", arguments: {} },
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "web_search",
          output: "search result",
        },
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: { type: "model.started", runId: "run-1", step: 2 },
    });

    expect(state.isThinking).toBe(true);
    expect(state.progress[0]?.activities).toMatchObject([
      { id: "call-1", status: "completed" },
    ]);
  });

});
