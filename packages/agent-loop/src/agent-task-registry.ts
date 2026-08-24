import { normalizedTaskName } from "./collaboration-contract.js";
import {
  agentThreadId,
  uniqueAgentRecords,
  isTerminal,
} from "./orchestrator-records.js";
import {
  formatAgentMessage,
  lifecycleError,
  parentAgentPath,
} from "./orchestrator-runtime.js";
import type {
  AgentLifecycleTarget,
  AgentMailboxEvent,
  AgentMailboxWaiter,
  AgentTaskRecord,
} from "./orchestrator-types.js";
import type {
  AgentTaskMessage,
  AgentTaskSnapshot,
  AgentTreeUpdateReason,
  ModelConversationMessage,
  ResumableAgentThread,
  SubagentProfile,
} from "./types.js";

export interface AgentTaskRegistryHost {
  records: ReadonlyMap<string, AgentTaskRecord>;
  rootId: string;
  resumableThreads: ReadonlyMap<string, ResumableAgentThread>;
  resumableTaskThreads: ReadonlyMap<string, string>;
  threadClosures: ReadonlyMap<string, string>;
  wallNow(): Date;
  maxDepth: number;
  mailboxWaiters: Set<AgentMailboxWaiter>;
  closed: boolean;
  profiles: ReadonlyMap<string, SubagentProfile>;
  emit(record: AgentTaskRecord, reason: AgentTreeUpdateReason): void;
  patchRecord(
    record: AgentTaskRecord,
    reason: AgentTreeUpdateReason,
    patch: Partial<AgentTaskSnapshot>,
  ): void;
  scheduleRuntimeCheckpoint(): void;
}

export class AgentTaskRegistry {
  constructor(private readonly host: AgentTaskRegistryHost) {}

  nonRootRecords(): AgentTaskRecord[] {
    return [...this.host.records.values()].filter(
      ({ snapshot }) => snapshot.id !== this.host.rootId,
    );
  }

  recordsForThread(threadId: string): AgentTaskRecord[] {
    return [...this.host.records.values()].filter(
      (record) => agentThreadId(record) === threadId,
    );
  }

  currentRecordForThread(threadId: string): AgentTaskRecord | undefined {
    return this.recordsForThread(threadId).at(-1);
  }

  directChildRecords(parentThreadId: string): AgentTaskRecord[] {
    return this.nonRootRecords().filter(
      ({ snapshot }) => snapshot.parentId === parentThreadId,
    );
  }

  currentDirectChildRecords(parentThreadId: string): AgentTaskRecord[] {
    const records = new Map<string, AgentTaskRecord>();
    for (const record of this.directChildRecords(parentThreadId)) {
      records.set(agentThreadId(record), record);
    }
    return [...records.values()];
  }

  currentAgentRecord(
    callerThreadId: string,
    reference: string,
  ): AgentTaskRecord | undefined {
    const target = this.lifecycleTarget(
      callerThreadId,
      reference,
      "agent lookup",
    );
    return target.records.at(-1);
  }

  resolveCurrentAgentRecords(
    callerThreadId: string,
    agentIds: readonly string[],
  ): AgentTaskRecord[] {
    const records = agentIds.map((id) => {
      const target = this.lifecycleTarget(
        callerThreadId,
        id,
        "status inspection",
      );
      this.assertThreadOpen(target, id, "status inspection");
      const record = target.records.at(-1);
      if (!record) {
        throw lifecycleError("agent_not_attached", id, "status inspection");
      }
      return record;
    });
    return uniqueAgentRecords(records);
  }

  waitRecords(
    callerThreadId: string,
    agentIds: readonly string[] | undefined,
  ): AgentTaskRecord[] {
    return agentIds
      ? this.resolveCurrentAgentRecords(callerThreadId, agentIds)
      : this.directChildRecords(callerThreadId).filter(
          ({ collected, snapshot }) => !collected && !snapshot.closedAt,
        );
  }

