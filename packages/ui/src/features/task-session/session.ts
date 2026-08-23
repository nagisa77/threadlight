import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserUuid, type ThreadlightClient } from "@threadlight/client";
import {
  projectAgentProgress,
  projectAgentPlan,
  projectMessagesProcess,
  projectProgressProcess,
  runningProcessSessionIds,
  type ActiveTurnMetricsData,
  type ActiveTurnData,
  type AttachmentData,
  type AgentPlanData,
  type AgentTreeData,
  type AgentEventData,
  type CapabilityDescriptor,
  type ConversationAccessMode,
  type ConversationActivityData,
  type ConversationMessageData,
  type ConversationProgressData,
  type FollowUpDelivery,
  type MessageCapabilityData,
  type MessageCitationData,
  type ModelRetryData,
  type MessageSourceData,
  type ProcessSnapshotData,
  type QueuedTurnData,
  type TaskDevelopmentMode,
  type TurnDiagnosticsData,
  type TurnMode,
} from "@threadlight/protocol";
import {
  requestNewThreadTurnStart,
  requestThreadOpen,
  requestTurnStart,
} from "./session-requests.js";
import { hydrateActiveTurn } from "./session-state.js";
export {
  requestNewThreadTurnStart,
  requestThreadOpen,
  requestTurnStart,
  type OpenedThread,
  type ThreadOpenResult,
} from "./session-requests.js";

export type ToolActivity = ConversationActivityData;
export type ConversationProgress = ConversationProgressData;

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: readonly AttachmentData[];
  followUpDelivery?: FollowUpDelivery;
  capabilityRefs?: readonly string[];
  capabilities?: readonly MessageCapabilityData[];
  error?: boolean;
  mode?: TurnMode;
  plan?: AgentPlanData;
  progress?: readonly ConversationProgress[];
  agentTree?: AgentTreeData;
  activities?: readonly ToolActivity[];
  diagnostics?: TurnDiagnosticsData;
  sources?: readonly MessageSourceData[];
  citations?: readonly MessageCitationData[];
}

