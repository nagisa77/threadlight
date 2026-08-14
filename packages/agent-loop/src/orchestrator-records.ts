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

export function collaborationStatus(records: readonly AgentTaskRecord[]) {
  const agents = records.map(({ snapshot }) => ({
    id: snapshot.id,
    agentThreadId: snapshot.agentThreadId ?? snapshot.id,
    ...(snapshot.agentPath ? { agentPath: snapshot.agentPath } : {}),
    ...(snapshot.parentId ? { parentId: snapshot.parentId } : {}),
    name: snapshot.name,
    role: snapshot.role,
    task: snapshot.task,
    status: snapshot.status,
    phase: snapshot.phase,
    ...(snapshot.latestActivity
      ? { latestActivity: snapshot.latestActivity }
      : {}),
    ...(snapshot.output ? { output: snapshot.output } : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
    closed: snapshot.closedAt !== undefined,
  }));
  return {
    agents,
    activeAgentIds: agents
      .filter(({ status }) => !isTerminal(status))
      .map(({ id }) => id),
    terminalAgentIds: agents
      .filter(({ status }) => isTerminal(status))
      .map(({ id }) => id),
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
