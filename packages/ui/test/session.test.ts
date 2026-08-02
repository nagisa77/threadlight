import { describe, expect, it } from "vitest";

import {
  initialSessionState,
  newTaskDraftState,
  reduceThreadSession,
  requestNewThreadTurnStart,
  requestTurnStart,
  sessionReducer,
  type SessionState,
} from "../src/session.js";

describe("sessionReducer", () => {
  it("keeps a new task as a local draft until its first turn is submitted", async () => {
    const established = {
      ...initialSessionState,
      connection: "ready" as const,
      threadId: "thread-1",
      messages: [
        { id: "message-1", role: "user" as const, text: "Existing task" },
      ],
    };

    const draft = newTaskDraftState(established, "Could not start task");
    expect(draft).toMatchObject({
      connection: "ready",
      messages: [],
      isRunning: false,
      submissionError: "Could not start task",
    });
    expect(draft.threadId).toBeUndefined();

    const calls: string[] = [];
    const created: string[] = [];
    const client = {
      initialize: async () => {
        calls.push("initialize");
      },
      startThread: async () => {
        calls.push("thread/start");
        return { threadId: "thread-2" };
      },
      startTurn: async (threadId: string, text: string) => {
        calls.push(`turn/start:${threadId}:${text}`);
      },
    };

    expect(calls).toEqual([]);
    const result = await requestNewThreadTurnStart(
      client,
      "First question",
      [],
      "default",
      [],
      "approval",
      (threadId) => created.push(threadId),
    );

    expect(calls).toEqual([
      "initialize",
      "thread/start",
      "turn/start:thread-2:First question",
    ]);
    expect(created).toEqual(["thread-2"]);
    expect(result).toEqual({ threadId: "thread-2", started: { ok: true } });
  });

  it("syncs queued follow-ups and appends them only when the server consumes them", () => {
    const queued = {
      id: "follow-up-1",
      input: "Use the smaller scope",
      delivery: "queued" as const,
      createdAt: "2026-07-29T10:00:00.000Z",
    };
    let state = sessionReducer(initialSessionState, {
      type: "queue.updated",
      queuedTurns: [queued],
    });
    expect(state.queuedTurns).toEqual([queued]);
    expect(state.messages).toEqual([]);

    state = sessionReducer(state, {
      type: "follow-up.consumed",
      itemId: queued.id,
      message: {
        id: "message-1",
        role: "user",
        text: queued.input,
      },
    });
    expect(state.queuedTurns).toEqual([]);
    expect(state.messages).toEqual([
      {
        id: "message-1",
        role: "user",
        text: queued.input,
      },
    ]);
  });

  it("commits visible model output before an injected follow-up starts", () => {
    const state = sessionReducer(
      {
        ...initialSessionState,
        isRunning: true,
        streamingText: "上一段模型输出",
        progress: [
          {
            text: "已检查项目",
            activities: [],
          },
        ],
      },
      {
        type: "follow-up.consumed",
        itemId: "follow-up-1",
        precedingAssistantMessage: {
          id: "assistant-1",
          role: "assistant",
          text: "上一段模型输出",
          progress: [
            {
              text: "已检查项目",
              activities: [],
            },
          ],
        },
        message: {
          id: "message-2",
          role: "user",
          text: "继续执行另一个命令",
        },
      },
    );

    expect(state.streamingText).toBe("");
    expect(state.progress).toEqual([]);
    expect(state.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "上一段模型输出",
        progress: [
          {
            text: "已检查项目",
            activities: [],
          },
        ],
      },
      {
        id: "message-2",
        role: "user",
        text: "继续执行另一个命令",
      },
    ]);
  });

  it("keeps the completed response visible when an after-current command starts", () => {
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "执行第一个命令",
    });
    state = sessionReducer(state, {
      type: "turn.completed",
      id: "assistant-1",
      output: "第一轮已经完成",
    });
    state = sessionReducer(state, {
      type: "follow-up.consumed",
      itemId: "follow-up-1",
      message: {
        id: "message-2",
        role: "user",
        text: "执行排队命令",
      },
    });
    state = sessionReducer(state, {
      type: "turn.started",
      mode: "default",
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.started",
        runId: "run-2",
        step: 1,
      },
    });

    expect(state.messages).toEqual([
      {
        id: "message-1",
        role: "user",
        text: "执行第一个命令",
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "第一轮已经完成",
        error: false,
      },
      {
        id: "message-2",
        role: "user",
        text: "执行排队命令",
      },
    ]);
    expect(state.isRunning).toBe(true);
    expect(state.isThinking).toBe(true);
  });

  it("shows user-selected Plan mode immediately and accepts model plan updates", () => {
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "Build this",
      mode: "plan",
    });
    expect(state.plan).toEqual({ source: "user", items: [] });

    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.started",
        runId: "run-1",
        call: {
          id: "plan-1",
          name: "update_plan",
          arguments: {
            plan: [
              { step: "Inspect", status: "completed" },
              { step: "Build", status: "in_progress" },
              { step: "Test", status: "pending" },
            ],
          },
        },
      },
    });

    expect(state.plan).toEqual({
      source: "user",
      items: [
        { step: "Inspect", status: "completed" },
        { step: "Build", status: "in_progress" },
        { step: "Test", status: "pending" },
      ],
    });
    expect(state.progress).toEqual([]);

    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "plan-1",
          name: "update_plan",
          output: JSON.stringify({
            plan: [
              { step: "Inspect", status: "completed" },
              { step: "Build", status: "in_progress" },
              { step: "Test", status: "pending" },
            ],
            documentPath: ".threadlight/plans/run-1.md",
            documentVersion: "0123456789abcdef",
          }),
        },
      },
    });
    expect(state.plan).toMatchObject({
      documentPath: ".threadlight/plans/run-1.md",
      documentVersion: "0123456789abcdef",
    });
  });

  it("keeps background task runtime state isolated by thread", () => {
    let sessions = reduceThreadSession({}, "thread-1", {
      type: "connection.ready",
      threadId: "thread-1",
    });
    sessions = reduceThreadSession(sessions, "thread-2", {
      type: "connection.ready",
      threadId: "thread-2",
    });
    sessions = reduceThreadSession(sessions, "thread-1", {
      type: "message.sent",
      id: "message-1",
      text: "First task",
    });
    sessions = reduceThreadSession(sessions, "thread-2", {
      type: "message.sent",
      id: "message-2",
      text: "Second task",
    });
    sessions = reduceThreadSession(sessions, "thread-1", {
      type: "agent.event",
      event: {
        type: "model.output_text.delta",
        runId: "run-1",
        step: 1,
        delta: "first progress",
      },
    });

    expect(sessions["thread-1"]).toMatchObject({
      isRunning: true,
      streamingText: "first progress",
    });
    expect(sessions["thread-2"]).toMatchObject({
      isRunning: true,
      streamingText: "",
    });

    sessions = reduceThreadSession(sessions, "thread-1", {
      type: "turn.completed",
      id: "assistant-1",
      output: "First done",
    });
    expect(sessions["thread-1"]?.isRunning).toBe(false);
    expect(sessions["thread-2"]?.isRunning).toBe(true);
  });

  it("hydrates an in-flight turn after the display client refreshes", () => {
    const state = sessionReducer(initialSessionState, {
      type: "connection.ready",
      threadId: "thread-1",
      messages: [
        {
          id: "message-1",
          role: "user",
          text: "检查项目",
        },
      ],
      activeTurn: {
        turnId: "turn-1",
        revision: 4,
        mode: "default",
        isThinking: true,
        streamingText: "已经读取配置，",
        progress: [
          {
            text: "正在检查",
            activities: [
              {
                id: "tool-1",
                name: "workspace_inspect",
                status: "completed",
              },
            ],
          },
        ],
      },
    });

    expect(state).toMatchObject({
      connection: "ready",
      threadId: "thread-1",
      isRunning: true,
      isThinking: true,
      streamingText: "已经读取配置，",
      messages: [{ role: "user", text: "检查项目" }],
      progress: [
        {
          text: "正在检查",
          activities: [{ id: "tool-1", status: "completed" }],
        },
      ],
    });
  });

  it("keeps newer host state when an older resume response arrives", () => {
    const assistant = {
      id: "assistant-1",
      role: "assistant" as const,
      text: "检查完成",
    };
    let state = sessionReducer(
      {
        ...initialSessionState,
        connection: "ready",
        threadId: "thread-1",
        revision: 4,
        isRunning: true,
        streamingText: "正在检查",
      },
      {
        type: "turn.completed",
        id: assistant.id,
        output: assistant.text,
        revision: 5,
        message: assistant,
      },
    );

    state = sessionReducer(state, {
      type: "connection.ready",
      threadId: "thread-1",
      revision: 4,
      messages: [
        { id: "user-1", role: "user", text: "检查项目" },
      ],
      activeTurn: {
        turnId: "turn-1",
        revision: 4,
        mode: "default",
        isThinking: false,
        streamingText: "正在检查",
        progress: [],
      },
    });

    expect(state).toMatchObject({
      revision: 5,
      isRunning: false,
      streamingText: "",
    });
    expect(state.messages).toEqual([
      { id: "user-1", role: "user", text: "检查项目" },
      assistant,
    ]);

    state = sessionReducer(state, {
      type: "turn.completed",
      id: assistant.id,
      output: assistant.text,
      revision: 5,
      message: assistant,
    });
    expect(state.messages).toHaveLength(2);
  });

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

  it("keeps selected capability receipts and applies them on completion", () => {
    const documents = {
      id: "skill:documents",
      kind: "skill" as const,
      name: "Documents",
      source: "builtin",
      icon: "documents",
    };
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "Create a brief",
      capabilityRefs: ["skill:documents"],
      capabilities: [documents],
    });

    expect(state.messages[0]).toMatchObject({
      capabilityRefs: ["skill:documents"],
      capabilities: [documents],
    });

    state = sessionReducer(state, {
      type: "turn.completed",
      id: "message-2",
      output: "Done",
      capabilities: [documents],
    });
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      capabilities: [documents],
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

  it("does not expose unaccepted Plan-mode final attempts", () => {
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "What tools do you have?",
      mode: "plan",
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: { type: "model.started", runId: "run-1", step: 1 },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.output_text.delta",
        runId: "run-1",
        step: 1,
        delta: "This answer may still be rejected.",
        outputVisibility: "provisional",
      },
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "This answer may still be rejected.",
        toolCalls: [],
        outputVisibility: "provisional",
      },
    });

    expect(state.streamingText).toBe("");
    expect(state.isThinking).toBe(false);
    expect(state.messages).toHaveLength(1);

    state = sessionReducer(state, {
      type: "turn.completed",
      id: "message-2",
      output: "Accepted answer.",
    });
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      text: "Accepted answer.",
    });
  });

  it("streams user-facing Plan output while keeping the plan visible", () => {
    let state = sessionReducer(initialSessionState, {
      type: "message.sent",
      id: "message-1",
      text: "Implement this",
      mode: "plan",
    });
    state = sessionReducer(state, {
      type: "agent.event",
      event: { type: "model.started", runId: "run-1", step: 4 },
    });
    for (const delta of ["Plan ", "complete"]) {
      state = sessionReducer(state, {
        type: "agent.event",
        event: {
          type: "model.output_text.delta",
          runId: "run-1",
          step: 4,
          delta,
          outputVisibility: "user",
        },
      });
    }

    expect(state.plan).toEqual({ source: "user", items: [] });
    expect(state.streamingText).toBe("Plan complete");
    expect(state.isThinking).toBe(false);

    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 4,
        text: "Plan complete",
        toolCalls: [],
        outputVisibility: "user",
      },
    });

    expect(state.streamingText).toBe("Plan complete");
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