export interface SessionState {
  connection: "connecting" | "ready" | "error";
  connectionError?: string;
  recovery?: {
    kind: "missing_thread";
    threadId: string;
  };
  threadId?: string;
  revision: number;
  /** Provider/model selected for this conversation, if any. */
  provider?: string;
  model?: string;
  isRunning: boolean;
  isThinking: boolean;
  modelRetry?: ModelRetryData;
  runMetrics?: ActiveTurnMetricsData;
  messages: readonly ConversationMessage[];
  queuedTurns: readonly QueuedTurnData[];
  progress: readonly ConversationProgress[];
  agentTree?: AgentTreeData;
  plan?: AgentPlanData;
  streamingText: string;
  streamingSources?: readonly MessageSourceData[];
  streamingCitations?: readonly MessageCitationData[];
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
      provider?: string;
      model?: string;
    }
  | { type: "connection.failed"; error: string }
  | { type: "connection.missing_thread"; threadId: string }
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
  | {
      type: "agent.tree";
      tree: AgentTreeData;
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
  | { type: "submission.failed"; error: string }
  | { type: "submission.cleared" }
  | { type: "model.selected"; provider: string; model: string };

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
      return {
        ...state,
        connection: "connecting",
        connectionError: undefined,
        recovery: undefined,
      };
    case "connection.ready": {
      const revision = action.revision ?? action.activeTurn?.revision ?? 0;
      if (state.revision > revision) {
        return {
          ...state,
          connection: "ready",
          connectionError: undefined,
          recovery: undefined,
          threadId: action.threadId,
          ...(action.provider ? { provider: action.provider } : {}),
          ...(action.model ? { model: action.model } : {}),
          messages: mergeMessages(action.messages ?? [], state.messages),
        };
      }
      return {
        ...initialSessionState,
        connection: "ready",
        threadId: action.threadId,
        revision,
        ...(action.provider ? { provider: action.provider } : {}),
        ...(action.model ? { model: action.model } : {}),
        messages: action.messages ?? [],
        queuedTurns: action.queuedTurns ?? [],
        isRunning: action.activeTurn !== undefined,
        isThinking: action.activeTurn?.isThinking ?? false,
        modelRetry: action.activeTurn?.modelRetry,
        progress: action.activeTurn?.progress ?? [],
        agentTree: action.activeTurn?.agentTree,
        plan: action.activeTurn?.plan,
        runMetrics: action.activeTurn?.metrics,
        streamingText: action.activeTurn?.streamingText ?? "",
        streamingSources: action.activeTurn?.sources,
        streamingCitations: action.activeTurn?.citations,
      };
    }
    case "connection.failed":
      return {
        ...state,
        connection: "error",
        connectionError: action.error,
        recovery: undefined,
        isRunning: false,
        isThinking: false,
        modelRetry: undefined,
        runMetrics: undefined,
      };
    case "connection.missing_thread":
      return {
        ...state,
        connection: "error",
        connectionError: undefined,
        threadId: action.threadId,
        recovery: { kind: "missing_thread", threadId: action.threadId },
        isRunning: false,
        isThinking: false,
        modelRetry: undefined,
        runMetrics: undefined,
      };
    case "message.sent":
      return {
        ...state,
        isRunning: true,
        isThinking: true,
        modelRetry: undefined,
        progress: [],
        agentTree: undefined,
        runMetrics: undefined,
        plan:
          action.mode === "plan" ? { source: "user", items: [] } : undefined,
        streamingText: "",
        streamingSources: undefined,
        streamingCitations: undefined,
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
        modelRetry: undefined,
        progress: [],
        plan: undefined,
        runMetrics: undefined,
        streamingText: "",
        streamingSources: undefined,
        streamingCitations: undefined,
        submissionError: action.error,
        messages: state.messages.filter((message) => message.id !== action.id),
      };
    case "turn.started":
      if (action.revision !== undefined && action.revision < state.revision) {
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
        modelRetry: undefined,
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
    case "agent.tree":
      if (action.activeTurn) {
        if (action.activeTurn.revision < state.revision) return state;
        return {
          ...hydrateActiveTurn(state, action.activeTurn),
          agentTree: action.tree,
        };
      }
      if (action.revision !== undefined && action.revision < state.revision) {
        return state;
      }
      return {
        ...state,
        revision: action.revision ?? state.revision,
        agentTree: action.tree,
      };
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
        ...(preceding && !state.messages.some(({ id }) => id === preceding.id)
          ? [preceding]
          : []),
        ...(state.messages.some(({ id }) => id === action.message.id)
          ? []
          : [action.message]),
      ];
      return {
        ...state,
        queuedTurns: state.queuedTurns.filter(({ id }) => id !== action.itemId),
        ...(action.precedingAssistantMessage
          ? {
              progress: [],
              streamingText: "",
              streamingSources: undefined,
              streamingCitations: undefined,
            }
          : {}),
        messages:
          appended.length === 0
            ? state.messages
            : [...state.messages, ...appended],
      };
    }
    case "submission.failed":
      return { ...state, submissionError: action.error };
    case "submission.cleared":
      return state.submissionError === undefined
        ? state
        : { ...state, submissionError: undefined };
    case "model.selected":
      return {
        ...state,
        provider: action.provider,
        model: action.model,
      };
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

export function mergeRunningThreadIds(
  persisted: readonly string[],
  sessions: Readonly<Record<string, SessionState>>,
): readonly string[] {
  return [
    ...new Set([
      ...persisted,
      ...Object.values(sessions)
        .filter((session) => session.isRunning && session.threadId)
        .map((session) => session.threadId as string),
    ]),
  ];
}

