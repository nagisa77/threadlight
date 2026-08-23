import type {
  Agent,
  AgentOrchestrator,
  AgentTreeSnapshot,
} from "@threadlight/agent-loop";

import type {
  AgentPlanData,
  ConversationAccessMode,
  ConversationProgressData,
  ModelRetryData,
  TokenUsageData,
  TurnMode,
} from "./protocol.js";
import type { StoredConversation } from "./conversation-store.js";
import type { PromptSnapshot } from "./prompt-composer.js";
import type { SourceCitationRunController } from "./source-citations.js";
import type { ThreadRuntime } from "./app-server.js";

export interface ThreadState {
  agent: Agent;
  accessMode: ConversationAccessMode;
  promptSnapshot: PromptSnapshot;
  conversation: StoredConversation;
  revision: number;
  progress: readonly ConversationProgressData[];
  plan?: AgentPlanData;
  runtime?: ThreadRuntime;
  activeTurn?: {
    id: string;
    mode: TurnMode;
    isThinking: boolean;
    modelRetry?: ModelRetryData;
    streamingText: string;
    metrics: {
      startedAt: string;
      usage: TokenUsageData;
      modelDurationMs: number;
      completedModelSteps: number;
      streamedBytes: number;
    };
    controller: AbortController;
    sourceCitations?: SourceCitationRunController;
    orchestrator?: AgentOrchestrator;
    agentTree?: AgentTreeSnapshot;
  };
  pendingAssistantOutput?: { text: string };
  injectedInputPendingModelResponse?: boolean;
  titleRequest?: {
    controller: AbortController;
    promise: Promise<void>;
  };
  conversationMutation: Promise<void>;
}
