import { useCallback, useEffect, useReducer } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type { AgentEventData, ToolCallData } from "@threadlight/protocol";

export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  detail?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
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
  activities: readonly ToolActivity[];
  approval?: PendingApproval;
}

export type SessionAction =
  | { type: "connection.connecting" }
  | { type: "connection.ready"; threadId: string }
  | { type: "connection.failed"; error: string }
  | { type: "message.sent"; id: string; text: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; id: string; output: string }
  | { type: "turn.failed"; id: string; error: string }
  | { type: "agent.event"; event: AgentEventData };

export const initialSessionState: SessionState = {
  connection: "connecting",
  isRunning: false,
  isThinking: false,
  messages: [],
  activities: [],
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
        activities: [],
        approval: undefined,
        messages: [
          ...state.messages,
          { id: action.id, role: "user", text: action.text },
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
  }
}

function reduceAgentEvent(
  state: SessionState,
  event: AgentEventData,
): SessionState {
  switch (event.type) {
    case "model.started":
      return { ...state, isThinking: true };
    case "model.completed":
      return { ...state, isThinking: false };
    case "tool.started":
      return {
        ...state,
        isThinking: false,
        activities: [
          ...state.activities,
          {
            id: event.call.id,
            name: event.call.name,
            status: "running",
            detail: toolInput(event.call),
          },
        ],
      };
    case "tool.completed":
      return {
        ...state,
        activities: state.activities.map((activity) =>
          activity.id === event.result.callId
            ? {
                ...activity,
                status: event.result.isError ? "failed" : "completed",
                detail:
                  activity.name === "exec_command"
                    ? activity.detail
                    : truncate(event.result.output),
              }
            : activity,
        ),
      };
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
    activities: [],
    approval: undefined,
    messages: [
      ...state.messages,
      {
        id,
        role: "assistant",
        text,
        error,
        activities: state.activities,
      },
    ],
  };
}

function truncate(value: string, limit = 1_200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function toolInput(call: ToolCallData): string | undefined {
  if (call.name !== "exec_command" || !isObject(call.arguments)) return;
  const command = call.arguments.command;
  return typeof command === "string" ? `$ ${command}` : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useThreadlightSession(client: ThreadlightClient) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  const connect = useCallback(async () => {
    dispatch({ type: "connection.connecting" });
    try {
      await client.initialize();
      const { threadId } = await client.startThread();
      dispatch({ type: "connection.ready", threadId });
    } catch (error) {
      dispatch({ type: "connection.failed", error: errorMessage(error) });
    }
  }, [client]);

  useEffect(() => {
    const subscriptions = [
      client.on("turn/started", () => dispatch({ type: "turn.started" })),
      client.on("turn/completed", ({ output }) =>
        dispatch({ type: "turn.completed", id: crypto.randomUUID(), output }),
      ),
      client.on("turn/failed", ({ error }) =>
        dispatch({ type: "turn.failed", id: crypto.randomUUID(), error }),
      ),
      client.on("agent/event", ({ event }) =>
        dispatch({ type: "agent.event", event }),
      ),
    ];

    void connect();
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [client, connect]);

  const newThread = useCallback(async () => {
    if (state.isRunning) return;
    try {
      const { threadId } = await client.startThread();
      dispatch({ type: "connection.ready", threadId });
    } catch (error) {
      dispatch({ type: "connection.failed", error: errorMessage(error) });
    }
  }, [client, state.isRunning]);

  const send = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || !state.threadId || state.isRunning) return false;

      dispatch({ type: "message.sent", id: crypto.randomUUID(), text });
      try {
        await client.startTurn(state.threadId, text);
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

  return {
    state,
    retry: connect,
    newThread,
    send,
    interrupt,
    resolveApproval,
  };
}
