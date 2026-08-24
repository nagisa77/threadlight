import { useCallback } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type { ConversationAccessMode } from "@threadlight/protocol";

import { requestTurnContinuation } from "./session-requests.js";
import type { SessionAction, SessionState } from "./session.js";

type UpdateSession = (threadId: string, action: SessionAction) => void;

export function useTurnContinuationActions(
  client: ThreadlightClient,
  state: SessionState,
  updateSession: UpdateSession,
) {
  const continueTurn = useCallback(
    async (
      accessMode: ConversationAccessMode = "approval",
      provider?: string,
      model?: string,
    ) => {
      if (!state.threadId || state.isRunning || !canContinueSession(state)) {
        return false;
      }

      const threadId = state.threadId;
      updateSession(threadId, {
        type: "continuation.started",
      });
      const started = await requestTurnContinuation(
        client,
        threadId,
        accessMode,
        provider,
        model,
      );
      if (!started.ok) {
        updateSession(threadId, {
          type: "continuation.rejected",
          error: started.error,
        });
        return false;
      }
      return true;
    },
    [client, state, updateSession],
  );

  const interrupt = useCallback(async () => {
    if (!state.threadId) return;
    try {
      await client.interruptTurn(state.threadId);
    } catch (error) {
      updateSession(state.threadId, {
        type: "connection.failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [client, state.threadId, updateSession]);

  return { continueTurn, interrupt };
}

export function canContinueSession(
  session: Pick<SessionState, "isRunning" | "continuationAvailable">,
): boolean {
  return !session.isRunning && session.continuationAvailable;
}

export function startSessionContinuation(state: SessionState): SessionState {
  return {
    ...state,
    isRunning: true,
    isThinking: true,
    continuationAvailable: false,
    modelRetry: undefined,
    progress: [],
    agentTree: undefined,
    runMetrics: undefined,
    plan: undefined,
    streamingText: "",
    streamingSources: undefined,
    streamingCitations: undefined,
    submissionError: undefined,
  };
}

export function rejectSessionContinuation(
  state: SessionState,
  error: string,
): SessionState {
  return {
    ...state,
    isRunning: false,
    isThinking: false,
    continuationAvailable: true,
    submissionError: error,
  };
}

export function completeSessionInterruption(
  state: SessionState,
  revision?: number,
): SessionState {
  if (revision !== undefined && revision < state.revision) return state;
  return {
    ...state,
    revision: revision ?? state.revision,
    isRunning: false,
    isThinking: false,
    continuationAvailable: true,
    modelRetry: undefined,
    progress: [],
    agentTree: undefined,
    runMetrics: undefined,
    plan: undefined,
    streamingText: "",
    streamingSources: undefined,
    streamingCitations: undefined,
  };
}