function reduceAgentEvent(
  state: SessionState,
  event: AgentEventData,
): SessionState {
  switch (event.type) {
    case "model.started":
      return {
        ...state,
        isThinking: true,
        modelRetry: undefined,
        streamingText: "",
        streamingSources: undefined,
        streamingCitations: undefined,
      };
    case "model.retrying":
      return {
        ...state,
        isThinking: true,
        modelRetry: {
          retryAttempt: event.retryAttempt,
          maxRetries: event.maxRetries,
          reason: event.reason,
        },
      };
    case "model.output_text.delta":
      if (event.outputVisibility === "provisional") {
        return {
          ...state,
          isThinking: true,
          modelRetry: undefined,
          streamingText: "",
          streamingSources: undefined,
          streamingCitations: undefined,
        };
      }
      return {
        ...state,
        isThinking: false,
        modelRetry: undefined,
        streamingText: state.streamingText + event.delta,
      };
    case "model.completed":
      return {
        ...state,
        isThinking: false,
        modelRetry: undefined,
        streamingText:
          event.toolCalls.length > 0 || event.outputVisibility === "provisional"
            ? ""
            : event.text,
        progress: projectAgentProgress(state.progress, event),
        plan: projectAgentPlan(state.plan, event),
      };
    case "tool.started":
      return {
        ...state,
        isThinking: false,
        modelRetry: undefined,
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
      return { ...state, isThinking: false, modelRetry: undefined };
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
  const assistantMessage: ConversationMessage = message ?? {
    id,
    role: "assistant",
    text,
    error,
    ...(state.progress.length > 0 ? { progress: state.progress } : {}),
    ...(state.plan ? { plan: state.plan } : {}),
    ...(state.agentTree ? { agentTree: state.agentTree } : {}),
    ...(!error && capabilities.length > 0 ? { capabilities } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(sources.length > 0 ? { sources, citations } : {}),
  };
  return {
    ...state,
    revision: revision ?? state.revision,
    isRunning: false,
    isThinking: false,
    modelRetry: undefined,
    progress: [],
    agentTree: undefined,
    runMetrics: undefined,
    plan: undefined,
    streamingText: "",
    streamingSources: undefined,
    streamingCitations: undefined,
    messages: mergeMessages(state.messages, [assistantMessage]),
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

type ProcessSessionUpdate = (
  threadId: string,
  action: Extract<SessionAction, { type: "process.updated" }>,
) => void;

export function runningProcessSessionOwners(
  sessions: Readonly<Record<string, SessionState>>,
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const [threadId, session] of Object.entries(sessions)) {
    for (const sessionId of runningProcessSessionIds(
      session.progress,
      session.messages,
    )) {
      owners.set(sessionId, threadId);
    }
  }
  return owners;
}

export async function pollOwnedProcess(
  client: Pick<ThreadlightClient, "processStatus">,
  sessionId: string,
  ownerThreadId: string,
  updateSession: ProcessSessionUpdate,
): Promise<ProcessSnapshotData> {
  const process = await client.processStatus(sessionId);
  updateSession(ownerThreadId, { type: "process.updated", process });
  return process;
}

export async function terminateOwnedProcess(
  client: Pick<ThreadlightClient, "killProcess">,
  sessionId: string,
  ownerThreadId: string | undefined,
  updateSession: ProcessSessionUpdate,
): Promise<ProcessSnapshotData> {
  const process = await client.killProcess(sessionId);
  if (ownerThreadId) {
    updateSession(ownerThreadId, { type: "process.updated", process });
  }
  return process;
}

export function newTaskDraftState(
  state: SessionState,
  submissionError?: string,
): SessionState {
  return {
    ...initialSessionState,
    // A draft has no runtime-owned thread or workspace until the first send,
    // so the user can still choose Local or Worktree without creating and
    // discarding hidden checkouts.
    connection:
      state.recovery?.kind === "missing_thread"
        ? "ready"
        : state.connection === "error"
          ? "error"
          : "ready",
    connectionError:
      state.recovery?.kind === "missing_thread"
        ? undefined
        : state.connectionError,
    ...(state.provider ? { provider: state.provider } : {}),
    ...(state.model ? { model: state.model } : {}),
    submissionError,
  };
}

export function useThreadlightSession(
  client: ThreadlightClient,
  options: {
    autoConnect?: boolean;
    runningThreadIds?: readonly string[];
  } = {},
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

  const openThread = useCallback(
    async (threadId?: string) => {
      if (threadId) {
        activateThread(threadId);
        updateSession(threadId, { type: "connection.connecting" });
      }
      try {
        const result = await requestThreadOpen(client, threadId);
        if (result.status === "missing") {
          activateThread(result.threadId);
          updateSession(result.threadId, {
            type: "connection.missing_thread",
            threadId: result.threadId,
          });
          return;
        }
        const opened = result.thread;
        activateThread(opened.threadId);
        updateSession(opened.threadId, {
          type: "connection.ready",
          threadId: opened.threadId,
          messages: opened.messages,
          queuedTurns: opened.queuedTurns,
          revision: opened.revision,
          activeTurn: opened.activeTurn,
          provider: opened.provider,
          model: opened.model,
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
    },
    [activateThread, client, updateSession],
  );

  useEffect(() => {
    const subscriptions = [
      client.on("turn/started", ({ threadId, mode, revision, activeTurn }) => {
        updateSession(threadId, {
          type: "turn.started",
          mode,
          revision,
          activeTurn,
        });
      }),
      client.on(
        "turn/completed",
        ({
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
            id: createBrowserUuid(),
            output,
            revision,
            message,
            capabilities,
            diagnostics,
            sources,
            citations,
          });
        },
      ),
      client.on(
        "turn/failed",
        ({ threadId, revision, message, error, diagnostics }) => {
          updateSession(threadId, {
            type: "turn.failed",
            id: createBrowserUuid(),
            error,
            revision,
            message,
            diagnostics,
          });
        },
      ),
      client.on("agent/event", ({ threadId, revision, activeTurn, event }) => {
        updateSession(threadId, {
          type: "agent.event",
          event,
          revision,
          activeTurn,
        });
      }),
      client.on(
        "agent/tree-updated",
        ({ threadId, revision, activeTurn, tree }) => {
          updateSession(threadId, {
            type: "agent.tree",
            tree,
            revision,
            activeTurn,
          });
        },
      ),
      client.on("turn/queue/updated", ({ threadId, queuedTurns }) => {
        updateSession(threadId, { type: "queue.updated", queuedTurns });
      }),
      client.on(
        "turn/follow-up/consumed",
        ({ threadId, itemId, message, precedingAssistantMessage }) => {
          updateSession(threadId, {
            type: "follow-up.consumed",
            itemId,
            message,
            ...(precedingAssistantMessage ? { precedingAssistantMessage } : {}),
          });
        },
      ),
    ];

    if (options.autoConnect !== false) void openThread();
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [client, openThread, options.autoConnect, updateSession]);

  const state =
    (activeThreadIdValue ? sessions[activeThreadIdValue] : undefined) ??
    initialSessionState;
  const runningThreadIds = useMemo(
    () => mergeRunningThreadIds(options.runningThreadIds ?? [], sessions),
    [options.runningThreadIds, sessions],
  );

  const runningProcessOwnerKey = useMemo(
    () => JSON.stringify([...runningProcessSessionOwners(sessions)]),
    [sessions],
  );
  useEffect(() => {
    const processOwners = JSON.parse(
      runningProcessOwnerKey,
    ) as readonly (readonly [string, string])[];
    if (processOwners.length === 0) return;
    let active = true;
    const poll = (): void => {
      for (const [sessionId, ownerThreadId] of processOwners) {
        void pollOwnedProcess(
          client,
          sessionId,
          ownerThreadId,
          (threadId, action) => {
            if (active) updateSession(threadId, action);
          },
        ).catch(() => {
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
  }, [client, runningProcessOwnerKey, updateSession]);

  const newThread = useCallback(
    async (developmentMode?: TaskDevelopmentMode) => {
      try {
        // A freshly switched project runtime requires initialization before
        // any thread can be created, so initialize unconditionally.
        await client.initialize();
        const { threadId } = await client.startThread(developmentMode);
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
    },
    [activateThread, client, updateSession],
  );

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
      provider?: string,
      model?: string,
    ) => {
      const text = value.trim();
      if (
        (!text && attachments.length === 0) ||
        !state.threadId ||
        state.isRunning
      ) {
        return false;
      }

      const optimisticMessageId = createBrowserUuid();
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
        provider,
        model,
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
      provider?: string,
      model?: string,
      developmentMode: TaskDevelopmentMode = "local",
    ) => {
      const text = value.trim();
      if (!text && attachments.length === 0) return;

      const optimisticMessageId = createBrowserUuid();
      const capabilityRefs = capabilities.map(({ id }) => id);
      try {
        const result = await requestNewThreadTurnStart(
          client,
          text,
          attachments,
          mode,
          capabilityRefs,
          accessMode,
          provider,
          model,
          developmentMode,
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
    async (
      value: string,
      delivery: FollowUpDelivery,
      attachments: readonly AttachmentData[] = [],
    ) => {
      const input = value.trim();
      if (
        (!input && attachments.length === 0) ||
        !state.threadId ||
        !state.isRunning
      ) {
        return false;
      }
      try {
        await client.addFollowUp(state.threadId, input, delivery, attachments);
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

  const injectQueuedTurn = useCallback(
    async (itemId: string) => {
      if (!state.threadId || !state.isRunning) return false;
      try {
        await client.injectQueuedTurn(state.threadId, itemId);
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
        await client.reorderQueuedTurn(state.threadId, itemId, beforeItemId);
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
        const result = await client.cancelQueuedTurn(state.threadId, itemId);
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
      const ownerThreadId =
        runningProcessSessionOwners(sessionsRef.current).get(sessionId) ??
        activeThreadId.current;
      return terminateOwnedProcess(
        client,
        sessionId,
        ownerThreadId,
        updateSession,
      );
    },
    [client, updateSession],
  );

  const setThreadModel = useCallback(
    (threadId: string, provider: string, model: string) => {
      updateSession(threadId, {
        type: "model.selected",
        provider,
        model,
      });
    },
    [updateSession],
  );

  const clearSubmissionError = useCallback(
    (threadId?: string) => {
      const target = threadId ?? activeThreadId.current;
      if (target) updateSession(target, { type: "submission.cleared" });
    },
    [updateSession],
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
    injectQueuedTurn,
    reorderQueuedTurn,
    cancelQueuedTurn,
    interrupt,
    terminateProcess,
    setThreadModel,
    clearSubmissionError,
  };
}
