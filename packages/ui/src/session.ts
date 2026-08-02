import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RpcResponseError, type ThreadlightClient } from "@threadlight/client";
import {
  projectAgentProgress,
  projectAgentPlan,
  projectMessagesProcess,
  projectProgressProcess,
  runningProcessSessionIds,
  type ActiveTurnData,
  type AttachmentData,
  type AgentPlanData,
  type AgentEventData,
  type CapabilityDescriptor,
  type ConversationAccessMode,
  type ConversationActivityData,
  type ConversationMessageData,
  type ConversationProgressData,
  type FollowUpDelivery,
  type MessageCapabilityData,
  type MessageCitationData,
  type MessageSourceData,
  type ProcessSnapshotData,
  type QueuedTurnData,
  type TurnDiagnosticsData,
  type TurnMode,
} from "@threadlight/protocol";

export type ToolActivity = ConversationActivityData;
export type ConversationProgress = ConversationProgressData;

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly AttachmentData[];
  capabilityRefs?: readonly string[];
  capabilities?: readonly MessageCapabilityData[];
  error?: boolean;
  mode?: TurnMode;
  plan?: AgentPlanData;
  progress?: readonly ConversationProgress[];
  activities?: readonly ToolActivity[];
  diagnostics?: TurnDiagnosticsData;
  sources?: readonly MessageSourceData[];
  citations?: readonly MessageCitationData[];
}

export interface SessionState {
  connection: "connecting" | "ready" | "error";
  connectionError?: string;
  threadId?: string;
  revision: number;
  isRunning: boolean;
  isThinking: boolean;
  messages: readonly ConversationMessage[];
  queuedTurns: readonly QueuedTurnData[];
  progress: readonly ConversationProgress[];
  plan?: AgentPlanData;
  streamingText: string;
  submissionError?: string;
}

export type SessionAction =
  | { type: "connection.connecting" }
  | {
      type: "connection.ready";
      threadId: string;
      messages?: readonly ConversationMessageData[];
      queuedTurns?: readonly QueuedTurnData[];
      revision?: number;
      activeTurn?: ActiveTurnData;
    }
  | { type: "connection.failed"; error: string }
  | {
      type: "message.sent";
      id: string;
      text: string;
      attachments?: readonly AttachmentData[];
      capabilityRefs?: readonly string[];
      capabilities?: readonly MessageCapabilityData[];
      mode?: TurnMode;
    }
  | { type: "message.rejected"; id: string; error: string }
  | {
      type: "turn.started";
      mode: TurnMode;
      revision?: number;
      activeTurn?: ActiveTurnData;
    }
  | {
      type: "turn.completed";
      id: string;
      output: string;
      revision?: number;
      message?: ConversationMessageData;
      capabilities?: readonly MessageCapabilityData[];
      diagnostics?: TurnDiagnosticsData;
      sources?: readonly MessageSourceData[];
      citations?: readonly MessageCitationData[];
    }
  | {
      type: "turn.failed";
      id: string;
      error: string;
      revision?: number;
      message?: ConversationMessageData;
      diagnostics?: TurnDiagnosticsData;
    }
  | {
      type: "agent.event";
      event: AgentEventData;
      revision?: number;
      activeTurn?: ActiveTurnData;
    }
  | { type: "process.updated"; process: ProcessSnapshotData }
  | { type: "queue.updated"; queuedTurns: readonly QueuedTurnData[] }
  | {
      type: "follow-up.consumed";
      itemId: string;
      message: ConversationMessageData;
      precedingAssistantMessage?: ConversationMessageData;
    }
  | { type: "submission.failed"; error: string };

