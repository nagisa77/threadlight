import type { ActiveTurnData } from "@threadlight/protocol";

import type { SessionState } from "./session.js";

export function hydrateActiveTurn(
  state: SessionState,
  activeTurn: ActiveTurnData,
): SessionState {
  return {
    ...state,
    revision: activeTurn.revision,
    isRunning: true,
    isThinking: activeTurn.isThinking,
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
