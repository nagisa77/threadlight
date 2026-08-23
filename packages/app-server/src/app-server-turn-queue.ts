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

import type { ProcessController, ThreadState } from "./app-server.js";
import {
  objectParams,
  requireString,
  parseAttachments,
  parseCapabilityRefs,
  parseTurnMode,
  parseConversationAccessMode,
  parseModelProvider,
  parseModelName,
  parseRuntimeError,
  snapshotCapabilities,
  projectStoredAgentThread,
} from "./app-server-support.js";

export interface AppServerTurnQueueHost {
  threads: Map<string, ThreadState>;
  processes?: ProcessController;
  conversationStore: ConversationStore;
  attachmentRoot?: string;
  now(): Date;
  requireThread(threadId: string, runtimeError?: string): Promise<ThreadState>;
  mutateConversation(
    thread: ThreadState,
    mutation: (conversation: StoredConversation) => StoredConversation,
  ): Promise<void>;
  updateConversation(
    conversation: StoredConversation,
    messages: readonly ConversationMessageData[],
  ): StoredConversation;
  requestConversationTitle(threadId: string, thread: ThreadState): void;
  notifyQueueUpdated(threadId: string, thread: ThreadState): void;
  notify<Method extends ThreadlightNotificationMethod>(
    method: Method,
    params: ThreadlightNotificationMap[Method],
  ): void;
  runTurn(
    threadId: string,
    turnId: string,
    input: string,
    mode: TurnMode,
    accessMode: ConversationAccessMode,
    attachments: readonly AttachmentData[],
    capabilityRefs: readonly string[],
    capabilities: readonly MessageCapabilityData[],
    thread: ThreadState,
    controller: AbortController,
    provider?: string,
    model?: string,
  ): Promise<void>;
}

export class AppServerTurnQueue {
  constructor(private readonly host: AppServerTurnQueueHost) {}

  async startTurn(params: unknown): Promise<{ turnId: string }> {
    const {
      threadId,
      input,
      mode: modeValue,
      accessMode: accessModeValue,
      attachments: attachmentValue,
      capabilityRefs: capabilityRefsValue,
      provider: providerValue,
      model: modelValue,
      runtimeError: runtimeErrorValue,
    } = objectParams(params);
    requireString(threadId, "threadId");
    if (typeof input !== "string") {
      throw new RpcError(-32602, "input must be a string");
    }
    const attachments = parseAttachments(attachmentValue);
    const capabilityRefs = parseCapabilityRefs(capabilityRefsValue);
    const mode = parseTurnMode(modeValue);
    const accessMode = parseConversationAccessMode(accessModeValue);
    const provider = parseModelProvider(providerValue);
    const model = parseModelName(modelValue);
    const runtimeError = parseRuntimeError(runtimeErrorValue);
    for (const attachment of attachments) {
      this.requireLocalAttachment(attachment);
    }
    if (!input.trim() && attachments.length === 0) {
      throw new RpcError(-32602, "A turn requires text or an attachment");
    }

    const thread = await this.host.requireThread(threadId, runtimeError);
    const availableCapabilities = thread.runtime?.capabilities ?? [];
    const availableCapabilityIds = new Set(
      availableCapabilities.map(({ id }) => id),
    );
    const unknownCapability = capabilityRefs.find(
      (ref) => !availableCapabilityIds.has(ref),
    );
    if (unknownCapability) {
      throw new RpcError(-32602, `Unknown capability: ${unknownCapability}`);
    }
    const capabilities = snapshotCapabilities(
      capabilityRefs,
      availableCapabilities,
    );

    return this.beginTurn(
      threadId,
      input,
      mode,
      accessMode,
      attachments,
      capabilityRefs,
      capabilities,
      thread,
      provider,
      model,
    );
  }

