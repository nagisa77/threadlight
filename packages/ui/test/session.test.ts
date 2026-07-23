import { describe, expect, it } from "vitest";

import {
  initialSessionState,
  sessionReducer,
  type SessionState,
} from "../src/index.js";

describe("sessionReducer", () => {
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

  it("tracks and clears approval requests", () => {
    const request = {
      id: "approval-1",
      runId: "run-1",
      call: { id: "call-1", name: "exec_command", arguments: {} },
    };
    const waiting = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: { type: "approval.requested", request },
    });
    const resolved = sessionReducer(waiting, {
      type: "agent.event",
      event: { type: "approval.resolved", request, approved: true },
    });

    expect(waiting.approval).toEqual({ id: "approval-1", call: request.call });
    expect(resolved.approval).toBeUndefined();
  });
});