export const initialSessionState: SessionState = {
  connection: "connecting",
  revision: 0,
  isRunning: false,
  isThinking: false,
  messages: [],
  queuedTurns: [],
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
    case "connection.ready": {
      const revision =
        action.revision ?? action.activeTurn?.revision ?? 0;
      if (state.revision > revision) {
        return {
          ...state,
          connection: "ready",
          connectionError: undefined,
          threadId: action.threadId,
          messages: mergeMessages(action.messages ?? [], state.messages),
        };
      }
      return {
        ...initialSessionState,
        connection: "ready",
        threadId: action.threadId,
        revision,
        messages: action.messages ?? [],
        queuedTurns: action.queuedTurns ?? [],
        isRunning: action.activeTurn !== undefined,
        isThinking: action.activeTurn?.isThinking ?? false,
        progress: action.activeTurn?.progress ?? [],
        plan: action.activeTurn?.plan,
        streamingText: action.activeTurn?.streamingText ?? "",
      };
    }
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
        plan:
          action.mode === "plan"
            ? { source: "user", items: [] }
            : undefined,
        streamingText: "",
        submissionError: undefined,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: "user",
            text: action.text,
            ...(action.mode === "plan" ? { mode: action.mode } : {}),
            ...(action.attachments?.length
              ? { attachments: action.attachments }
              : {}),
            ...(action.capabilityRefs?.length
              ? { capabilityRefs: action.capabilityRefs }
              : {}),
            ...(action.capabilities?.length
              ? { capabilities: action.capabilities }
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
        plan: undefined,
        streamingText: "",
        submissionError: action.error,
        messages: state.messages.filter((message) => message.id !== action.id),
      };
    case "turn.started":
      if (
        action.revision !== undefined &&
        action.revision < state.revision
      ) {
        return state;
      }
      if (action.activeTurn) {
        return hydrateActiveTurn(state, action.activeTurn);
      }
      return {
        ...state,
        revision: action.revision ?? state.revision,
        isRunning: true,
        isThinking: true,
        ...(action.mode === "plan" && !state.plan
          ? { plan: { source: "user", items: [] } }
          : {}),
      };
    case "turn.completed":
      return completeTurn(
        state,
        action.id,
        action.output,
        false,
        action.capabilities,
        action.diagnostics,
        action.sources,
        action.citations,
        action.revision,
        action.message,
      );
    case "turn.failed":
      return completeTurn(
        state,
        action.id,
        action.error,
        true,
        [],
        action.diagnostics,
        [],
        [],
        action.revision,
        action.message,
      );
    case "agent.event":
      if (action.activeTurn) {
        if (action.activeTurn.revision <= state.revision) return state;
        return hydrateActiveTurn(state, action.activeTurn);
      }
      return reduceAgentEvent(state, action.event);
    case "process.updated":
      return updateSessionProcess(state, action.process);
    case "queue.updated":
      return {
        ...state,
        queuedTurns: action.queuedTurns,
        submissionError: undefined,
      };
    case "follow-up.consumed": {
      const preceding = action.precedingAssistantMessage;
      const appended = [
        ...(preceding &&
        !state.messages.some(({ id }) => id === preceding.id)
          ? [preceding]
          : []),
        ...(state.messages.some(({ id }) => id === action.message.id)
          ? []
          : [action.message]),
      ];
      return {
        ...state,
        queuedTurns: state.queuedTurns.filter(
          ({ id }) => id !== action.itemId,
        ),
        ...(action.precedingAssistantMessage
          ? { progress: [], streamingText: "" }
          : {}),
        messages:
          appended.length === 0
            ? state.messages
            : [...state.messages, ...appended],
      };
    }
    case "submission.failed":
      return { ...state, submissionError: action.error };
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
      if (event.outputVisibility === "provisional") {
        return {
          ...state,
          isThinking: true,
          streamingText: "",
        };
      }
      return {
        ...state,
        isThinking: false,
        streamingText: state.streamingText + event.delta,
      };
    case "model.completed":
      return {
        ...state,
        isThinking: false,
        streamingText:
          event.toolCalls.length > 0 ||
          event.outputVisibility === "provisional"
            ? ""
            : event.text,
        progress: projectAgentProgress(state.progress, event),
        plan: projectAgentPlan(state.plan, event),
      };
    case "tool.started":
      return {
        ...state,
        isThinking: false,
        progress: projectAgentProgress(state.progress, event),
        plan: projectAgentPlan(state.plan, event),
      };
    case "tool.completed":
      return {
        ...state,
        progress: projectAgentProgress(state.progress, event),
        plan: projectAgentPlan(state.plan, event),
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
  capabilities: readonly MessageCapabilityData[] = [],
  diagnostics?: TurnDiagnosticsData,
  sources: readonly MessageSourceData[] = [],
  citations: readonly MessageCitationData[] = [],
  revision?: number,
  message?: ConversationMessageData,
): SessionState {
  if (revision !== undefined && revision < state.revision) return state;
  const assistantMessage: ConversationMessage =
    message ?? {
      id,
      role: "assistant",
      text,
      error,
      ...(state.progress.length > 0 ? { progress: state.progress } : {}),
      ...(state.plan ? { plan: state.plan } : {}),
      ...(!error && capabilities.length > 0 ? { capabilities } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      ...(sources.length > 0 ? { sources, citations } : {}),
    };
  return {
    ...state,
    revision: revision ?? state.revision,
    isRunning: false,
    isThinking: false,
    progress: [],
    plan: undefined,
    streamingText: "",
    messages: mergeMessages(state.messages, [assistantMessage]),
  };
}

function hydrateActiveTurn(
  state: SessionState,
  activeTurn: ActiveTurnData,
): SessionState {
  return {
    ...state,
    revision: activeTurn.revision,
    isRunning: true,
    isThinking: activeTurn.isThinking,
    progress: activeTurn.progress,
    plan: activeTurn.plan,
    streamingText: activeTurn.streamingText,
  };
}

function mergeMessages(
  first: readonly ConversationMessage[],
  second: readonly ConversationMessage[],
): readonly ConversationMessage[] {
  const messages = [...first];
  const ids = new Set(messages.map(({ id }) => id));
  for (const message of second) {
    if (ids.has(message.id)) continue;
    ids.add(message.id);
    messages.push(message);
  }
  return messages;
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
      mode: TurnMode,
      capabilityRefs: readonly string[],
      accessMode: ConversationAccessMode,
    ): Promise<unknown>;
  },
  threadId: string,
  text: string,
  attachments: readonly AttachmentData[],
  mode: TurnMode = "default",
  capabilityRefs: readonly string[] = [],
  accessMode: ConversationAccessMode = "approval",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.startTurn(
      threadId,
      text,
      attachments,
      mode,
      capabilityRefs,
      accessMode,
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function requestNewThreadTurnStart(
  client: {
    initialize(): Promise<unknown>;
    startThread(): Promise<{ threadId: string }>;
    startTurn(
      threadId: string,
      text: string,
      attachments: readonly AttachmentData[],
      mode: TurnMode,
      capabilityRefs: readonly string[],
      accessMode: ConversationAccessMode,
    ): Promise<unknown>;
  },
  text: string,
  attachments: readonly AttachmentData[],
  mode: TurnMode,
  capabilityRefs: readonly string[],
  accessMode: ConversationAccessMode,
  onThreadCreated: (threadId: string) => void,
): Promise<{
  threadId: string;
  started: { ok: true } | { ok: false; error: string };
}> {
  await client.initialize();
  const { threadId } = await client.startThread();
  onThreadCreated(threadId);
  return {
    threadId,
    started: await requestTurnStart(
      client,
      threadId,
      text,
      attachments,
      mode,
      capabilityRefs,
      accessMode,
    ),
  };
}

export function newTaskDraftState(
  state: SessionState,
  submissionError?: string,
): SessionState {
  return {
    ...initialSessionState,
    connection: state.connection,
    connectionError: state.connectionError,
    submissionError,
  };
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
        queuedTurns?: readonly QueuedTurnData[];
        revision?: number;
        activeTurn?: ActiveTurnData;
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
        queuedTurns: opened.queuedTurns,
        revision: opened.revision,
        activeTurn: opened.activeTurn,
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
      client.on("turn/started", ({
        threadId,
        mode,
        revision,
        activeTurn,
      }) => {
        updateSession(threadId, {
          type: "turn.started",
          mode,
          revision,
          activeTurn,
        });
      }),
      client.on("turn/completed", ({
        threadId,
        revision,
        message,
        output,
        capabilities,
        diagnostics,
        sources,
        citations,
      }) => {
        updateSession(threadId, {
          type: "turn.completed",
          id: crypto.randomUUID(),
          output,
          revision,
          message,
          capabilities,
          diagnostics,
          sources,
          citations,
        });
      }),
      client.on("turn/failed", ({
        threadId,
        revision,
        message,
        error,
        diagnostics,
      }) => {
        updateSession(threadId, {
          type: "turn.failed",
          id: crypto.randomUUID(),
          error,
          revision,
          message,
          diagnostics,
        });
      }),
      client.on("agent/event", ({
        threadId,
        revision,
        activeTurn,
        event,
      }) => {
        updateSession(threadId, {
          type: "agent.event",
          event,
          revision,
          activeTurn,
        });
      }),
      client.on("turn/queue/updated", ({ threadId, queuedTurns }) => {
        updateSession(threadId, { type: "queue.updated", queuedTurns });
      }),
      client.on(
        "turn/follow-up/consumed",
        ({
          threadId,
          itemId,
          message,
          precedingAssistantMessage,
        }) => {
          updateSession(threadId, {
            type: "follow-up.consumed",
            itemId,
            message,
            ...(precedingAssistantMessage
              ? { precedingAssistantMessage }
              : {}),
          });
        },
      ),
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
    async (
      value: string,
      attachments: readonly AttachmentData[] = [],
      mode: TurnMode = "default",
      capabilities: readonly CapabilityDescriptor[] = [],
      accessMode: ConversationAccessMode = "approval",
    ) => {
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
        mode,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(capabilities.length > 0
          ? {
              capabilityRefs: capabilities.map(({ id }) => id),
              capabilities: capabilities.map(
                ({ id, kind, name, source, icon }) => ({
                  id,
                  kind,
                  name,
                  ...(source ? { source } : {}),
                  ...(icon ? { icon } : {}),
                }),
              ),
            }
          : {}),
      });
      const started = await requestTurnStart(
        client,
        threadId,
        text,
        attachments,
        mode,
        capabilities.map(({ id }) => id),
        accessMode,
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

  const sendNewThread = useCallback(
    async (
      value: string,
      attachments: readonly AttachmentData[] = [],
      mode: TurnMode = "default",
      capabilities: readonly CapabilityDescriptor[] = [],
      accessMode: ConversationAccessMode = "approval",
    ) => {
      const text = value.trim();
      if (!text && attachments.length === 0) return;

      const optimisticMessageId = crypto.randomUUID();
      const capabilityRefs = capabilities.map(({ id }) => id);
      try {
        const result = await requestNewThreadTurnStart(
          client,
          text,
          attachments,
          mode,
          capabilityRefs,
          accessMode,
          (threadId) => {
            activateThread(threadId);
            updateSession(threadId, {
              type: "connection.ready",
              threadId,
            });
            updateSession(threadId, {
              type: "message.sent",
              id: optimisticMessageId,
              text,
              mode,
              ...(attachments.length > 0 ? { attachments } : {}),
              ...(capabilities.length > 0
                ? {
                    capabilityRefs,
                    capabilities: capabilities.map(
                      ({ id, kind, name, source, icon }) => ({
                        id,
                        kind,
                        name,
                        ...(source ? { source } : {}),
                        ...(icon ? { icon } : {}),
                      }),
                    ),
                  }
                : {}),
            });
          },
        );
        if (!result.started.ok) {
          updateSession(result.threadId, {
            type: "message.rejected",
            id: optimisticMessageId,
            error: result.started.error,
          });
          return { threadId: result.threadId, sent: false as const };
        }
        return { threadId: result.threadId, sent: true as const };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    [activateThread, client, updateSession],
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

  const addFollowUp = useCallback(
    async (value: string, delivery: FollowUpDelivery) => {
      const input = value.trim();
      if (!input || !state.threadId || !state.isRunning) return false;
      try {
        await client.addFollowUp(state.threadId, input, delivery);
        return true;
      } catch (error) {
        updateSession(state.threadId, {
          type: "submission.failed",
          error: errorMessage(error),
        });
        return false;
      }
    },
    [client, state.isRunning, state.threadId, updateSession],
  );

  const reorderQueuedTurn = useCallback(
    async (itemId: string, beforeItemId?: string) => {
      if (!state.threadId) return false;
      try {
        await client.reorderQueuedTurn(
          state.threadId,
          itemId,
          beforeItemId,
        );
        return true;
      } catch (error) {
        updateSession(state.threadId, {
          type: "submission.failed",
          error: errorMessage(error),
        });
        return false;
      }
    },
    [client, state.threadId, updateSession],
  );

  const cancelQueuedTurn = useCallback(
    async (itemId: string) => {
      if (!state.threadId) return false;
      try {
        const result = await client.cancelQueuedTurn(
          state.threadId,
          itemId,
        );
        return result.canceled;
      } catch (error) {
        updateSession(state.threadId, {
          type: "submission.failed",
          error: errorMessage(error),
        });
        return false;
      }
    },
    [client, state.threadId, updateSession],
  );

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
    sendNewThread,
    addFollowUp,
    reorderQueuedTurn,
    cancelQueuedTurn,
    interrupt,
    terminateProcess,
  };
}
