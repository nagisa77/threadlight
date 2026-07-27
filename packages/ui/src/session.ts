import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RpcResponseError, type ThreadlightClient } from "@threadlight/client";
import {
  projectAgentProgress,
  projectMessagesProcess,
  projectProgressProcess,
  runningProcessSessionIds,
  type AttachmentData,
  type AgentEventData,
  type ConversationActivityData,
  type ConversationMessageData,
  type ConversationProgressData,
  type ProcessSnapshotData,
} from "@threadlight/protocol";

export type ToolActivity = ConversationActivityData;
export type ConversationProgress = ConversationProgressData;

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly AttachmentData[];
  error?: boolean;
  progress?: readonly ConversationProgress[];
  activities?: readonly ToolActivity[];
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
  submissionError?: string;
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
  | { type: "message.rejected"; id: string; error: string }
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
        submissionError: undefined,
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
    case "message.rejected":
      return {
        ...state,
        isRunning: false,
        isThinking: false,
        progress: [],
        streamingText: "",
        submissionError: action.error,
        messages: state.messages.filter((message) => message.id !== action.id),
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

export function reduceThreadSession(
  sessions: Readonly<Record<string, SessionState>>,
  threadId: string,
  action: SessionAction,
): Readonly<Record<string, SessionState>> {
  return {
    ...sessions,
    [threadId]: sessionReducer(
      sessions[threadId] ?? {
        ...initialSessionState,
        threadId,
      },
      action,
    ),
  };
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
        progress: projectAgentProgress(state.progress, event),
      };
    case "tool.started":
      return {
        ...state,
        isThinking: false,
        progress: projectAgentProgress(state.progress, event),
      };
    case "tool.completed":
      return {
        ...state,
        progress: projectAgentProgress(state.progress, event),
      };
    case "run.completed":
    case "run.failed":
      return { ...state, isThinking: false };
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

function updateSessionProcess(
  state: SessionState,
  process: ProcessSnapshotData,
): SessionState {
  return {
    ...state,
    progress: projectProgressProcess(state.progress, process),
    messages: projectMessagesProcess(state.messages, process),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function requestTurnStart(
  client: {
    startTurn(
      threadId: string,
      text: string,
      attachments: readonly AttachmentData[],
    ): Promise<unknown>;
  },
  threadId: string,
  text: string,
  attachments: readonly AttachmentData[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.startTurn(threadId, text, attachments);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function useThreadlightSession(
  client: ThreadlightClient,
  options: { autoConnect?: boolean } = {},
) {
  const [sessions, setSessions] = useState<
    Readonly<Record<string, SessionState>>
  >({});
  const sessionsRef = useRef<Readonly<Record<string, SessionState>>>({});
  const [activeThreadIdValue, setActiveThreadIdValue] = useState<
    string | undefined
  >();
  const activeThreadId = useRef<string | undefined>(undefined);

  const updateSession = useCallback(
    (threadId: string, action: SessionAction) => {
      setSessions((current) => {
        const next = reduceThreadSession(current, threadId, action);
        sessionsRef.current = next;
        return next;
      });
    },
    [],
  );

  const activateThread = useCallback((threadId: string) => {
    activeThreadId.current = threadId;
    setActiveThreadIdValue(threadId);
  }, []);

  const openThread = useCallback(async (threadId?: string) => {
    if (threadId && sessionsRef.current[threadId]) {
      try {
        await client.initialize();
        activateThread(threadId);
        return threadId;
      } catch (error) {
        activateThread(threadId);
        updateSession(threadId, {
          type: "connection.failed",
          error: errorMessage(error),
        });
        return;
      }
    }
    if (threadId) {
      activateThread(threadId);
      updateSession(threadId, { type: "connection.connecting" });
    }
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
      activateThread(opened.threadId);
      updateSession(opened.threadId, {
        type: "connection.ready",
        threadId: opened.threadId,
        messages: opened.messages,
      });
      return opened.threadId;
    } catch (error) {
      const target = threadId ?? activeThreadId.current;
      if (target) {
        updateSession(target, {
          type: "connection.failed",
          error: errorMessage(error),
        });
      }
      return;
    }
  }, [activateThread, client, updateSession]);

  useEffect(() => {
    const subscriptions = [
      client.on("turn/started", ({ threadId }) => {
        updateSession(threadId, { type: "turn.started" });
      }),
      client.on("turn/completed", ({ threadId, output }) => {
        updateSession(threadId, {
          type: "turn.completed",
          id: crypto.randomUUID(),
          output,
        });
      }),
      client.on("turn/failed", ({ threadId, error }) => {
        updateSession(threadId, {
          type: "turn.failed",
          id: crypto.randomUUID(),
          error,
        });
      }),
      client.on("agent/event", ({ threadId, event }) => {
        updateSession(threadId, { type: "agent.event", event });
      }),
    ];

    if (options.autoConnect !== false) void openThread();
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [client, openThread, options.autoConnect, updateSession]);

  const state =
    (activeThreadIdValue
      ? sessions[activeThreadIdValue]
      : undefined) ?? initialSessionState;
  const runningThreadIds = useMemo(
    () =>
      Object.values(sessions)
        .filter((session) => session.isRunning && session.threadId)
        .map((session) => session.threadId as string),
    [sessions],
  );

  const runningProcessKey = runningProcessSessionIds(
    state.progress,
    state.messages,
  ).join("\u0000");
  useEffect(() => {
    if (!runningProcessKey) return;
    const sessionIds = runningProcessKey.split("\u0000");
    let active = true;
    const poll = (): void => {
      for (const sessionId of sessionIds) {
        void client
          .processStatus(sessionId)
          .then((process) => {
            const threadId = activeThreadId.current;
            if (active && threadId) {
              updateSession(threadId, { type: "process.updated", process });
            }
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
  }, [client, runningProcessKey, updateSession]);

  const newThread = useCallback(async () => {
    try {
      const { threadId } = await client.startThread();
      activateThread(threadId);
      updateSession(threadId, { type: "connection.ready", threadId });
      return threadId;
    } catch (error) {
      const threadId = activeThreadId.current;
      if (threadId) {
        updateSession(threadId, {
          type: "connection.failed",
          error: errorMessage(error),
        });
      }
    }
  }, [activateThread, client, updateSession]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (sessionsRef.current[threadId]?.isRunning) return false;
      const { deleted } = await client.deleteThread(threadId);
      setSessions((current) => {
        const { [threadId]: _deleted, ...next } = current;
        sessionsRef.current = next;
        return next;
      });
      if (activeThreadId.current === threadId) {
        activeThreadId.current = undefined;
        setActiveThreadIdValue(undefined);
      }
      return deleted;
    },
    [client],
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

      const optimisticMessageId = crypto.randomUUID();
      const threadId = state.threadId;
      updateSession(threadId, {
        type: "message.sent",
        id: optimisticMessageId,
        text,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      const started = await requestTurnStart(
        client,
        threadId,
        text,
        attachments,
      );
      if (!started.ok) {
        updateSession(threadId, {
          type: "message.rejected",
          id: optimisticMessageId,
          error: started.error,
        });
        return false;
      }
      return true;
    },
    [client, state.isRunning, state.threadId, updateSession],
  );

  const interrupt = useCallback(async () => {
    if (!state.threadId) return;
    try {
      await client.interruptTurn(state.threadId);
    } catch (error) {
      updateSession(state.threadId, {
        type: "connection.failed",
        error: errorMessage(error),
      });
    }
  }, [client, state.threadId, updateSession]);

  const terminateProcess = useCallback(
    async (sessionId: string) => {
      const process = await client.killProcess(sessionId);
      const threadId = activeThreadId.current;
      if (threadId) {
        updateSession(threadId, { type: "process.updated", process });
      }
      return process;
    },
    [client, updateSession],
  );

  return {
    state,
    sessions,
    runningThreadIds,
    retry,
    openThread,
    newThread,
    deleteThread,
    send,
    interrupt,
    terminateProcess,
  };
}
