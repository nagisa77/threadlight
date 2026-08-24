import type {
  AgentRunCheckpoint,
  AgentTaskMessage,
  AgentTaskSnapshot,
  AgentTreeUpdateReason,
  ModelConversationMessage,
  ResumableAgentThread,
  SubagentProfile,
} from "./types.js";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export interface AgentTaskRecord {
  snapshot: AgentTaskSnapshot;
  profile?: SubagentProfile;
  controller: AbortController;
  completion: Deferred<AgentTaskSnapshot>;
  pendingInput: string[];
  collected: boolean;
  modelState?: unknown;
  contextTokens?: number;
  checkpointStep?: number;
  checkpointPhase?: AgentRunCheckpoint["phase"];
  execution?: Promise<void>;
  history?: readonly ModelConversationMessage[];
  contextHistory?: readonly ModelConversationMessage[];
  /** Monotonic in-memory revision used for incremental status delivery. */
  revision: number;
  /** Exact result, kept out of ordinary collaboration status payloads. */
  fullOutput?: string;
}

export interface SpawnOptions {
  callerId?: string;
  parentId?: string;
  name?: string;
  agentPath?: string;
  retryOf?: string;
  followUpOf?: string;
  agentThreadId?: string;
  modelState?: unknown;
  contextTokens?: number;
  history?: readonly ModelConversationMessage[];
  message?: AgentTaskMessage;
}

export interface AgentMailboxEvent {
  agentId: string;
  agentThreadId: string;
  reason: AgentTreeUpdateReason;
}

export interface AgentMailboxWaiter {
  threadIds: ReadonlySet<string>;
  resolve(event: AgentMailboxEvent): void;
}

export interface AgentLifecycleTarget {
  threadId: string;
  records: AgentTaskRecord[];
  resumable?: ResumableAgentThread;
}
