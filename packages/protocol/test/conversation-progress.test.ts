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
    const plan = [
      {
        step: "Inspect architecture",
        details:
          "Trace plan events through the tool loop, protocol projection, persistence, and UI.",
        acceptanceCriteria: [
          "The relevant ownership boundaries are documented.",
        ],
        status: "completed",
      },
      {
        step: "Implement Plan mode",
        details:
          "Add the turn-scoped plan document while preserving compact titles in progress UI.",
        acceptanceCriteria: [
          "Each run receives a distinct plan document.",
          "Rich step details survive protocol projection.",
        ],
        status: "in_progress",
      },
      {
        step: "Run tests",
        details: "Run focused offline tests followed by the full suite.",
        acceptanceCriteria: ["All test suites pass."],
        status: "pending",
      },
    ] as const;
    const event: AgentEventData = {
      type: "tool.started",
      runId: "run-1",
      call: {
        id: "plan-1",
        name: "update_plan",
        arguments: {
          explanation: "Break down the implementation",
          plan,
        },
      },
    };

    expect(projectAgentPlan(undefined, event)).toEqual({
      source: "model",
      explanation: "Break down the implementation",
      items: plan,
    });
    expect(projectAgentProgress([], event)).toEqual([]);

    expect(
      projectAgentPlan(projectAgentPlan(undefined, event), {
        type: "tool.completed",
        runId: "run-1",
        result: {
          callId: "plan-1",
          name: "update_plan",
          output: JSON.stringify({
            explanation: "Break down the implementation",
            plan,
            documentPath: ".threadlight/plans/run-1.md",
            documentVersion: "0123456789abcdef",
          }),
        },
      }),
    ).toMatchObject({
      documentPath: ".threadlight/plans/run-1.md",
      documentVersion: "0123456789abcdef",
    });
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
