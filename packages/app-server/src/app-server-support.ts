import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type {
  Agent,
  AgentEvent,
  AgentLoop,
  AgentRuntimeSnapshot,
  AgentTreeEvent,
  AgentTreeSnapshot,
  ResumableAgentThread,
  SubagentProfile,
  Tool,
} from "@threadlight/agent-loop";
import { AgentOrchestrator } from "@threadlight/agent-loop";
import {
  createRequestPlanInputTool,
  PlanExecutionController,
  USER_SELECTED_PLAN_INSTRUCTIONS,
} from "@threadlight/builtin-tools";
import {
  projectAgentProgress,
  projectAgentPlan,
  projectMessagesProcess,
  projectProgressProcess,
  isHostLanguage,
} from "@threadlight/protocol";

import type {
  ActiveTurnData,
  AgentThreadData,
  AttachmentData,
  AgentPlanData,
  CapabilityDescriptor,
  ConnectorStatusData,
  ConversationAccessMode,
  ConversationMessageData,
  ConversationProgressData,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  MessageCapabilityData,
  ProcessSnapshotData,
  QueuedTurnData,
  SendMessage,
  SuggestionLanguage,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
  ThreadlightMethod,
  TokenUsageData,
  TurnDiagnosticsData,
  TurnMode,
} from "./protocol.js";
import {
  MemoryConversationStore,
  type ConversationStore,
  type StoredAgentRun,
  type StoredAgentThread,
  type StoredConversation,
} from "./conversation-store.js";
import {
  DEFAULT_SUGGESTION_REFRESH_INTERVAL_MS,
  MemorySuggestionStore,
  type SuggestedQuestions,
  type SuggestionStore,
} from "./suggestion-store.js";
import {
  composePrompt,
  promptBlocksFromSnapshot,
  validatePromptSnapshot,
  type PromptBlock,
  type PromptSnapshot,
} from "./prompt-composer.js";
import type {
  CapabilityActivation,
  CapabilityResource,
  SkillReadRequirement,
} from "./capability-registry.js";
import { CapabilityResourceController } from "./capability-resource-controller.js";
import {
  createAttachmentRuntime,
  type AttachmentProvider,
} from "./attachment-runtime.js";
import { ModelStatePersistence } from "./model-state-persistence.js";
import {
  composeRunControllers,
  ProjectMemoryReminderController,
  ResearchCoverageRunController,
  UserActionRunController,
} from "./run-controllers.js";
import { TurnCapabilityController } from "./turn-capability-controller.js";
import { SkillReadRequirementController } from "./skill-read-requirement-controller.js";
import {
  ExecutionPolicyRunController,
  type ExecutionApprovalRequest,
  type ExecutionApprovalRequester,
} from "./execution-policy-controller.js";
import { SourceCitationRunController } from "./source-citations.js";
import {
  conversationTitleFrom,
  conversationTitleTranscript,
  parsePullRequestDescription,
  parseSuggestedQuestions,
  pullRequestTranscript,
  suggestionLanguageName,
  type PullRequestChangeInput,
} from "./generated-content.js";
import { RpcError, RpcMethodRouter } from "./rpc-router.js";

import type { ThreadRuntime, ThreadState } from "./app-server.js";

export class TurnDiagnosticsRecorder {
  private readonly modelSteps: Array<
    TurnDiagnosticsData["modelSteps"][number]
  > = [];
  private readonly toolCalls: Array<TurnDiagnosticsData["toolCalls"][number]> =
    [];
  private durationMs = 0;
  private readonly startedMonotonic = performance.now();

  constructor(
    private readonly startedAt: Date,
    private readonly model: string | undefined,
  ) {}

  record(event: AgentEvent): void {
    if (event.type === "model.completed") {
      this.modelSteps.push({
        step: event.step,
        durationMs: event.durationMs ?? 0,
        ...(event.ttftMs === undefined ? {} : { ttftMs: event.ttftMs }),
        usage: normalizedUsage(event.usage),
      });
      return;
    }
    if (event.type === "tool.completed") {
      this.toolCalls.push({
        callId: event.result.callId,
        name: event.result.name,
        durationMs: event.durationMs ?? 0,
        isError: event.result.isError ?? false,
        ...(event.result.error?.code
          ? { errorCode: event.result.error.code }
          : {}),
      });
      return;
    }
    if (event.type === "run.completed" || event.type === "run.failed") {
      this.durationMs = event.durationMs ?? this.durationMs;
    }
  }

