import { describe, expect, it } from "vitest";

import {
  initialSessionState,
  sessionReducer,
  type SessionState,
} from "../src/index.js";

describe("sessionReducer", () => {
  it("keeps tool activity with the completed assistant message", () => {
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
        call: { id: "call-1", name: "exec_command", arguments: {} },
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
    expect(state.activities).toEqual([]);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      text: "Everything passes.",
      activities: [
        {
          id: "call-1",
          name: "exec_command",
          status: "completed",
          output: "10 tests passed",
        },
      ],
    });
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
