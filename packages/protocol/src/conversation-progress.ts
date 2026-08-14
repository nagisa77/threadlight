import {
  appendActivityDetail,
  formatComputerToolInput,
  formatComputerToolResult,
} from "./computer-activity.js";
import type {
  AgentEventData,
  ConversationActivityData,
  ConversationMessageData,
  ConversationProgressData,
  ProcessSnapshotData,
} from "./index.js";

export function projectAgentProgress(
  progress: readonly ConversationProgressData[],
  event: AgentEventData,
): ConversationProgressData[] {
  if (
    event.type === "model.completed" &&
    event.toolCalls.some(isVisibleExecutionCall)
  ) {
    return [
      ...progress,
      {
        text: event.text,
        ...(event.activitySummary
          ? { activitySummary: event.activitySummary }
          : {}),
        activities: [],
      },
    ];
  }

  if (event.type === "tool.started") {
    if (!isVisibleExecutionCall(event.call)) return [...progress];
    const detail = toolDetail(event.call.name, event.call.arguments);
    const activity: ConversationActivityData = {
      id: event.call.id,
      name: event.call.name,
      status: "running",
      ...(detail ? { detail } : {}),
    };
    if (progress.length === 0) {
      return [{ text: "", activities: [activity] }];
    }
    return progress.map((step, index) =>
      index === progress.length - 1
        ? { ...step, activities: [...step.activities, activity] }
        : step,
    );
  }

  if (
    event.type !== "tool.completed" ||
    event.result.visibility === "hidden" ||
    isPlanControlTool(event.result.name)
  ) {
    return [...progress];
  }

  const process =
    event.result.name === "computer"
      ? undefined
      : parseProcessSnapshot(event.result.output);
  const withProcess = process
    ? projectProgressProcess(progress, process)
    : [...progress];

  return withProcess.map((step) => ({
    ...step,
    activities: step.activities.map((activity) =>
      activity.id === event.result.callId
        ? completeActivity(activity, event.result, process)
        : activity,
    ),
  }));
}

function isVisibleExecutionCall(call: {
  name: string;
  visibility?: "hidden";
}): boolean {
  return call.visibility !== "hidden" && !isPlanControlTool(call.name);
}

function isPlanControlTool(name: string): boolean {
  return (
    name === "update_plan" ||
    name === "advance_plan" ||
    name === "request_plan_input"
  );
}

export function projectProgressProcess(
  progress: readonly ConversationProgressData[],
  process: ProcessSnapshotData,
): readonly ConversationProgressData[] {
  let changed = false;
  const next = progress.map((step) => {
    const activities = projectActivitiesProcess(step.activities, process);
    if (activities === step.activities) return step;
    changed = true;
    return { ...step, activities };
  });
  return changed ? next : progress;
}

export function projectMessagesProcess(
  messages: readonly ConversationMessageData[],
  process: ProcessSnapshotData,
): readonly ConversationMessageData[] {
  let changed = false;
  const next = messages.map((message) => {
    const progress = message.progress
      ? projectProgressProcess(message.progress, process)
      : undefined;
    const activities = message.activities
      ? projectActivitiesProcess(message.activities, process)
      : undefined;
    if (
      progress === message.progress &&
      activities === message.activities
    ) {
      return message;
    }
    changed = true;
    return {
      ...message,
      ...(progress ? { progress } : {}),
      ...(activities ? { activities } : {}),
    };
  });
  return changed ? next : messages;
}

export function runningProcessSessionIds(
  progress: readonly ConversationProgressData[],
  messages: readonly ConversationMessageData[],
): string[] {
  const activities = [
    ...progress.flatMap((step) => step.activities),
    ...messages.flatMap((message) => [
      ...(message.progress?.flatMap((step) => step.activities) ?? []),
      ...(message.activities ?? []),
    ]),
  ];
  return [
    ...new Set(
      activities.flatMap((activity) =>
        activity.process?.status === "running"
          ? [activity.process.sessionId]
          : [],
      ),
    ),
  ].sort();
}

export function parseProcessSnapshot(
  value: string,
): ProcessSnapshotData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }
  if (!isObject(parsed)) return;
  const status = parsed.status;
  if (
    typeof parsed.sessionId !== "string" ||
    typeof parsed.command !== "string" ||
    typeof parsed.cwd !== "string" ||
    (status !== "running" &&
      status !== "completed" &&
      status !== "completed_with_warnings" &&
      status !== "failed" &&
      status !== "terminated") ||
    (parsed.exitCode !== null && typeof parsed.exitCode !== "number") ||
    (parsed.signal !== null && typeof parsed.signal !== "string") ||
    typeof parsed.stdout !== "string" ||
    typeof parsed.stderr !== "string" ||
    typeof parsed.truncated !== "boolean" ||
    typeof parsed.startedAt !== "string" ||
    (parsed.completedAt !== undefined && typeof parsed.completedAt !== "string")
  ) {
    return;
  }
  return parsed as unknown as ProcessSnapshotData;
}

function projectActivitiesProcess(
  activities: readonly ConversationActivityData[],
  process: ProcessSnapshotData,
): readonly ConversationActivityData[] {
  let changed = false;
  const next = activities.map((activity) => {
    if (
      activity.process?.sessionId !== process.sessionId ||
      sameProcessSnapshot(activity.process, process)
    ) {
      return activity;
    }
    changed = true;
    return {
      ...activity,
      status: process.status,
      process: { ...process },
    };
  });
  return changed ? next : activities;
}

function completeActivity(
  activity: ConversationActivityData,
  result: {
    output: string;
    isError?: boolean;
  },
  process: ProcessSnapshotData | undefined,
): ConversationActivityData {
  const isExecCommand = activity.name === "exec_command";
  let detail = activity.detail;
  if (
    !isExecCommand &&
    activity.name !== "project_memory" &&
    activity.name !== "computer"
  ) {
    detail = process
      ? `${process.status} · ${process.sessionId}`
      : truncate(result.output);
  }
  if (activity.name === "computer") {
    detail = appendActivityDetail(detail, formatComputerToolResult(result));
  }
  return {
    ...activity,
    status: result.isError
      ? "failed"
      : isExecCommand && process
        ? process.status
        : "completed",
    ...(detail ? { detail } : {}),
    ...(isExecCommand && process ? { process } : {}),
  };
}

function toolDetail(name: string, arguments_: unknown): string | undefined {
  if (!isObject(arguments_)) return;
  if (name === "exec_command") {
    const command = arguments_.command;
    return typeof command === "string" ? `$ ${command}` : undefined;
  }
  if (name === "project_memory") {
    return arguments_.action === "write"
      ? "Update .threadlight/MEMORY.md"
      : "Read .threadlight/MEMORY.md";
  }
  if (name === "computer") {
    return formatComputerToolInput(arguments_);
  }
  return;
}

function sameProcessSnapshot(
  left: ProcessSnapshotData,
  right: ProcessSnapshotData,
): boolean {
  return (
    left.status === right.status &&
    left.exitCode === right.exitCode &&
    left.signal === right.signal &&
    left.stdout === right.stdout &&
    left.stderr === right.stderr &&
    left.truncated === right.truncated &&
    left.completedAt === right.completedAt
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, limit = 1_200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