  complete(
    status: TurnDiagnosticsData["status"],
    completedAt: Date,
    durationMs?: number,
    agentTree?: AgentTreeSnapshot,
  ): TurnDiagnosticsData {
    const rootAgentId = agentTree?.rootId;
    const root = diagnosticsScope(
      this.modelSteps.map((step) => ({
        ...step,
        ...(rootAgentId ? { agentId: rootAgentId } : {}),
        agentRole: "root",
      })),
      this.toolCalls.map((tool) => ({
        ...tool,
        ...(rootAgentId ? { agentId: rootAgentId } : {}),
        agentRole: "root",
      })),
    );
    const children = childDiagnosticsScope(agentTree);
    const total = diagnosticsScope(
      [...root.modelSteps, ...children.modelSteps],
      [...root.toolCalls, ...children.toolCalls],
      addTokenUsage(root.usage, children.usage),
    );
    return {
      status,
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs:
        durationMs ??
        (this.durationMs ||
          Math.max(0, Math.round(performance.now() - this.startedMonotonic))),
      ...(this.model ? { model: this.model } : {}),
      usage: total.usage,
      // Legacy arrays remain root-only. Scoped consumers should use metrics.
      modelSteps: this.modelSteps,
      toolCalls: this.toolCalls,
      metrics: { root, children, total },
    };
  }
}

type DiagnosticsScope = NonNullable<TurnDiagnosticsData["metrics"]>["root"];

export function childDiagnosticsScope(
  tree: AgentTreeSnapshot | undefined,
): DiagnosticsScope {
  if (!tree) return diagnosticsScope([], []);
  const children = tree.agents.filter(({ id }) => id !== tree.rootId);
  const modelSteps: DiagnosticsScope["modelSteps"][number][] = [];
  const toolCalls: DiagnosticsScope["toolCalls"][number][] = [];
  for (const child of children) {
    for (const entry of child.transcript) {
      if (entry.status === "running") continue;
      if (entry.kind === "model") {
        modelSteps.push({
          step: entry.step,
          durationMs: entry.durationMs ?? 0,
          ...(entry.ttftMs === undefined ? {} : { ttftMs: entry.ttftMs }),
          usage: normalizedUsage(entry.usage),
          agentId: child.id,
          agentRole: child.role,
        });
        continue;
      }
      toolCalls.push({
        callId: entry.id,
        name: entry.name,
        durationMs: entry.durationMs ?? 0,
        isError: entry.status === "failed" || entry.isError === true,
        ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
        agentId: child.id,
        agentRole: child.role,
      });
    }
  }
  return diagnosticsScope(modelSteps, toolCalls);
}

export function diagnosticsScope(
  modelSteps: DiagnosticsScope["modelSteps"],
  toolCalls: DiagnosticsScope["toolCalls"],
  usage: Partial<TokenUsageData> = modelSteps.reduce<TokenUsageData>(
    (total, step) => addTokenUsage(total, step.usage),
    normalizedUsage(),
  ),
): DiagnosticsScope {
  return {
    usage: normalizedUsage(usage),
    modelSteps,
    toolCalls,
  };
}

export function addTokenUsage(
  left: Partial<TokenUsageData>,
  right: Partial<TokenUsageData> | undefined,
): TokenUsageData {
  return {
    inputTokens: (left.inputTokens ?? 0) + (right?.inputTokens ?? 0),
    outputTokens: (left.outputTokens ?? 0) + (right?.outputTokens ?? 0),
    totalTokens: (left.totalTokens ?? 0) + (right?.totalTokens ?? 0),
  };
}

export function normalizedUsage(
  usage: Partial<TokenUsageData> = {},
): TokenUsageData {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  };
}

export function objectParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new RpcError(-32602, "params must be an object");
  }
  return params as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcError(-32602, `${name} must be a non-empty string`);
  }
}

export function parseTurnMode(value: unknown): TurnMode {
  if (value === undefined || value === "default") return "default";
  if (value === "plan") return value;
  throw new RpcError(-32602, "mode must be default or plan");
}

export function parseConversationAccessMode(
  value: unknown,
): ConversationAccessMode {
  if (value === undefined || value === "approval") return "approval";
  if (value === "full") return value;
  throw new RpcError(-32602, "accessMode must be approval or full");
}

