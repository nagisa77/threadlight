import type { SubagentProfile, Tool } from "./types.js";

export const SPAWN_AGENT_TOOL = "spawn_agent";
export const SEND_MESSAGE_TOOL = "send_message";
export const FOLLOWUP_TASK_TOOL = "followup_task";
export const FOLLOW_UP_AGENT_TOOL = "follow_up_agent";
export const RETRY_AGENT_TOOL = "retry_agent";
export const CHECK_AGENTS_TOOL = "check_agents";
export const WAIT_FOR_AGENTS_TOOL = "wait_for_agents";
export const READ_AGENT_RESULT_TOOL = "read_agent_result";
export const STEER_AGENT_TOOL = "steer_agent";
export const INTERRUPT_AGENT_TOOL = "interrupt_agent";
export const CLOSE_AGENT_TOOL = "close_agent";

export const COLLABORATION_TOOLS = new Set([
  SPAWN_AGENT_TOOL,
  SEND_MESSAGE_TOOL,
  FOLLOWUP_TASK_TOOL,
  FOLLOW_UP_AGENT_TOOL,
  RETRY_AGENT_TOOL,
  CHECK_AGENTS_TOOL,
  WAIT_FOR_AGENTS_TOOL,
  READ_AGENT_RESULT_TOOL,
  STEER_AGENT_TOOL,
  INTERRUPT_AGENT_TOOL,
  CLOSE_AGENT_TOOL,
]);

export const DEFAULT_AGENT_WAIT_TIMEOUT_MS = 30_000;
export const MAX_AGENT_WAIT_TIMEOUT_MS = 300_000;

export function toolsForChild(
  tools: readonly Tool[],
  profile: SubagentProfile,
  collaborationTools: readonly Tool[],
): readonly Tool[] {
  const excluded = new Set(profile.excludedTools ?? []);
  const base = tools.filter(
    (tool) =>
      !COLLABORATION_TOOLS.has(tool.name) &&
      !excluded.has(tool.name) &&
      (profile.toolAccess === "all" || tool.mutability === "read"),
  );
  const collaboration = (profile.leaf ? [] : collaborationTools).filter(
    (tool) => !excluded.has(tool.name),
  );
  const combined = [...base, ...collaboration];
  assertUniqueToolNames(combined);
  return combined;
}

export function delegationInstructions(
  profiles: readonly SubagentProfile[],
  maxConcurrent: number,
): string {
  return [
    "MULTI-AGENT DELEGATION",
    "Delegate only concrete, independent work that benefits from parallel execution or focused context. Keep small sequential work in the parent agent.",
    `At most ${maxConcurrent} agents run concurrently. Start direct children with ${SPAWN_AGENT_TOOL}, continue useful work, then use ${CHECK_AGENTS_TOOL} for status or ${WAIT_FOR_AGENTS_TOOL} for a bounded wait before using their findings or finishing.`,
    `Give spawned work a stable taskName when another agent may need to address it. Targets accept task IDs, stable thread IDs, caller-relative task names, or canonical paths such as /root/research/api_review.`,
    `Use ${SEND_MESSAGE_TOOL} for a running agent and ${FOLLOWUP_TASK_TOOL} to wake an idle agent in its existing context. Use ${STEER_AGENT_TOOL} for parent-style direction.`,
    `For peer dialogue, review, or debate, avoid manually relaying one agent's output through the parent. Include stable peer task names in delegated instructions so agents can inspect or wait for peers, use ${SEND_MESSAGE_TOOL} while a peer is active, and use ${FOLLOWUP_TASK_TOOL} when a read-only peer is idle.`,
    "Keep interrupt, close, retry, and write-capable follow-up under the owning parent; peer communication must not grant peer lifecycle or write authority.",
    `Use ${FOLLOW_UP_AGENT_TOOL} only as the legacy alias for ${FOLLOWUP_TASK_TOOL}; use ${SPAWN_AGENT_TOOL} for independent work.`,
    `Use ${RETRY_AGENT_TOOL} to rerun a finished or interrupted turn from fresh provider state while retaining its thread linkage.`,
    `Status checks return only changed summaries. Call ${READ_AGENT_RESULT_TOOL} when the exact result is needed.`,
    `Agent threads persist for the whole parent conversation: finishing a child turn does not delete or close its thread. Use ${INTERRUPT_AGENT_TOOL} to stop only the current turn while keeping the thread reusable. Use ${CLOSE_AGENT_TOOL} only when no more work or results are needed from that thread.`,
    "Do not duplicate the same task across agents. Give each task enough context to be completed without asking the user.",
    "A write-capable subagent has exclusive workspace write ownership while active. The parent may continue read-only work and must wait before writing.",
    "Available roles:",
    ...profiles.map(
      (profile) =>
        `- ${profile.name} (${profile.toolAccess === "all" ? "write-capable" : "read-only"}): ${profile.description}`,
    ),
  ].join("\n");
}

export function collaborationTargetParameters(): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "Agent or stable agent-thread ID",
      },
    },
    required: ["agentId"],
    additionalProperties: false,
  };
}

export function collaborationTargetsParameters(
  description: string,
): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      agentIds: {
        type: "array",
        items: { type: "string" },
        description,
      },
    },
    additionalProperties: false,
  };
}

export function collaborationInputParameters(
  inputDescription: string,
): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "Agent or stable agent-thread ID",
      },
      input: {
        type: "string",
        minLength: 1,
        description: inputDescription,
      },
    },
    required: ["agentId", "input"],
    additionalProperties: false,
  };
}

export function collaborationMessageParameters(
  messageDescription: string,
): Tool["parameters"] {
  return {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "Agent task ID, stable thread ID, caller-relative task name, or canonical path",
      },
      message: {
        type: "string",
        minLength: 1,
        description: messageDescription,
      },
    },
    required: ["target", "message"],
    additionalProperties: false,
  };
}

export function optionalAgentIds(value: unknown): string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("agentIds must be an array");
  return value.map((id) => stringArgument(id, "agentIds"));
}

export function waitTimeoutArgument(value: unknown): number {
  if (value === undefined) return DEFAULT_AGENT_WAIT_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_AGENT_WAIT_TIMEOUT_MS
  ) {
    throw new Error(
      `timeoutMs must be an integer between 1 and ${MAX_AGENT_WAIT_TIMEOUT_MS}`,
    );
  }
  return value;
}

export function taskNameArgument(value: unknown): string {
  const name = stringArgument(value, "taskName");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(
      "taskName must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores, or hyphens",
    );
  }
  return name;
}

export function normalizedTaskName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "agent";
}

export function objectArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

export function stringArgument(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export function assertUniqueToolNames(tools: readonly Tool[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
}
