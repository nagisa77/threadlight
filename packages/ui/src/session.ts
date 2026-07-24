import { useCallback, useEffect, useReducer, useRef } from "react";
import { RpcResponseError, type ThreadlightClient } from "@threadlight/client";
import type {
  AttachmentData,
  AgentEventData,
  ConversationMessageData,
  ProcessSnapshotData,
  ToolCallData,
  ToolResultData,
} from "@threadlight/protocol";

export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "terminated";
  detail?: string;
  process?: ProcessSnapshotData;
}

export interface ConversationProgress {
  text: string;
  activities: readonly ToolActivity[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly AttachmentData[];
  error?: boolean;
  progress?: readonly ConversationProgress[];
  activities?: readonly ToolActivity[];
}

export interface PendingApproval {
  id: string;
  call: ToolCallData;
}

export interface SessionState {
  connection: "connecting" | "ready" | "error";
  connectionError?: string;
  threadId?: string;
  isRunning: boolean;
  isThinking: boolean;
  messages: readonly ConversationMessage[];
  progress: readonly ConversationProgress[];
  streamingText: string;
  approval?: PendingApproval;
}

export type SessionAction =
  | { type: "connection.connecting" }
  | {
      type: "connection.ready";
      threadId: string;
      messages?: readonly ConversationMessageData[];
    }
  | { type: "connection.failed"; error: string }
  | {
      type: "message.sent";
      id: string;
      text: string;
      attachments?: readonly AttachmentData[];
    }
  | { type: "turn.started" }
  | { type: "turn.completed"; id: string; output: string }
  | { type: "turn.failed"; id: string; error: string }
  | { type: "agent.event"; event: AgentEventData }
  | { type: "process.updated"; process: ProcessSnapshotData };

export const initialSessionState: SessionState = {
  connection: "connecting",
  isRunning: false,
  isThinking: false,
  messages: [],
  progress: [],
  streamingText: "",
};

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "connection.connecting":
      return { ...state, connection: "connecting", connectionError: undefined };
    case "connection.ready":
      return {
        ...initialSessionState,
        connection: "ready",
        threadId: action.threadId,
        messages: action.messages ?? [],
      };
    case "connection.failed":
      return {
        ...state,
        connection: "error",
        connectionError: action.error,
        isRunning: false,
        isThinking: false,
      };
    case "message.sent":
      return {
        ...state,
        isRunning: true,
        isThinking: true,
        progress: [],
        streamingText: "",
        approval: undefined,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: "user",
            text: action.text,
            ...(action.attachments?.length
              ? { attachments: action.attachments }
              : {}),
          },
        ],
      };
    case "turn.started":
      return { ...state, isRunning: true, isThinking: true };
    case "turn.completed":
      return completeTurn(state, action.id, action.output);
    case "turn.failed":
      return completeTurn(state, action.id, action.error, true);
    case "agent.event":
      return reduceAgentEvent(state, action.event);
    case "process.updated":
      return updateSessionProcess(state, action.process);
  }
}

function reduceAgentEvent(
  state: SessionState,
  event: AgentEventData,
): SessionState {
  switch (event.type) {
    case "model.started":
      return { ...state, isThinking: true, streamingText: "" };
    case "model.output_text.delta":
      return {
        ...state,
        isThinking: false,
        streamingText: state.streamingText + event.delta,
      };
    case "model.completed":
      return {
        ...state,
        isThinking: false,
        streamingText: event.toolCalls.length > 0 ? "" : event.text,
        progress:
          event.toolCalls.length > 0
            ? [
                ...state.progress,
                { text: event.text, activities: [] },
              ]
            : state.progress,
      };
    case "tool.started":
      return {
        ...state,
        isThinking: false,
        progress: appendActivity(state.progress, {
          id: event.call.id,
          name: event.call.name,
          status: "running",
          detail: toolInput(event.call),
        }),
      };
    case "tool.completed":
      return completeTool(state, event.result);
    case "approval.requested":
      return {
        ...state,
        isThinking: false,
        approval: { id: event.request.id, call: event.request.call },
      };
    case "run.completed":
    case "run.failed":
      return { ...state, isThinking: false };
    case "approval.resolved":
      return state.approval?.id === event.request.id
        ? { ...state, approval: undefined }
        : state;
    default:
      return state;
  }
}