export function requireSuggestionLanguage(value: unknown): SuggestionLanguage {
  if (!isHostLanguage(value)) {
    throw new RpcError(-32602, "language is not supported");
  }
  return value;
}

export function parsePullRequestChanges(
  value: unknown,
): readonly PullRequestChangeInput[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new RpcError(-32602, "changes must be an array of at most 500 files");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RpcError(-32602, `changes[${index}] must be an object`);
    }
    const change = item as Record<string, unknown>;
    if (
      typeof change.path !== "string" ||
      !change.path.trim() ||
      change.path.length > 2_000 ||
      !["added", "modified", "deleted"].includes(String(change.status)) ||
      !Number.isSafeInteger(change.additions) ||
      Number(change.additions) < 0 ||
      !Number.isSafeInteger(change.deletions) ||
      Number(change.deletions) < 0
    ) {
      throw new RpcError(-32602, `changes[${index}] is invalid`);
    }
    return {
      path: change.path.trim(),
      status: change.status as PullRequestChangeInput["status"],
      additions: Number(change.additions),
      deletions: Number(change.deletions),
      binary: change.binary === true,
      localOnly: change.localOnly === true,
    };
  });
}

export function parseAttachments(value: unknown): readonly AttachmentData[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isAttachment)) {
    throw new RpcError(-32602, "attachments must contain valid local files");
  }
  return value;
}

export const MODEL_PROVIDER_IDS = new Set<string>([
  "openai",
  "deepseek",
  "qwen",
  "kimi",
  "doubao",
  "gemini",
  "grok",
  "custom",
]);

export function parseModelProvider(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !MODEL_PROVIDER_IDS.has(value)) {
    throw new RpcError(-32602, "provider is not supported");
  }
  return value;
}

export function parseModelName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new RpcError(-32602, "model must be a non-empty string");
  }
  return value;
}

export function parseRuntimeError(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) {
    throw new RpcError(-32602, "runtimeError must be a non-empty string");
  }
  return value;
}

export function parseCapabilityRefs(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    !value.every(
      (ref) => typeof ref === "string" && ref.length > 0 && ref.length <= 256,
    )
  ) {
    throw new RpcError(
      -32602,
      "capabilityRefs must contain at most 16 valid capability ids",
    );
  }
  return [...new Set(value)];
}

export function snapshotCapabilities(
  refs: readonly string[],
  available: readonly CapabilityDescriptor[],
): readonly MessageCapabilityData[] {
  const byId = new Map(
    available.map((capability) => [capability.id, capability]),
  );
  return refs.map((ref) => {
    const capability = byId.get(ref);
    if (!capability) {
      throw new Error(`Capability disappeared after validation: ${ref}`);
    }
    return {
      id: capability.id,
      kind: capability.kind,
      name: capability.name,
      ...(capability.source ? { source: capability.source } : {}),
      ...(capability.icon ? { icon: capability.icon } : {}),
    };
  });
}

export function cloneCapabilities(
  capabilities: readonly CapabilityDescriptor[] | undefined,
): readonly CapabilityDescriptor[] {
  return (capabilities ?? []).map((capability) => ({ ...capability }));
}

export function isAttachment(value: unknown): value is AttachmentData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    (attachment.kind === "image" || attachment.kind === "file") &&
    typeof attachment.path === "string"
  );
}

export function clientSafeAgentEvent(event: AgentEvent): AgentEvent {
  if (
    event.type !== "tool.completed" ||
    event.result.name !== "computer" ||
    event.result.isError
  ) {
    return event;
  }
  return {
    ...event,
    result: {
      ...event.result,
      output: '{"type":"computer_screenshot","status":"captured"}',
    },
  };
}

export function clientSafeAgentTree(
  tree: AgentTreeSnapshot,
): AgentTreeSnapshot {
  return {
    ...tree,
    agents: tree.agents.map((agent) => ({
      ...agent,
      transcript: agent.transcript.map((entry) =>
        entry.kind === "tool" &&
        entry.name === "computer" &&
        !entry.isError &&
        entry.output !== undefined
          ? {
              ...entry,
              output: '{"type":"computer_screenshot","status":"captured"}',
            }
          : entry,
      ),
    })),
  };
}

