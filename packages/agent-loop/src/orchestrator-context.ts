import {
  delegationInstructions,
  toolsForChild,
} from "./collaboration-contract.js";
import type {
  Agent,
  AgentTaskSnapshot,
  SubagentProfile,
  Tool,
} from "./types.js";

export function createChildAgent(options: {
  rootAgent: Agent;
  profile: SubagentProfile;
  name: string;
  agentIdentity: string;
  agentThreadId: string;
  leaf: boolean;
  instructionCapsule?: string;
  profiles: readonly SubagentProfile[];
  maxConcurrent: number;
  collaborationTools: readonly Tool[];
}): Agent {
  return {
    name: options.name,
    instructions: childInstructions({
      leaf: options.leaf,
      rootInstructions: options.rootAgent.instructions,
      instructionCapsule: options.instructionCapsule,
      profile: options.profile,
      agentIdentity: options.agentIdentity,
      agentThreadId: options.agentThreadId,
      profiles: options.profiles,
      maxConcurrent: options.maxConcurrent,
    }),
    model: options.profile.model ?? options.rootAgent.model,
    provider: options.profile.provider ?? options.rootAgent.provider,
    tools: toolsForChild(
      options.rootAgent.tools ?? [],
      options.leaf ? { ...options.profile, leaf: true } : options.profile,
      options.collaborationTools,
    ),
    maxSteps: options.profile.maxSteps ?? options.rootAgent.maxSteps,
  };
}

export function childInstructions(options: {
  leaf: boolean;
  rootInstructions: string;
  instructionCapsule?: string;
  profile: SubagentProfile;
  agentIdentity: string;
  agentThreadId: string;
  profiles: readonly SubagentProfile[];
  maxConcurrent: number;
}): string {
  const identity = `AGENT IDENTITY\nYou are ${options.agentIdentity}. Your stable thread ID is ${options.agentThreadId}.`;
  if (options.leaf) {
    return [
      "SUBAGENT ROLE\nLeaf execution capsule. Root prompt and delegation policy are intentionally omitted.",
      ...(options.instructionCapsule ? [options.instructionCapsule] : []),
      options.profile.instructions,
      identity,
      ...(options.profile.skillRole
        ? [
            `SKILL ROLE\nWhen a relevant skill exposes the ${options.profile.skillRole} role entry, load it with skill_capsule before acting.`,
          ]
        : []),
      "Work only on the delegated task. Do not ask the user questions. Return a concise result with concrete evidence for your parent agent.",
    ].join("\n\n");
  }
  return [
    options.rootInstructions,
    "SUBAGENT ROLE",
    options.profile.instructions,
    identity,
    delegationInstructions(options.profiles, options.maxConcurrent),
    "Work only on the delegated task. Do not ask the user questions. You may delegate bounded subtasks and exchange messages when that materially helps. Return a concise result with concrete evidence for your parent agent.",
  ].join("\n\n");
}

export function agentResultPayload(
  snapshot: AgentTaskSnapshot,
  fullOutput: string | undefined,
): unknown {
  return {
    id: snapshot.id,
    agentThreadId: snapshot.agentThreadId ?? snapshot.id,
    ...(snapshot.agentPath ? { agentPath: snapshot.agentPath } : {}),
    name: snapshot.name,
    role: snapshot.role,
    status: snapshot.status,
    ...(snapshot.summary ? { summary: snapshot.summary } : {}),
    ...(fullOutput !== undefined
      ? { output: fullOutput, truncated: false }
      : snapshot.output !== undefined
        ? { output: snapshot.output, truncated: true }
        : {}),
    ...(snapshot.error ? { error: snapshot.error } : {}),
  };
}
