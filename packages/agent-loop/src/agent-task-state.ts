import { agentThreadId, isTerminal } from "./orchestrator-records.js";
import {
  deferred,
  elapsedSince,
  errorMessage,
} from "./orchestrator-runtime.js";
import {
  cloneSnapshot,
  summarize,
  truncate,
} from "./orchestration-transcript.js";
import type {
  AgentMailboxWaiter,
  AgentTaskRecord,
} from "./orchestrator-types.js";
import type {
  AgentRunCheckpoint,
  AgentRuntimeSnapshot,
  RunResult,
  AgentTaskSnapshot,
  AgentTreeEvent,
  AgentTreeSnapshot,
  AgentTreeUpdateReason,
  ResumableAgentThread,
  SubagentProfile,
} from "./types.js";

const MAX_PERSISTED_OUTPUT = 20_000;
const MAILBOX_UPDATE_REASONS = new Set<AgentTreeUpdateReason>([
  "created",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "followed_up",
  "closed",
  "steered",
  "messaged",
]);

export interface AgentTaskStateHost {
  records: Map<string, AgentTaskRecord>;
  wallNow(): Date;
  snapshot: AgentTreeSnapshot;
  runtimeSnapshot: AgentRuntimeSnapshot;
  mailboxWaiters: Set<AgentMailboxWaiter>;
  onAgentTreeEvent?(event: AgentTreeEvent): void;
  queueRuntimeCheckpoint(snapshot: AgentRuntimeSnapshot): void;
}

export class AgentTaskState {
  constructor(private readonly host: AgentTaskStateHost) {}

  completeRecord(record: AgentTaskRecord, result: RunResult): void {
    if (isTerminal(record.snapshot.status)) return;
    const output = truncate(result.output, MAX_PERSISTED_OUTPUT);
    this.patchRecord(record, "completed", {
      status: "completed",
      phase: "done",
      completedAt: this.host.wallNow().toISOString(),
      elapsedMs: result.durationMs,
      latestActivity: "Completed",
      summary: summarize(output),
      output,
      steps: result.steps,
      usage: { ...result.usage },
    });
    record.modelState = result.modelState;
    record.fullOutput = result.output;
    if (result.contextTokens !== undefined) {
      record.contextTokens = result.contextTokens;
    }
    if (result.contextHistory) {
      record.contextHistory = result.contextHistory.map((message) => ({
        ...message,
      }));
    }
    this.scheduleRuntimeCheckpoint();
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  failRecord(record: AgentTaskRecord, error: unknown): void {
    if (isTerminal(record.snapshot.status)) return;
    const message = errorMessage(error);
    this.patchRecord(record, "failed", {
      status: "failed",
      phase: "done",
      completedAt: this.host.wallNow().toISOString(),
      latestActivity: "Failed",
      error: message,
      summary: message,
    });
    this.scheduleRuntimeCheckpoint();
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  cancelRecord(record: AgentTaskRecord, reason: string): void {
    if (isTerminal(record.snapshot.status)) return;
    this.patchRecord(record, "cancelled", {
      status: "cancelled",
      phase: "done",
      completedAt: this.host.wallNow().toISOString(),
      latestActivity: "Stopped",
      error: reason,
      summary: reason,
    });
    this.scheduleRuntimeCheckpoint();
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  interruptRecord(record: AgentTaskRecord, reason: string): void {
    if (isTerminal(record.snapshot.status)) return;
    const completedAt = this.host.wallNow().toISOString();
    this.patchRecord(record, "interrupted", {
      status: "interrupted",
      phase: "done",
      completedAt,
      latestActivity: "Interrupted",
      error: reason,
      summary: reason,
      activities: record.snapshot.activities.map((activity) =>
        activity.status === "running"
          ? { ...activity, status: "failed" as const }
          : activity,
      ),
      transcript: record.snapshot.transcript.map((entry) =>
        entry.status === "running"
          ? {
              ...entry,
              status: "failed" as const,
              completedAt,
            }
          : entry,
      ),
    });
    this.scheduleRuntimeCheckpoint();
    record.completion.resolve(cloneSnapshot(record.snapshot));
  }

  patchRecord(
    record: AgentTaskRecord,
    reason: AgentTreeUpdateReason,
    patch: Partial<AgentTaskSnapshot>,
  ): void {
    record.revision += 1;
    record.snapshot = {
      ...record.snapshot,
      ...patch,
      elapsedMs:
        patch.elapsedMs ??
        elapsedSince(record.snapshot.startedAt, this.host.wallNow()),
    };
    this.emit(record, reason);
  }

  createRecord(
    snapshot: AgentTaskSnapshot,
    profile?: SubagentProfile,
  ): AgentTaskRecord {
    const record: AgentTaskRecord = {
      snapshot,
      profile,
      controller: new AbortController(),
      completion: deferred<AgentTaskSnapshot>(),
      pendingInput: [],
      collected: false,
      revision: 0,
    };
    this.host.records.set(snapshot.id, record);
    return record;
  }

  emit(record: AgentTaskRecord, reason: AgentTreeUpdateReason): void {
    const event: AgentTreeEvent = {
      type: "agent.tree.updated",
      changedAgentId: record.snapshot.id,
      reason,
      tree: this.host.snapshot,
    };
    this.host.onAgentTreeEvent?.(event);
    if (MAILBOX_UPDATE_REASONS.has(reason)) {
      this.wakeMailbox(record, reason);
    }
  }

  wakeMailbox(record: AgentTaskRecord, reason: AgentTreeUpdateReason): void {
    const event = {
      agentId: record.snapshot.id,
      agentThreadId: agentThreadId(record),
      reason,
    };
    for (const waiter of [...this.host.mailboxWaiters]) {
      if (waiter.threadIds.has(event.agentThreadId)) waiter.resolve(event);
    }
  }

  recordCheckpoint(
    record: AgentTaskRecord,
    checkpoint: AgentRunCheckpoint,
  ): void {
    record.modelState = checkpoint.modelState;
    if (checkpoint.contextTokens !== undefined) {
      record.contextTokens = checkpoint.contextTokens;
    }
    if (checkpoint.contextHistory) {
      record.contextHistory = checkpoint.contextHistory.map((message) => ({
        ...message,
      }));
    }
    record.checkpointStep = checkpoint.step;
    record.checkpointPhase = checkpoint.phase;
    record.snapshot = {
      ...record.snapshot,
      usage: { ...checkpoint.usage },
    };
    this.scheduleRuntimeCheckpoint();
  }

  scheduleRuntimeCheckpoint(): void {
    this.host.queueRuntimeCheckpoint(this.host.runtimeSnapshot);
  }
}