export function upsertAgentRun(
  runs: readonly StoredAgentRun[],
  next: StoredAgentRun,
): readonly StoredAgentRun[] {
  const index = runs.findIndex(({ turnId }) => turnId === next.turnId);
  if (index < 0) return [...runs, next];
  return runs.map((run, runIndex) => (runIndex === index ? next : run));
}

export function applyAgentThreadClosures(
  runs: readonly StoredAgentRun[],
  closures: NonNullable<AgentRuntimeSnapshot["closedAgentThreads"]>,
): readonly StoredAgentRun[] {
  if (closures.length === 0) return runs;
  const closedAtByThread = new Map(
    closures.map(({ agentThreadId, closedAt }) => [agentThreadId, closedAt]),
  );
  let changed = false;
  const updated = runs.map((run) => {
    let runChanged = false;
    const agents = run.agents.map((stored) => {
      const threadId = stored.agent.agentThreadId ?? stored.agent.id;
      const closedAt = closedAtByThread.get(threadId);
      if (!closedAt || stored.agent.closedAt === closedAt) return stored;
      changed = true;
      runChanged = true;
      return {
        ...stored,
        agent: {
          ...stored.agent,
          closedAt,
          latestActivity: "Closed",
        },
      };
    });
    return runChanged ? { ...run, agents } : run;
  });
  return changed ? updated : runs;
}

export function resumableAgentThreads(
  conversation: StoredConversation,
): readonly ResumableAgentThread[] {
  const threads = new Map<
    string,
    {
      profileName?: string;
      taskIds: readonly string[];
      latestTask: ResumableAgentThread["latestTask"];
      history: ResumableAgentThread["history"];
      modelState?: unknown;
    }
  >();

  for (const run of conversation.agentRuns ?? []) {
    for (const stored of run.agents) {
      if (stored.agent.id === run.rootId) continue;
      const threadId = stored.agent.agentThreadId ?? stored.agent.id;
      const previous = threads.get(threadId);
      const history = [
        ...(previous?.history ?? []),
        ...(stored.agent.output
          ? [
              { role: "user" as const, text: stored.agent.task },
              { role: "assistant" as const, text: stored.agent.output },
            ]
          : []),
      ];
      const profileName = stored.profileName ?? previous?.profileName;
      threads.set(threadId, {
        ...(profileName ? { profileName } : {}),
        taskIds: [...(previous?.taskIds ?? []), stored.agent.id],
        latestTask: {
          ...stored.agent,
          transcript: stored.agent.transcript ?? [],
        },
        history,
        ...(stored.modelState === undefined
          ? {}
          : { modelState: stored.modelState }),
      });
    }
  }

  return [...threads].map(([agentThreadId, thread]) => ({
    agentThreadId,
    ...thread,
  }));
}

export function projectStoredAgentThread(
  hostThreadId: string,
  run: StoredAgentRun,
  stored: StoredAgentThread,
): AgentThreadData {
  const checkpoint =
    stored.checkpointStep !== undefined && stored.checkpointPhase !== undefined
      ? {
          step: stored.checkpointStep,
          phase: stored.checkpointPhase,
          hasModelState: stored.modelState !== undefined,
        }
      : undefined;
  return {
    id: stored.agent.id,
    agentThreadId: stored.agent.agentThreadId ?? stored.agent.id,
    hostThreadId,
    turnId: run.turnId,
    rootId: run.rootId,
    maxConcurrent: run.maxConcurrent,
    runStatus: run.status,
    updatedAt: run.updatedAt,
    ...(stored.profileName ? { profileName: stored.profileName } : {}),
    agent: stored.agent,
    pendingInput: stored.pendingInput,
    collected: stored.collected,
    ...(stored.agent.closedAt ? { closedAt: stored.agent.closedAt } : {}),
    ...(stored.interruption ? { interruption: stored.interruption } : {}),
    ...(checkpoint ? { checkpoint } : {}),
  };
}

