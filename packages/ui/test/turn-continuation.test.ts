import { describe, expect, it } from "vitest";

import {
  canContinueSession,
  initialSessionState,
  requestTurnContinuation,
  sessionReducer,
  type SessionState,
} from "../src/session.js";

describe("turn continuation", () => {
  it("continues only the latest interrupted turn through the explicit client action", async () => {
    const interrupted: SessionState = {
      ...initialSessionState,
      connection: "ready",
      threadId: "thread-1",
      continuationAvailable: true,
      messages: [{ id: "user-1", role: "user", text: "Implement recovery" }],
    };
    expect(canContinueSession(interrupted)).toBe(true);
    expect(canContinueSession({ ...interrupted, isRunning: true })).toBe(false);

    const calls: unknown[][] = [];
    const started = await requestTurnContinuation(
      {
        continueTurn: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
      "thread-1",
      "full",
      "openai",
      "gpt-5.6",
    );

    expect(started).toEqual({ ok: true });
    expect(calls).toEqual([["thread-1", "full", "openai", "gpt-5.6"]]);
  });

  it("keeps interruption and continuation control messages out of the transcript", () => {
    const running: SessionState = {
      ...initialSessionState,
      connection: "ready",
      threadId: "thread-1",
      isRunning: true,
      isThinking: true,
      messages: [{ id: "user-1", role: "user", text: "Implement recovery" }],
    };
    const interrupted = sessionReducer(running, {
      type: "turn.failed",
      id: "fallback-id",
      error: "Turn interrupted by client",
      revision: 2,
      message: {
        id: "assistant-interrupted",
        role: "assistant",
        text: "Turn interrupted by client",
        error: true,
        interrupted: true,
        progress: [
          {
            text: "模型调用 1/2：读取实现。",
            activities: [
              {
                id: "call-1",
                name: "read_file",
                status: "completed",
              },
            ],
          },
          {
            text: "模型调用 2/2：运行测试。",
            activities: [
              {
                id: "call-2",
                name: "exec_command",
                status: "terminated",
              },
            ],
          },
        ],
      },
    });

    expect(interrupted.continuationAvailable).toBe(true);
    expect(interrupted.messages).toHaveLength(2);
    expect(interrupted.messages[1]).toMatchObject({
      role: "assistant",
      text: "",
      interrupted: true,
      progress: [
        { text: "模型调用 1/2：读取实现。" },
        { text: "模型调用 2/2：运行测试。" },
      ],
    });
    expect(interrupted.messages[1]).not.toHaveProperty("error");

    const continuing = sessionReducer(interrupted, {
      type: "continuation.started",
    });
    expect(continuing.isRunning).toBe(true);
    expect(continuing.continuationAvailable).toBe(false);
    expect(continuing.messages).toEqual(interrupted.messages);
  });

  it("does not append an empty interrupted control record", () => {
    const state: SessionState = {
      ...initialSessionState,
      connection: "ready",
      threadId: "thread-1",
      isRunning: true,
      messages: [{ id: "user-1", role: "user", text: "Wait" }],
    };
    const interrupted = sessionReducer(state, {
      type: "turn.failed",
      id: "fallback-id",
      error: "Turn interrupted by client",
      message: {
        id: "assistant-interrupted",
        role: "assistant",
        text: "Turn interrupted by client",
        error: true,
        interrupted: true,
      },
    });

    expect(interrupted.messages).toEqual(state.messages);
    expect(interrupted.continuationAvailable).toBe(true);
  });
});