function completeTurn(
  state: SessionState,
  id: string,
  text: string,
  error = false,
): SessionState {
  return {
    ...state,
    isRunning: false,
    isThinking: false,
    progress: [],
    streamingText: "",
    approval: undefined,
    messages: [
      ...state.messages,
      {
        id,
        role: "assistant",
        text,
        error,
        ...(state.progress.length > 0 ? { progress: state.progress } : {}),
      },
    ],
  };
}

function appendActivity(
  progress: readonly ConversationProgress[],
  activity: ToolActivity,
): ConversationProgress[] {
  if (progress.length === 0) {
    return [{ text: "", activities: [activity] }];
  }

  return progress.map((step, index) =>
    index === progress.length - 1
      ? { ...step, activities: [...step.activities, activity] }
      : step,
  );
}

function completeTool(
  state: SessionState,
  result: ToolResultData,
): SessionState {
  const process = parseProcessSnapshot(result.output);
  const progress = updateProgressProcess(state.progress, process);
  return {
    ...state,
    progress: progress.map((step) => ({
      ...step,
      activities: step.activities.map((activity) => {
        if (activity.id !== result.callId) return activity;
        const isExecCommand = activity.name === "exec_command";
        const keepsInputDetail =
          isExecCommand || activity.name === "computer";
        return {
          ...activity,
          status: result.isError
            ? "failed"
            : isExecCommand && process
              ? processActivityStatus(process)
              : "completed",
          detail: keepsInputDetail
            ? activity.detail
            : process
              ? `${process.status} · ${process.sessionId}`
              : truncate(result.output),
          ...(isExecCommand && process ? { process } : {}),
        };
      }),
    })),
  };
}

function updateSessionProcess(
  state: SessionState,
  process: ProcessSnapshotData,
): SessionState {
  return {
    ...state,
    progress: updateProgressProcess(state.progress, process),
    messages: state.messages.map((message) => ({
      ...message,
      ...(message.progress
        ? { progress: updateProgressProcess(message.progress, process) }
        : {}),
      ...(message.activities
        ? {
            activities: updateActivitiesProcess(message.activities, process),
          }
        : {}),
    })),
  };
}

function updateProgressProcess(
  progress: readonly ConversationProgress[],
  process: ProcessSnapshotData | undefined,
): ConversationProgress[] {
  if (!process) return [...progress];
  return progress.map((step) => ({
    ...step,
    activities: updateActivitiesProcess(step.activities, process),
  }));
}

function updateActivitiesProcess(
  activities: readonly ToolActivity[],
  process: ProcessSnapshotData,
): ToolActivity[] {
  return activities.map((activity) =>
    activity.process?.sessionId === process.sessionId
      ? {
          ...activity,
          status: processActivityStatus(process),
          process,
        }
      : activity,
  );
}

