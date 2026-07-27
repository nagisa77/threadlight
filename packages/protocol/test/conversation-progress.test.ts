import { describe, expect, it } from "vitest";

import {
  projectAgentProgress,
  projectAgentPlan,
  projectMessagesProcess,
  projectProgressProcess,
  runningProcessSessionIds,
  type AgentEventData,
  type ConversationMessageData,
  type ConversationProgressData,
  type ProcessSnapshotData,
} from "../src/index.js";

describe("conversation progress projection", () => {
  it("projects plan tool calls separately from execution activity", () => {
    const event: AgentEventData = {
      type: "tool.started",
      runId: "run-1",
      call: {
        id: "plan-1",
        name: "update_plan",
        arguments: {
          explanation: "Break down the implementation",
          plan: [
            { step: "Inspect architecture", status: "completed" },
            { step: "Implement Plan mode", status: "in_progress" },
            { step: "Run tests", status: "pending" },
          ],
        },
      },
    };

    expect(projectAgentPlan(undefined, event)).toEqual({
      source: "model",
      explanation: "Break down the implementation",
      items: [
        { step: "Inspect architecture", status: "completed" },
        { step: "Implement Plan mode", status: "in_progress" },
        { step: "Run tests", status: "pending" },
      ],
    });
    expect(projectAgentProgress([], event)).toEqual([]);
  });

  it("projects the same model and tool event sequence into ordered progress", () => {
    const events: AgentEventData[] = [
      {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "I’ll run the tests.",
        toolCalls: [
          {
            id: "call-1",
            name: "exec_command",
            arguments: { command: "npm test" },
          },
        ],
      },
      {
        type: "tool.started",
        runId: "run-1",
        call: {
          id: "call-1",
          name: "exec_command",
          arguments: { command: "npm test" },
        },
      },
      {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "call-1",
          name: "exec_command",
          output: JSON.stringify(runningProcess()),
        },
      },
    ];

    const progress = events.reduce<readonly ConversationProgressData[]>(
      (current, event) => projectAgentProgress(current, event),
      [],
    );

    expect(progress).toEqual([
      {
        text: "I’ll run the tests.",
        activities: [
          {
            id: "call-1",
            name: "exec_command",
            status: "running",
            detail: "$ npm test",
            process: runningProcess(),
          },
        ],
      },
    ]);
  });

  it("updates live and stored process projections with one shared reducer", () => {
    const running = runningProcess();
    const progress: readonly ConversationProgressData[] = [
      {
        text: "",
        activities: [
          {
            id: "call-1",
            name: "exec_command",
            status: "running",
            process: running,
          },
        ],
      },
    ];
    const messages: readonly ConversationMessageData[] = [
      {
        id: "message-1",
        role: "assistant",
        text: "Still running",
        progress,
      },
    ];
    const completed: ProcessSnapshotData = {
      ...running,
      status: "completed",
      exitCode: 0,
      completedAt: "2026-07-27T12:00:01.000Z",
    };

    expect(projectProgressProcess(progress, completed)[0]?.activities[0])
      .toMatchObject({ status: "completed", process: { exitCode: 0 } });
    expect(projectMessagesProcess(messages, completed)[0]?.progress?.[0]
      ?.activities[0]).toMatchObject({
        status: "completed",
        process: { exitCode: 0 },
      });
    expect(runningProcessSessionIds(progress, messages)).toEqual(["session-1"]);
  });
});

function runningProcess(): ProcessSnapshotData {
  return {
    sessionId: "session-1",
    command: "npm test",
    cwd: "/workspace",
    status: "running",
    exitCode: null,
    signal: null,
    stdout: "running\n",
    stderr: "",
    truncated: false,
    startedAt: "2026-07-27T12:00:00.000Z",
  };
}
