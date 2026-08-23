import { describe, expect, it } from "vitest";
import { initialSessionState, sessionReducer } from "../src/session.js";

describe("sessionReducer model progress", () => {
  it("shows automatic model retry progress until the stream resumes", () => {
    let state = sessionReducer(initialSessionState, {
      type: "agent.event",
      event: {
        type: "model.retrying",
        runId: "run-1",
        step: 1,
        retryAttempt: 1,
        maxRetries: 1,
        reason: "connection_lost",
      },
    });

    expect(state).toMatchObject({
      isThinking: true,
      modelRetry: {
        retryAttempt: 1,
        maxRetries: 1,
        reason: "connection_lost",
      },
    });

    state = sessionReducer(state, {
      type: "agent.event",
      event: {
        type: "model.output_text.delta",
        runId: "run-1",
        step: 1,
        delta: "Recovered",
      },
    });

    expect(state.modelRetry).toBeUndefined();
    expect(state.streamingText).toBe("Recovered");
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