  async beginTurn(
    threadId: string,
    input: string,
    mode: TurnMode,
    accessMode: ConversationAccessMode,
    attachments: readonly AttachmentData[],
    capabilityRefs: readonly string[],
    capabilities: readonly MessageCapabilityData[],
    thread: ThreadState,
    provider?: string,
    model?: string,
    queuedItem?: QueuedTurnData,
  ): Promise<{ turnId: string }> {
    if (thread.activeTurn) {
      throw new RpcError(-32003, "Thread already has an active turn");
    }
    const turnId = randomUUID();
    const controller = new AbortController();
    thread.accessMode = accessMode;
    thread.revision += 1;
    thread.activeTurn = {
      id: turnId,
      mode,
      isThinking: true,
      streamingText: "",
      metrics: {
        startedAt: this.host.now().toISOString(),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        modelDurationMs: 0,
        completedModelSteps: 0,
        streamedBytes: 0,
      },
      controller,
    };
    thread.progress = [];
    thread.injectedInputPendingModelResponse = false;
    thread.plan = mode === "plan" ? { source: "user", items: [] } : undefined;
    const userMessage: ConversationMessageData = {
      id: randomUUID(),
      role: "user",
      text: input,
      ...(mode === "plan" ? { mode } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(queuedItem ? { followUpDelivery: queuedItem.delivery } : {}),
      ...(capabilityRefs.length > 0 ? { capabilityRefs } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
    };
    try {
      await this.host.mutateConversation(thread, (conversation) =>
        this.host.updateConversation(
          {
            ...conversation,
            accessMode,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(queuedItem
              ? {
                  queuedTurns: (conversation.queuedTurns ?? []).filter(
                    ({ id }) => id !== queuedItem.id,
                  ),
                }
              : {}),
          },
          [...conversation.messages, userMessage],
        ),
      );
    } catch (error) {
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
      throw error;
    }

    // Kick off title generation as soon as the first user message is
    // persisted so the sidebar and header can refresh without waiting for
    // the model to finish the answer. Guards in requestConversationTitle
    // make this a no-op for follow-up turns.
    this.host.requestConversationTitle(threadId, thread);

    if (queuedItem) {
      this.host.notifyQueueUpdated(threadId, thread);
      this.host.notify("turn/follow-up/consumed", {
        threadId,
        itemId: queuedItem.id,
        message: userMessage,
      });
    }
    queueMicrotask(() => {
      void this.host.runTurn(
        threadId,
        turnId,
        input,
        mode,
        accessMode,
        attachments,
        capabilityRefs,
        capabilities,
        thread,
        controller,
        provider,
        model,
      );
    });

    return { turnId };
  }

  async addFollowUp(params: unknown): Promise<{ item: QueuedTurnData }> {
    const {
      threadId,
      input,
      delivery,
      attachments: attachmentValue,
    } = objectParams(params);
    requireString(threadId, "threadId");
    if (typeof input !== "string") {
      throw new RpcError(-32602, "input must be a string");
    }
    const attachments = parseAttachments(attachmentValue);
    for (const attachment of attachments) {
      this.requireLocalAttachment(attachment);
    }
    if (!input.trim() && attachments.length === 0) {
      throw new RpcError(-32602, "A follow-up requires text or an attachment");
    }
    if (delivery !== "inject" && delivery !== "queued") {
      throw new RpcError(-32602, "delivery must be inject or queued");
    }
    const thread = await this.host.requireThread(threadId);
    if (!thread.activeTurn) {
      throw new RpcError(-32004, "Thread does not have an active turn");
    }
    const item: QueuedTurnData = {
      id: randomUUID(),
      input: input.trim(),
      delivery,
      ...(attachments.length > 0 ? { attachments } : {}),
      createdAt: this.host.now().toISOString(),
    };
    await this.host.mutateConversation(thread, (conversation) => ({
      ...conversation,
      updatedAt: this.host.now().toISOString(),
      queuedTurns: [...(conversation.queuedTurns ?? []), item],
    }));
    this.host.notifyQueueUpdated(threadId, thread);
    return { item };
  }

  async injectQueuedTurn(params: unknown): Promise<{ item: QueuedTurnData }> {
    const { threadId, itemId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(itemId, "itemId");
    const thread = await this.host.requireThread(threadId);
    if (!thread.activeTurn) {
      throw new RpcError(-32004, "Thread does not have an active turn");
    }
    let injected: QueuedTurnData | undefined;
    await this.host.mutateConversation(thread, (conversation) => {
      const queuedTurns = (conversation.queuedTurns ?? []).map((item) => {
        if (item.id !== itemId) return item;
        injected = { ...item, delivery: "inject" };
        return injected;
      });
      if (!injected) throw new RpcError(-32005, "Queued item not found");
      return {
        ...conversation,
        updatedAt: this.host.now().toISOString(),
        queuedTurns,
      };
    });
    this.host.notifyQueueUpdated(threadId, thread);
    return { item: injected! };
  }

  async reorderQueuedTurn(
    params: unknown,
  ): Promise<{ queuedTurns: readonly QueuedTurnData[] }> {
    const { threadId, itemId, beforeItemId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(itemId, "itemId");
    if (beforeItemId !== undefined) requireString(beforeItemId, "beforeItemId");
    if (beforeItemId === itemId) {
      throw new RpcError(-32602, "An item cannot be placed before itself");
    }
    const thread = await this.host.requireThread(threadId);
    await this.host.mutateConversation(thread, (conversation) => {
      const queuedTurns = [...(conversation.queuedTurns ?? [])];
      const index = queuedTurns.findIndex(({ id }) => id === itemId);
      if (index < 0) throw new RpcError(-32005, "Queued item not found");
      const [item] = queuedTurns.splice(index, 1);
      const beforeIndex =
        beforeItemId === undefined
          ? queuedTurns.length
          : queuedTurns.findIndex(({ id }) => id === beforeItemId);
      if (beforeIndex < 0) {
        throw new RpcError(-32005, "Target queued item not found");
      }
      queuedTurns.splice(beforeIndex, 0, item!);
      return {
        ...conversation,
        updatedAt: this.host.now().toISOString(),
        queuedTurns,
      };
    });
    this.host.notifyQueueUpdated(threadId, thread);
    return { queuedTurns: thread.conversation.queuedTurns ?? [] };
  }

  async cancelQueuedTurn(params: unknown): Promise<{
    canceled: boolean;
    queuedTurns: readonly QueuedTurnData[];
  }> {
    const { threadId, itemId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(itemId, "itemId");
    const thread = await this.host.requireThread(threadId);
    let canceled = false;
    await this.host.mutateConversation(thread, (conversation) => {
      const queuedTurns = (conversation.queuedTurns ?? []).filter((item) => {
        if (item.id !== itemId) return true;
        canceled = true;
        return false;
      });
      return canceled
        ? {
            ...conversation,
            updatedAt: this.host.now().toISOString(),
            queuedTurns,
          }
        : conversation;
    });
    if (canceled) this.host.notifyQueueUpdated(threadId, thread);
    return {
      canceled,
      queuedTurns: thread.conversation.queuedTurns ?? [],
    };
  }

  interruptTurn(params: unknown): { interrupted: boolean } {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    const activeTurn = this.host.threads.get(threadId)?.activeTurn;
    if (!activeTurn) return { interrupted: false };

    activeTurn.controller.abort(new Error("Turn interrupted by client"));
    return { interrupted: true };
  }

  async cancelAgent(params: unknown): Promise<{ cancelled: boolean }> {
    const { threadId, agentId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(agentId, "agentId");
    const orchestrator =
      this.host.threads.get(threadId)?.activeTurn?.orchestrator;
    const cancelled = orchestrator?.cancel(agentId) ?? false;
    if (cancelled) await orchestrator?.flushRuntimeCheckpoints();
    return { cancelled };
  }

  async steerAgent(params: unknown): Promise<{ accepted: boolean }> {
    const { threadId, agentId, input } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(agentId, "agentId");
    requireString(input, "input");
    const orchestrator =
      this.host.threads.get(threadId)?.activeTurn?.orchestrator;
    const accepted = orchestrator?.steer(agentId, input) ?? false;
    if (accepted) await orchestrator?.flushRuntimeCheckpoints();
    return { accepted };
  }

  async retryAgent(params: unknown): Promise<{
    agent?: AgentTreeSnapshot["agents"][number];
  }> {
    const { threadId, agentId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(agentId, "agentId");
    const orchestrator =
      this.host.threads.get(threadId)?.activeTurn?.orchestrator;
    const agent = orchestrator?.retry(agentId);
    if (agent) await orchestrator?.flushRuntimeCheckpoints();
    return agent ? { agent } : {};
  }

  async listAgents(params: unknown): Promise<{
    agents: readonly AgentThreadData[];
  }> {
    const { threadId, turnId, includeRoot } = objectParams(params);
    requireString(threadId, "threadId");
    if (turnId !== undefined) requireString(turnId, "turnId");
    if (includeRoot !== undefined && typeof includeRoot !== "boolean") {
      throw new RpcError(-32602, "includeRoot must be a boolean");
    }
    const thread = await this.host.requireThread(threadId);
    await thread.activeTurn?.orchestrator?.flushRuntimeCheckpoints();
    const agents = (thread.conversation.agentRuns ?? [])
      .filter((run) => turnId === undefined || run.turnId === turnId)
      .flatMap((run) =>
        run.agents
          .filter(
            ({ agent }) => includeRoot === true || agent.id !== run.rootId,
          )
          .map((agent) => projectStoredAgentThread(threadId, run, agent)),
      );
    return { agents };
  }

  async readAgent(params: unknown): Promise<{ agent: AgentThreadData }> {
    const { threadId, agentId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(agentId, "agentId");
    const thread = await this.host.requireThread(threadId);
    await thread.activeTurn?.orchestrator?.flushRuntimeCheckpoints();
    for (const run of thread.conversation.agentRuns ?? []) {
      const stored = run.agents.find(({ agent }) => agent.id === agentId);
      if (stored) {
        return { agent: projectStoredAgentThread(threadId, run, stored) };
      }
    }
    throw new RpcError(-32004, `Unknown agent: ${agentId}`);
  }

  requireLocalAttachment(attachment: AttachmentData): void {
    try {
      const path = realpathSync(attachment.path);
      if (!statSync(path).isFile()) throw new Error("not a file");
      if (this.host.attachmentRoot) {
        const root = realpathSync(this.host.attachmentRoot);
        if (!path.startsWith(`${root}${sep}`)) throw new Error("outside root");
      }
    } catch {
      throw new RpcError(
        -32602,
        this.host.attachmentRoot
          ? "attachment path must be an uploaded file in the active project"
          : "attachment path must be a readable local file",
      );
    }
  }

  async processRequest(
    params: unknown,
    action: "status" | "read" | "wait" | "kill",
  ): Promise<ProcessSnapshotData> {
    if (!this.host.processes) {
      throw new RpcError(-32020, "Process management is not available");
    }
    const { sessionId, timeoutMs } = objectParams(params);
    requireString(sessionId, "sessionId");
    if (
      timeoutMs !== undefined &&
      (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1)
    ) {
      throw new RpcError(-32602, "timeoutMs must be a positive integer");
    }

    const snapshot =
      action === "wait"
        ? await this.host.processes.wait(
            sessionId,
            timeoutMs === undefined ? undefined : Number(timeoutMs),
          )
        : await this.host.processes[action](sessionId);
    await this.recordProcessSnapshot(snapshot);
    return snapshot;
  }

  async recordProcessSnapshot(snapshot: ProcessSnapshotData): Promise<void> {
    for (const thread of this.host.threads.values()) {
      thread.progress = projectProgressProcess(thread.progress, snapshot);
      const messages = projectMessagesProcess(
        thread.conversation.messages,
        snapshot,
      );
      if (messages === thread.conversation.messages) continue;
      const conversation = this.host.updateConversation(
        thread.conversation,
        messages,
      );
      await this.host.conversationStore.save(conversation);
      thread.conversation = conversation;
    }
  }
}
