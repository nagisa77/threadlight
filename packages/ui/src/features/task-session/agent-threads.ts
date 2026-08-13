import type { AgentTaskData } from "@threadlight/protocol";

export interface AgentThreadView {
  id: string;
  initial: AgentTaskData;
  latest: AgentTaskData;
  turns: readonly AgentTaskData[];
}

export interface AgentThreadTreeItem extends AgentThreadView {
  parentThreadId?: string;
  depth: number;
}

/** Groups execution-turn records into the stable logical agents shown in UI. */
export function groupAgentThreads(
  agents: readonly AgentTaskData[],
): AgentThreadView[] {
  const threads = new Map<string, AgentTaskData[]>();

  for (const agent of agents) {
    const id = agent.agentThreadId ?? agent.id;
    const turns = threads.get(id);
    if (turns) turns.push(agent);
    else threads.set(id, [agent]);
  }

  return [...threads].map(([id, turns]) => ({
    id,
    initial: turns[0]!,
    latest: turns.at(-1)!,
    turns,
  }));
}

/** Projects stable agent threads into parent-before-child display order. */
export function agentThreadTree(
  agents: readonly AgentTaskData[],
  rootId: string,
  options: { includeRoot?: boolean } = {},
): AgentThreadTreeItem[] {
  const threads = groupAgentThreads(agents);
  const taskToThread = new Map<string, string>();
  for (const thread of threads) {
    for (const turn of thread.turns) taskToThread.set(turn.id, thread.id);
  }

  const items = threads.map((thread) => {
    const parent = thread.initial.parentId;
    return {
      ...thread,
      ...(parent ? { parentThreadId: taskToThread.get(parent) ?? parent } : {}),
      depth: 0,
    };
  });
  const byParent = new Map<string, AgentThreadTreeItem[]>();
  for (const item of items) {
    if (!item.parentThreadId) continue;
    const children = byParent.get(item.parentThreadId);
    if (children) children.push(item);
    else byParent.set(item.parentThreadId, [item]);
  }
  for (const children of byParent.values()) {
    children.sort((left, right) =>
      left.initial.createdAt.localeCompare(right.initial.createdAt),
    );
  }

  const ordered: AgentThreadTreeItem[] = [];
  const visited = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    const item = items.find((candidate) => candidate.id === id);
    if (item && (options.includeRoot !== false || id !== rootId)) {
      ordered.push({ ...item, depth });
    }
    for (const child of byParent.get(id) ?? []) {
      visit(
        child.id,
        id === rootId ? (options.includeRoot === false ? 0 : 1) : depth + 1,
      );
    }
  };

  visit(rootId, 0);
  for (const item of items) {
    if (!visited.has(item.id)) visit(item.id, 0);
  }
  return ordered;
}

export function totalAgentElapsedMs(thread: AgentThreadView): number {
  return thread.turns.reduce((total, turn) => total + turn.elapsedMs, 0);
}

export function totalAgentSteps(thread: AgentThreadView): number | undefined {
  const turnsWithSteps = thread.turns.filter(
    (turn) => turn.steps !== undefined,
  );
  if (turnsWithSteps.length === 0) return;
  return turnsWithSteps.reduce((total, turn) => total + (turn.steps ?? 0), 0);
}

export function totalAgentTokens(thread: AgentThreadView): number {
  return thread.turns.reduce(
    (total, turn) => total + (turn.usage?.totalTokens ?? 0),
    0,
  );
}

/** True when the structured follow-up message already represents this turn's task. */
export function agentTaskRepresentedByMessage(agent: AgentTaskData): boolean {
  const task = normalizedAgentText(agent.task);
  return (
    task.length > 0 &&
    (agent.messages ?? []).some(
      (message) =>
        message.delivery === "follow_up" &&
        normalizedAgentText(message.text) === task,
    )
  );
}

function normalizedAgentText(value: string): string {
  return value.replaceAll("\r\n", "\n").trim();
}
