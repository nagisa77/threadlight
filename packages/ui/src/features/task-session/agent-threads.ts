import type { AgentTaskData } from "@threadlight/protocol";

export interface AgentThreadView {
  id: string;
  initial: AgentTaskData;
  latest: AgentTaskData;
  turns: readonly AgentTaskData[];
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