function parseProcessSnapshot(value: string): ProcessSnapshotData | undefined {
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

function processActivityStatus(
  process: ProcessSnapshotData,
): ToolActivity["status"] {
  return process.status;
}

function runningProcessSessionIds(state: SessionState): string[] {
  const activities = [
    ...state.progress.flatMap((step) => step.activities),
    ...state.messages.flatMap((message) => [
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

function truncate(value: string, limit = 1_200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function toolInput(call: ToolCallData): string | undefined {
  if (!isObject(call.arguments)) return;
  if (call.name === "exec_command") {
    const command = call.arguments.command;
    return typeof command === "string" ? `$ ${command}` : undefined;
  }
  if (call.name === "computer" && Array.isArray(call.arguments.actions)) {
    const actions = call.arguments.actions.flatMap((action) =>
      isObject(action) && typeof action.type === "string"
        ? [action.type.replaceAll("_", " ")]
        : [],
    );
    return actions.length > 0 ? actions.join(" → ") : undefined;
  }
  return;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useThreadlightSession(
  client: ThreadlightClient,
  options: { autoConnect?: boolean } = {},
) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const activeThreadId = useRef<string | undefined>(undefined);

  const openThread = useCallback(async (threadId?: string) => {
    dispatch({ type: "connection.connecting" });
    try {
      await client.initialize();
      let opened: {
        threadId: string;
        messages?: readonly ConversationMessageData[];
      };
      if (threadId) {
        try {
          opened = await client.resumeThread(threadId);
        } catch (error) {
          if (!(error instanceof RpcResponseError) || error.code !== -32001) {
            throw error;
          }
          opened = await client.startThread();
        }
      } else {
        opened = await client.startThread();
      }
      activeThreadId.current = opened.threadId;
      dispatch({
        type: "connection.ready",
        threadId: opened.threadId,
        messages: opened.messages,
      });
      return opened.threadId;
    } catch (error) {
      dispatch({ type: "connection.failed", error: errorMessage(error) });
      return;
    }
  }, [client]);

  useEffect(() => {
    const subscriptions = [
      client.on("turn/started", ({ threadId }) => {
        if (threadId === activeThreadId.current) {
          dispatch({ type: "turn.started" });
        }
      }),
      client.on("turn/completed", ({ threadId, output }) => {
        if (threadId === activeThreadId.current) {
          dispatch({ type: "turn.completed", id: crypto.randomUUID(), output });
        }
      }),
      client.on("turn/failed", ({ threadId, error }) => {
        if (threadId === activeThreadId.current) {
          dispatch({ type: "turn.failed", id: crypto.randomUUID(), error });
        }
      }),
      client.on("agent/event", ({ threadId, event }) => {
        if (threadId === activeThreadId.current) {
          dispatch({ type: "agent.event", event });
        }
      }),
    ];

    if (options.autoConnect !== false) void openThread();
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [client, openThread, options.autoConnect]);

  const runningProcessKey = runningProcessSessionIds(state).join("\u0000");
  useEffect(() => {
    if (!runningProcessKey) return;
    const sessionIds = runningProcessKey.split("\u0000");
    let active = true;
    const poll = (): void => {
      for (const sessionId of sessionIds) {
        void client
          .processStatus(sessionId)
          .then((process) => {
            if (active) dispatch({ type: "process.updated", process });
          })
          .catch(() => {
            // A runtime restart invalidates in-memory process sessions. The
            // stored execution record remains available for inspection.
          });
      }
    };
    const timer = setInterval(poll, 1_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, runningProcessKey]);

  const newThread = useCallback(async () => {
    if (state.isRunning) return;
    try {
      const { threadId } = await client.startThread();
      activeThreadId.current = threadId;
      dispatch({ type: "connection.ready", threadId });
      return threadId;
    } catch (error) {
      dispatch({ type: "connection.failed", error: errorMessage(error) });
    }
  }, [client, state.isRunning]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (state.isRunning) return false;
      const { deleted } = await client.deleteThread(threadId);
      if (activeThreadId.current === threadId) {
        activeThreadId.current = undefined;
      }
      return deleted;
    },
    [client, state.isRunning],
  );

  const retry = useCallback(
    () => openThread(activeThreadId.current),
    [openThread],
  );

  const send = useCallback(
    async (value: string, attachments: readonly AttachmentData[] = []) => {
      const text = value.trim();
      if ((!text && attachments.length === 0) || !state.threadId || state.isRunning) {
        return false;
      }

      dispatch({
        type: "message.sent",
        id: crypto.randomUUID(),
        text,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      try {
        await client.startTurn(state.threadId, text, attachments);
      } catch (error) {
        dispatch({
          type: "turn.failed",
          id: crypto.randomUUID(),
          error: errorMessage(error),
        });
      }
      return true;
    },
    [client, state.isRunning, state.threadId],
  );

  const interrupt = useCallback(async () => {
    if (!state.threadId) return;
    try {
      await client.interruptTurn(state.threadId);
    } catch (error) {
      dispatch({ type: "connection.failed", error: errorMessage(error) });
    }
  }, [client, state.threadId]);

  const resolveApproval = useCallback(
    async (approved: boolean) => {
      if (!state.approval) return;
      try {
        await client.resolveApproval(state.approval.id, approved);
      } catch (error) {
        dispatch({ type: "connection.failed", error: errorMessage(error) });
      }
    },
    [client, state.approval],
  );

  const terminateProcess = useCallback(
    async (sessionId: string) => {
      const process = await client.killProcess(sessionId);
      dispatch({ type: "process.updated", process });
      return process;
    },
    [client],
  );

  return {
    state,
    retry,
    openThread,
    newThread,
    deleteThread,
    send,
    interrupt,
    terminateProcess,
    resolveApproval,
  };
}
