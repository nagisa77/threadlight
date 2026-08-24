import type { AgentTaskRecord } from "./orchestrator-types.js";

export function agentThreadId(record: AgentTaskRecord): string {
  return record.snapshot.agentThreadId ?? record.snapshot.id;
}

export function uniqueAgentRecords(
  records: readonly AgentTaskRecord[],
): AgentTaskRecord[] {
  return [
    ...new Map(records.map((record) => [record.snapshot.id, record])).values(),
  ];
}

export function collaborationStatus(
  records: readonly AgentTaskRecord[],
  changedRecords: readonly AgentTaskRecord[] = records,
) {
  const agents = changedRecords.map(({ snapshot }) => ({
    id: snapshot.id,
    agentThreadId: snapshot.agentThreadId ?? snapshot.id,
    ...(snapshot.agentPath ? { agentPath: snapshot.agentPath } : {}),
    ...(snapshot.parentId ? { parentId: snapshot.parentId } : {}),
    name: snapshot.name,
    role: snapshot.role,
    status: snapshot.status,
    phase: snapshot.phase,
    ...(snapshot.latestActivity
      ? { latestActivity: snapshot.latestActivity }
      : {}),
    ...(snapshot.summary ? { summary: snapshot.summary } : {}),
    ...(snapshot.output ? { fullResultAvailable: true } : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
    closed: snapshot.closedAt !== undefined,
  }));
  return {
    agents,
    unchangedAgentIds: records
      .filter((record) => !changedRecords.includes(record))
      .map(({ snapshot }) => snapshot.id),
    activeAgentIds: records
      .filter(({ snapshot }) => !isTerminal(snapshot.status))
      .map(({ snapshot }) => snapshot.id),
    terminalAgentIds: records
      .filter(({ snapshot }) => isTerminal(snapshot.status))
      .map(({ snapshot }) => snapshot.id),
  };
}

export function isTerminal(
  status: AgentTaskRecord["snapshot"]["status"],
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}
