import type {
  ActiveTurnData,
  ConversationMessageData,
  MessageCapabilityData,
  MessageSourceData,
  TurnDiagnosticsData,
} from "@threadlight/protocol";

import type { ConversationMessage, SessionState } from "./session.js";

export function hydrateActiveTurn(
  state: SessionState,
  activeTurn: ActiveTurnData,
): SessionState {
  return {
    ...state,
    revision: activeTurn.revision,
    isRunning: true,
    isThinking: activeTurn.isThinking,
    continuationAvailable: false,
    modelRetry: activeTurn.modelRetry,
    progress: activeTurn.progress,
    agentTree: activeTurn.agentTree ?? state.agentTree,
    runMetrics: activeTurn.metrics ?? state.runMetrics,
    plan: activeTurn.plan,
    streamingText: activeTurn.streamingText,
    streamingSources: activeTurn.sources,
    streamingCitations: activeTurn.citations,
  };
}

export function completeSessionTurn(
  state: SessionState,
  id: string,
  text: string,
  error = false,
  capabilities: readonly MessageCapabilityData[] = [],
  diagnostics?: TurnDiagnosticsData,
  sources: readonly MessageSourceData[] = [],
  citations: SessionState["streamingCitations"] = [],
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
    continuationAvailable: false,
    modelRetry: undefined,
    progress: [],
    agentTree: undefined,
    runMetrics: undefined,
    plan: undefined,
    streamingText: "",
    streamingSources: undefined,
    streamingCitations: undefined,
    messages: state.messages.some(
      ({ id: existing }) => existing === message?.id,
    )
      ? state.messages
      : [...state.messages, assistantMessage],
  };
}