export function interruptActiveAgentRuns(
  conversation: StoredConversation,
  interruptedAt: string,
  runtimeError?: string,
): StoredConversation {
  const activeRuns = (conversation.agentRuns ?? []).filter(
    ({ status }) => status === "active",
  );
  if (activeRuns.length === 0) return conversation;

  const interruptedRuns = (conversation.agentRuns ?? []).map((run) => {
    if (run.status !== "active") return run;
    return {
      ...run,
      status: "interrupted" as const,
      updatedAt: interruptedAt,
      agents: run.agents.map((stored) => {
        if (
          stored.agent.status !== "queued" &&
          stored.agent.status !== "running"
        ) {
          return stored;
        }
        return {
          ...stored,
          interruption: {
            previousStatus: stored.agent.status,
            interruptedAt,
            reason: "app_server_restart",
          },
          agent: {
            ...stored.agent,
            status: "interrupted" as const,
            phase: "done" as const,
            completedAt: interruptedAt,
            latestActivity: "Interrupted by app server restart",
            error: runtimeError
              ? `The app server stopped before this agent thread completed: ${runtimeError}`
              : "The app server stopped before this agent thread completed.",
          },
        };
      }),
    };
  });

  const messages = [...conversation.messages];
  for (const run of activeRuns) {
    const id = `agent-interrupted:${run.turnId}`;
    if (messages.some((message) => message.id === id)) continue;
    const interrupted = interruptedRuns.find(
      ({ turnId }) => turnId === run.turnId,
    )!;
    const tree = {
      rootId: interrupted.rootId,
      maxConcurrent: interrupted.maxConcurrent,
      agents: interrupted.agents.map(({ agent }) => agent),
    };
    messages.push({
      id,
      role: "assistant",
      text: runtimeError
        ? `The previous turn was interrupted when the app server stopped: ${runtimeError}\n\nIts agent activity was preserved for review; retry explicitly to avoid repeating side effects.`
        : "The previous turn was interrupted when the app server stopped. Its agent activity was preserved for review; retry explicitly to avoid repeating side effects.",
      error: true,
      ...(tree.agents.length > 0 ? { agentTree: tree } : {}),
    });
  }

  return {
    ...conversation,
    updatedAt: interruptedAt,
    messages,
    agentRuns: interruptedRuns,
  };
}

export function visibleAgentTree(
  tree: AgentTreeSnapshot | undefined,
): tree is AgentTreeSnapshot {
  return tree?.agents.some(({ id }) => id !== tree.rootId) ?? false;
}

export function appendTurnTools(
  tools: readonly Tool[] | undefined,
  additions: readonly Tool[],
): readonly Tool[] {
  const combined = [...(tools ?? []), ...additions];
  const names = new Set<string>();
  for (const tool of combined) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  return combined;
}

export function appendToolsInPlace(
  target: Tool[],
  additions: readonly Tool[],
): void {
  const names = new Set(target.map(({ name }) => name));
  for (const tool of additions) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  target.push(...additions);
}

export function mergeMessageCapabilities(
  left: readonly MessageCapabilityData[],
  right: readonly MessageCapabilityData[],
): readonly MessageCapabilityData[] {
  const merged = new Map<string, MessageCapabilityData>();
  for (const capability of [...left, ...right]) {
    merged.set(capability.id, capability);
  }
  return [...merged.values()];
}

export function uniquePromptBlocks(
  blocks: readonly PromptBlock[],
): readonly PromptBlock[] {
  const unique = new Map<string, PromptBlock>();
  for (const block of blocks) {
    const existing = unique.get(block.id);
    if (!existing) {
      unique.set(block.id, block);
      continue;
    }
    if (
      existing.version !== block.version ||
      existing.authority !== block.authority ||
      existing.source !== block.source ||
      existing.content !== block.content
    ) {
      throw new Error(`Conflicting prompt block: ${block.id}`);
    }
  }
  return [...unique.values()];
}

export function attachRuntimeTools(
  agent: Agent,
  runtime: ThreadRuntime,
): Agent {
  const tools = [...(agent.tools ?? []), ...(runtime.tools ?? [])];
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  return { ...agent, tools };
}

export function promptBlocksForAgent(agent: Agent): PromptBlock[] {
  const candidate = (agent as Agent & { promptSnapshot?: unknown })
    .promptSnapshot;
  if (candidate !== undefined) {
    validatePromptSnapshot(candidate);
    if (candidate.instructions !== agent.instructions) {
      throw new Error("Agent prompt snapshot does not match its instructions");
    }
    return promptBlocksFromSnapshot(candidate);
  }
  return [
    {
      id: "host.legacy-agent",
      version: 1,
      authority: "host",
      source: agent.name,
      content: agent.instructions,
    },
  ];
}

export function restoreStoredPrompt(snapshot: PromptSnapshot): PromptSnapshot {
  validatePromptSnapshot(snapshot);
  return structuredClone(snapshot);
}