  waitForMailbox(
    threadIds: ReadonlySet<string>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<
    | { reason: "agent_updated"; event: AgentMailboxEvent }
    | { reason: "timeout" }
  > {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (
        wake:
          | { reason: "agent_updated"; event: AgentMailboxEvent }
          | { reason: "timeout" },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.host.mailboxWaiters.delete(waiter);
        resolve(wake);
      };
      const waiter: AgentMailboxWaiter = {
        threadIds,
        resolve: (event) => finish({ reason: "agent_updated", event }),
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.host.mailboxWaiters.delete(waiter);
        reject(signal.reason);
      };
      const timer = setTimeout(() => finish({ reason: "timeout" }), timeoutMs);
      this.host.mailboxWaiters.add(waiter);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  threadHasActiveRunById(threadId: string): boolean {
    const currentActive = this.recordsForThread(threadId).some(
      ({ snapshot }) => !isTerminal(snapshot.status),
    );
    if (currentActive) return true;
    const resumable = this.host.resumableThreads.get(threadId);
    return resumable ? !isTerminal(resumable.latestTask.status) : false;
  }

  lifecycleTarget(
    callerThreadId: string,
    agentId: string,
    operation: string,
  ): AgentLifecycleTarget {
    const threadId = this.resolveThreadId(callerThreadId, agentId, operation);
    const records = this.recordsForThread(threadId);
    const resumable = this.host.resumableThreads.get(threadId);
    if (!threadId) {
      throw lifecycleError("agent_not_found", agentId, operation);
    }
    return {
      threadId,
      records,
      ...(resumable ? { resumable } : {}),
    };
  }

  resolveThreadId(
    callerThreadId: string,
    reference: string,
    operation: string,
  ): string {
    const directRecord = this.host.records.get(reference);
    if (directRecord) return agentThreadId(directRecord);
    if (this.recordsForThread(reference).length > 0) return reference;
    const persistedThread =
      this.host.resumableTaskThreads.get(reference) ??
      (this.host.resumableThreads.has(reference) ? reference : undefined);
    if (persistedThread) return persistedThread;

    const addressable = new Map<
      string,
      { threadId: string; snapshot: AgentTaskSnapshot }
    >();
    for (const thread of this.host.resumableThreads.values()) {
      addressable.set(thread.agentThreadId, {
        threadId: thread.agentThreadId,
        snapshot: thread.latestTask,
      });
    }
    for (const record of this.currentLogicalRecords()) {
      const threadId = agentThreadId(record);
      addressable.set(threadId, { threadId, snapshot: record.snapshot });
    }
    const candidates = [...addressable.values()];
    const byPath = candidates.filter(
      ({ snapshot }) => snapshot.agentPath === reference,
    );
    if (byPath.length === 1) return byPath[0]!.threadId;

    const directChildren = this.currentDirectChildRecords(callerThreadId);
    const byRelativeName = directChildren.filter(
      ({ snapshot }) => snapshot.name === reference,
    );
    if (byRelativeName.length === 1) return agentThreadId(byRelativeName[0]!);

    const byGlobalName = candidates.filter(
      ({ snapshot }) => snapshot.name === reference,
    );
    if (byGlobalName.length === 1) return byGlobalName[0]!.threadId;
    if (
      byPath.length > 1 ||
      byRelativeName.length > 1 ||
      byGlobalName.length > 1
    ) {
      throw lifecycleError("agent_ambiguous", reference, operation);
    }
    throw lifecycleError("agent_not_found", reference, operation);
  }

  currentLogicalRecords(): AgentTaskRecord[] {
    const records = new Map<string, AgentTaskRecord>();
    for (const record of this.host.records.values()) {
      records.set(agentThreadId(record), record);
    }
    return [...records.values()];
  }

  assertThreadOpen(
    target: AgentLifecycleTarget,
    agentId: string,
    operation: string,
  ): void {
    if (this.threadClosedAt(target.threadId)) {
      throw lifecycleError("agent_closed", agentId, operation);
    }
    if (this.host.closed) {
      throw lifecycleError("agent_not_attached", agentId, operation);
    }
  }

  assertLifecycleAuthority(
    callerThreadId: string,
    target: AgentLifecycleTarget,
    agentId: string,
    operation: string,
  ): void {
    const latest =
      target.records.at(-1)?.snapshot ?? target.resumable?.latestTask;
    const directChild = latest?.parentId === callerThreadId;
    if (
      target.threadId === this.host.rootId ||
      (callerThreadId !== this.host.rootId && !directChild)
    ) {
      throw lifecycleError(
        "agent_not_attached",
        agentId,
        operation,
        "lifecycle controls are limited to the caller's direct children",
      );
    }
  }

  assertFollowUpAuthority(
    callerThreadId: string,
    target: AgentLifecycleTarget,
    agentId: string,
  ): void {
    const latestRecord = target.records.at(-1);
    const latest = latestRecord?.snapshot ?? target.resumable?.latestTask;
    const profileName =
      latestRecord?.profile?.name ?? target.resumable?.profileName;
    const profile = profileName
      ? this.host.profiles.get(profileName)
      : undefined;
    const caller = this.currentRecordForThread(callerThreadId)?.snapshot;
    const directChild = latest?.parentId === callerThreadId;
    const sibling =
      caller?.parentId !== undefined && latest?.parentId === caller.parentId;
    const safePeer =
      target.threadId !== this.host.rootId &&
      sibling &&
      profile !== undefined &&
      profile.toolAccess !== "all";
    if (
      target.threadId === this.host.rootId ||
      (callerThreadId !== this.host.rootId && !directChild && !safePeer)
    ) {
      throw lifecycleError(
        "agent_not_attached",
        agentId,
        "follow-up",
        "sibling agents may wake read-only peers; write-capable and unrelated agents remain limited to their direct parent",
      );
    }
  }

  assertThreadContinuable(
    target: AgentLifecycleTarget,
    agentId: string,
    operation: string,
  ): void {
    this.assertThreadOpen(target, agentId, operation);
    if (this.threadHasActiveRunById(target.threadId)) {
      throw lifecycleError("agent_busy", agentId, operation);
    }
  }

  threadClosedAt(threadId: string): string | undefined {
    return (
      this.host.threadClosures.get(threadId) ??
      this.recordsForThread(threadId).find(
        ({ snapshot }) => snapshot.closedAt !== undefined,
      )?.snapshot.closedAt ??
      this.host.resumableThreads.get(threadId)?.latestTask.closedAt
    );
  }

  openAgentThreadCount(): number {
    const threadIds = new Set<string>();
    for (const thread of this.host.resumableThreads.values()) {
      if (!this.threadClosedAt(thread.agentThreadId)) {
        threadIds.add(thread.agentThreadId);
      }
    }
    for (const record of this.nonRootRecords()) {
      const threadId = agentThreadId(record);
      if (!this.threadClosedAt(threadId)) threadIds.add(threadId);
    }
    return threadIds.size;
  }

  childThreadHistory(
    record: AgentTaskRecord,
  ): readonly ModelConversationMessage[] {
    if (record.contextHistory) {
      return record.contextHistory.map((message) => ({ ...message }));
    }
    return [
      ...(record.history ?? []),
      ...(record.snapshot.output
        ? [
            { role: "user" as const, text: record.snapshot.task },
            { role: "assistant" as const, text: record.snapshot.output },
          ]
        : []),
    ];
  }

  availableChildName(parentThreadId: string, base: string): string {
    const normalized = normalizedTaskName(base);
    const names = this.childNames(parentThreadId);
    if (!names.has(normalized)) return normalized;
    let suffix = 2;
    while (names.has(`${normalized}-${suffix}`)) suffix += 1;
    return `${normalized}-${suffix}`;
  }

  assertChildNameAvailable(parentThreadId: string, name: string): string {
    if (this.childNames(parentThreadId).has(name)) {
      throw new Error(
        `Agent task name ${name} is already in use under ${this.callerLabel(parentThreadId)}`,
      );
    }
    return name;
  }

  childNames(parentThreadId: string): Set<string> {
    const names = new Set(
      this.currentDirectChildRecords(parentThreadId).map(
        ({ snapshot }) => snapshot.name,
      ),
    );
    const parentPath =
      this.currentRecordForThread(parentThreadId)?.snapshot.agentPath;
    if (!parentPath) return names;
    for (const thread of this.host.resumableThreads.values()) {
      const task = thread.latestTask;
      if (this.threadClosedAt(thread.agentThreadId) || !task.agentPath)
        continue;
      if (parentAgentPath(task.agentPath) === parentPath) names.add(task.name);
    }
    return names;
  }

  callerLabel(threadId: string): string {
    return (
      this.currentRecordForThread(threadId)?.snapshot.agentPath ?? threadId
    );
  }

  agentMessage(
    callerThreadId: string,
    targetReference: string,
    text: string,
    delivery: AgentTaskMessage["delivery"],
  ): AgentTaskMessage {
    const caller = this.currentRecordForThread(callerThreadId);
    if (!caller) {
      throw lifecycleError(
        "agent_not_attached",
        callerThreadId,
        "message delivery",
      );
    }
    const targetThreadId = this.resolveThreadId(
      callerThreadId,
      targetReference,
      "message delivery",
    );
    if (targetThreadId === callerThreadId) {
      throw new Error("An agent cannot send a collaboration message to itself");
    }
    return {
      id: randomUUID(),
      fromAgentId: caller.snapshot.id,
      fromAgentThreadId: callerThreadId,
      fromAgentName: caller.snapshot.name,
      toAgentThreadId: targetThreadId,
      text,
      createdAt: this.host.wallNow().toISOString(),
      delivery,
    };
  }

  sendMessageOrThrow(
    callerThreadId: string,
    targetReference: string,
    text: string,
  ): AgentTaskMessage {
    const target = this.lifecycleTarget(
      callerThreadId,
      targetReference,
      "message delivery",
    );
    this.assertThreadOpen(target, targetReference, "message delivery");
    const record = target.records.at(-1);
    if (!record || isTerminal(record.snapshot.status)) {
      throw lifecycleError(
        "agent_not_attached",
        targetReference,
        "active message delivery",
        "use followup_task to wake an idle agent",
      );
    }
    const message = this.agentMessage(
      callerThreadId,
      targetReference,
      text,
      "active",
    );
    record.pendingInput.push(formatAgentMessage(message));
    this.host.patchRecord(record, "messaged", {
      latestActivity: `Message from ${message.fromAgentName}`,
      messages: [...(record.snapshot.messages ?? []), message],
    });
    this.host.scheduleRuntimeCheckpoint();
    return message;
  }

  subtreeThreadIds(threadId: string): Set<string> {
    const descendants = new Set([threadId]);
    const candidates = [
      ...this.currentLogicalRecords().map(({ snapshot }) => snapshot),
      ...[...this.host.resumableThreads.values()].map(
        ({ latestTask }) => latestTask,
      ),
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of candidates) {
        const candidateThreadId = candidate.agentThreadId ?? candidate.id;
        if (
          candidate.parentId &&
          descendants.has(candidate.parentId) &&
          !descendants.has(candidateThreadId)
        ) {
          descendants.add(candidateThreadId);
          changed = true;
        }
      }
    }
    return descendants;
  }

  subtreeActiveRecords(threadId: string): AgentTaskRecord[] {
    const subtree = this.subtreeThreadIds(threadId);
    return this.nonRootRecords().filter(
      (record) =>
        subtree.has(agentThreadId(record)) &&
        !isTerminal(record.snapshot.status),
    );
  }
}
import { randomUUID } from "node:crypto";
