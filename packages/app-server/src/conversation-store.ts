import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type {
  AgentTaskData,
  ConversationAccessMode,
  ConversationMessageData,
  QueuedTurnData,
} from "@threadlight/protocol";

import {
  validatePromptSnapshot,
  type PromptSnapshot,
} from "./prompt-composer.js";

export interface StoredAgentSnapshot {
  version: 1;
  prompt: PromptSnapshot;
  runtime?: unknown;
}

export interface StoredAgentThread {
  agent: AgentTaskData;
  profileName?: string;
  pendingInput: readonly string[];
  collected: boolean;
  modelState?: unknown;
  checkpointStep?: number;
  checkpointPhase?: "model_completed" | "tool_started" | "tool_completed";
  interruption?: {
    previousStatus: "queued" | "running";
    interruptedAt: string;
    reason: string;
  };
}

export interface StoredAgentRun {
  version: 1;
  turnId: string;
  rootId: string;
  maxConcurrent: number;
  status: "active" | "completed" | "failed" | "interrupted";
  createdAt: string;
  updatedAt: string;
  agents: readonly StoredAgentThread[];
}

export interface StoredConversation {
  version: 1;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  title?: string;
  titleGeneratedAt?: string;
  titleStatus?: "pending" | "completed";
  accessMode?: ConversationAccessMode;
  /** Provider selected for this conversation (routing hint). */
  provider?: string;
  /** Model selected for this conversation. */
  model?: string;
  messages: readonly ConversationMessageData[];
  queuedTurns?: readonly QueuedTurnData[];
  modelState?: unknown;
  agentSnapshot?: StoredAgentSnapshot;
  agentRuns?: readonly StoredAgentRun[];
}

export interface ConversationStore {
  create(conversation: StoredConversation): void | Promise<void>;
  load(
    threadId: string,
  ): StoredConversation | undefined | Promise<StoredConversation | undefined>;
  save(conversation: StoredConversation): void | Promise<void>;
  delete(threadId: string): boolean | Promise<boolean>;
}

export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();

  create(conversation: StoredConversation): void {
    this.conversations.set(conversation.threadId, clone(conversation));
  }

  load(threadId: string): StoredConversation | undefined {
    const conversation = this.conversations.get(threadId);
    return conversation ? clone(conversation) : undefined;
  }

  save(conversation: StoredConversation): void {
    this.conversations.set(conversation.threadId, clone(conversation));
  }

  delete(threadId: string): boolean {
    return this.conversations.delete(threadId);
  }
}

export class FileConversationStore implements ConversationStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  create(conversation: StoredConversation): void {
    this.write(conversation);
  }

  load(threadId: string): StoredConversation | undefined {
    const path = this.pathFor(threadId);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }

    const value = JSON.parse(source) as unknown;
    if (!isStoredConversation(value) || value.threadId !== threadId) {
      throw new Error(`Conversation ${threadId} has an unsupported format`);
    }
    return value;
  }

  save(conversation: StoredConversation): void {
    this.write(conversation);
  }

  delete(threadId: string): boolean {
    const path = this.pathFor(threadId);
    try {
      rmSync(path);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  private write(conversation: StoredConversation): void {
    const path = this.pathFor(conversation.threadId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(conversation, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      renameSync(temporaryPath, path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private pathFor(threadId: string): string {
    if (
      !threadId ||
      basename(threadId) !== threadId ||
      !/^[\w-]+$/.test(threadId)
    ) {
      throw new Error("Invalid conversation id");
    }
    return join(this.directory, `${threadId}.json`);
  }
}

function clone(conversation: StoredConversation): StoredConversation {
  return structuredClone(conversation);
}

function isStoredConversation(value: unknown): value is StoredConversation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const conversation = value as Record<string, unknown>;
  return (
    conversation.version === 1 &&
    typeof conversation.threadId === "string" &&
    typeof conversation.createdAt === "string" &&
    typeof conversation.updatedAt === "string" &&
    (conversation.title === undefined ||
      typeof conversation.title === "string") &&
    (conversation.titleGeneratedAt === undefined ||
      typeof conversation.titleGeneratedAt === "string") &&
    (conversation.titleStatus === undefined ||
      conversation.titleStatus === "pending" ||
      conversation.titleStatus === "completed") &&
    (conversation.accessMode === undefined ||
      conversation.accessMode === "approval" ||
      conversation.accessMode === "full") &&
    (conversation.provider === undefined ||
      typeof conversation.provider === "string") &&
    (conversation.model === undefined ||
      typeof conversation.model === "string") &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isConversationMessage) &&
    (conversation.queuedTurns === undefined ||
      (Array.isArray(conversation.queuedTurns) &&
        conversation.queuedTurns.every(isQueuedTurn))) &&
    (conversation.agentSnapshot === undefined ||
      isStoredAgentSnapshot(conversation.agentSnapshot)) &&
    (conversation.agentRuns === undefined ||
      (Array.isArray(conversation.agentRuns) &&
        conversation.agentRuns.every(isStoredAgentRun)))
  );
}

function isStoredAgentRun(value: unknown): value is StoredAgentRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return (
    run.version === 1 &&
    typeof run.turnId === "string" &&
    typeof run.rootId === "string" &&
    Number.isInteger(run.maxConcurrent) &&
    Number(run.maxConcurrent) > 0 &&
    (run.status === "active" ||
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "interrupted") &&
    typeof run.createdAt === "string" &&
    typeof run.updatedAt === "string" &&
    Array.isArray(run.agents) &&
    run.agents.every(isStoredAgentThread)
  );
}

function isStoredAgentThread(value: unknown): value is StoredAgentThread {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const thread = value as Record<string, unknown>;
  return (
    isAgentTask(thread.agent) &&
    (thread.profileName === undefined ||
      typeof thread.profileName === "string") &&
    Array.isArray(thread.pendingInput) &&
    thread.pendingInput.every((input) => typeof input === "string") &&
    typeof thread.collected === "boolean" &&
    (thread.checkpointStep === undefined ||
      (Number.isInteger(thread.checkpointStep) &&
        Number(thread.checkpointStep) >= 0)) &&
    (thread.checkpointPhase === undefined ||
      thread.checkpointPhase === "model_completed" ||
      thread.checkpointPhase === "tool_started" ||
      thread.checkpointPhase === "tool_completed") &&
    (thread.interruption === undefined ||
      isStoredAgentInterruption(thread.interruption))
  );
}

function isStoredAgentInterruption(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const interruption = value as Record<string, unknown>;
  return (
    (interruption.previousStatus === "queued" ||
      interruption.previousStatus === "running") &&
    typeof interruption.interruptedAt === "string" &&
    typeof interruption.reason === "string"
  );
}

function isQueuedTurn(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const attachmentsValid =
    item.attachments === undefined ||
    (Array.isArray(item.attachments) && item.attachments.every(isAttachment));
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.input === "string" &&
    (item.input.trim().length > 0 ||
      (Array.isArray(item.attachments) && item.attachments.length > 0)) &&
    (item.delivery === "inject" || item.delivery === "queued") &&
    attachmentsValid &&
    typeof item.createdAt === "string"
  );
}

function isStoredAgentSnapshot(value: unknown): value is StoredAgentSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1) return false;
  try {
    validatePromptSnapshot(snapshot.prompt);
    return true;
  } catch {
    return false;
  }
}

function isConversationMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    (message.attachments === undefined ||
      (Array.isArray(message.attachments) &&
        message.attachments.every(isAttachment))) &&
    (message.followUpDelivery === undefined ||
      message.followUpDelivery === "inject" ||
      message.followUpDelivery === "queued") &&
    (message.capabilityRefs === undefined ||
      (Array.isArray(message.capabilityRefs) &&
        message.capabilityRefs.every(
          (ref) => typeof ref === "string" && ref.length > 0,
        ))) &&
    (message.capabilities === undefined ||
      (Array.isArray(message.capabilities) &&
        message.capabilities.every(isMessageCapability))) &&
    (message.error === undefined || typeof message.error === "boolean") &&
    (message.mode === undefined ||
      message.mode === "default" ||
      message.mode === "plan") &&
    (message.plan === undefined || isAgentPlan(message.plan)) &&
    (message.diagnostics === undefined ||
      isTurnDiagnostics(message.diagnostics)) &&
    (message.sources === undefined ||
      (Array.isArray(message.sources) &&
        message.sources.every(isMessageSource))) &&
    (message.citations === undefined ||
      (Array.isArray(message.citations) &&
        message.citations.every(isMessageCitation))) &&
    (message.progress === undefined ||
      (Array.isArray(message.progress) &&
        message.progress.every(isConversationProgress))) &&
    (message.agentTree === undefined || isAgentTree(message.agentTree)) &&
    (message.activities === undefined || Array.isArray(message.activities))
  );
}

function isAgentTree(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tree = value as Record<string, unknown>;
  return (
    typeof tree.rootId === "string" &&
    Number.isInteger(tree.maxConcurrent) &&
    Number(tree.maxConcurrent) > 0 &&
    Array.isArray(tree.agents) &&
    tree.agents.every(isAgentTask)
  );
}

function isAgentTask(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as Record<string, unknown>;
  const status = task.status;
  const phase = task.phase;
  return (
    typeof task.id === "string" &&
    (task.parentId === undefined || typeof task.parentId === "string") &&
    (task.agentThreadId === undefined ||
      typeof task.agentThreadId === "string") &&
    (task.retryOf === undefined || typeof task.retryOf === "string") &&
    (task.followUpOf === undefined || typeof task.followUpOf === "string") &&
    (task.closedAt === undefined || typeof task.closedAt === "string") &&
    (task.runId === undefined || typeof task.runId === "string") &&
    typeof task.name === "string" &&
    typeof task.role === "string" &&
    typeof task.task === "string" &&
    (status === "queued" ||
      status === "running" ||
      status === "completed" ||
      status === "failed" ||
      status === "cancelled" ||
      status === "interrupted") &&
    (phase === "queued" ||
      phase === "thinking" ||
      phase === "working" ||
      phase === "waiting" ||
      phase === "done") &&
    typeof task.createdAt === "string" &&
    (task.startedAt === undefined || typeof task.startedAt === "string") &&
    (task.completedAt === undefined || typeof task.completedAt === "string") &&
    isNonNegativeNumber(task.elapsedMs) &&
    (task.latestActivity === undefined ||
      typeof task.latestActivity === "string") &&
    (task.summary === undefined || typeof task.summary === "string") &&
    (task.output === undefined || typeof task.output === "string") &&
    (task.error === undefined || typeof task.error === "string") &&
    (task.steps === undefined ||
      (Number.isInteger(task.steps) && Number(task.steps) >= 0)) &&
    (task.usage === undefined || isTokenUsage(task.usage)) &&
    Array.isArray(task.activities) &&
    task.activities.every((activity) => {
      if (
        !activity ||
        typeof activity !== "object" ||
        Array.isArray(activity)
      ) {
        return false;
      }
      const item = activity as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        (item.status === "running" ||
          item.status === "completed" ||
          item.status === "failed") &&
        (item.durationMs === undefined || isNonNegativeNumber(item.durationMs))
      );
    }) &&
    (task.transcript === undefined ||
      (Array.isArray(task.transcript) &&
        task.transcript.every(isAgentTranscriptEntry)))
  );
}

function isAgentTranscriptEntry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const common =
    typeof entry.id === "string" &&
    (entry.status === "running" ||
      entry.status === "completed" ||
      entry.status === "failed") &&
    typeof entry.startedAt === "string" &&
    (entry.completedAt === undefined ||
      typeof entry.completedAt === "string") &&
    (entry.durationMs === undefined || isNonNegativeNumber(entry.durationMs));
  if (!common) return false;
  if (entry.kind === "model") {
    return (
      Number.isInteger(entry.step) &&
      Number(entry.step) > 0 &&
      typeof entry.text === "string" &&
      (entry.usage === undefined || isTokenUsage(entry.usage)) &&
      (entry.outputVisibility === undefined ||
        entry.outputVisibility === "user" ||
        entry.outputVisibility === "provisional")
    );
  }
  return (
    entry.kind === "tool" &&
    typeof entry.name === "string" &&
    typeof entry.arguments === "string" &&
    (entry.output === undefined || typeof entry.output === "string") &&
    (entry.isError === undefined || typeof entry.isError === "boolean") &&
    (entry.errorCode === undefined || typeof entry.errorCode === "string")
  );
}

function isMessageSource(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === "string" &&
    typeof source.title === "string" &&
    typeof source.url === "string" &&
    /^https?:\/\//.test(source.url) &&
    typeof source.domain === "string" &&
    (source.description === undefined || typeof source.description === "string")
  );
}

function isMessageCitation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const citation = value as Record<string, unknown>;
  return (
    typeof citation.id === "string" &&
    Array.isArray(citation.sourceIds) &&
    citation.sourceIds.length > 0 &&
    citation.sourceIds.every((id) => typeof id === "string") &&
    typeof citation.excerpt === "string"
  );
}

function isTurnDiagnostics(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const diagnostics = value as Record<string, unknown>;
  return (
    (diagnostics.status === "completed" || diagnostics.status === "failed") &&
    typeof diagnostics.startedAt === "string" &&
    typeof diagnostics.completedAt === "string" &&
    isNonNegativeNumber(diagnostics.durationMs) &&
    (diagnostics.model === undefined ||
      typeof diagnostics.model === "string") &&
    isTokenUsage(diagnostics.usage) &&
    Array.isArray(diagnostics.modelSteps) &&
    diagnostics.modelSteps.every(isModelStepDiagnostics) &&
    Array.isArray(diagnostics.toolCalls) &&
    diagnostics.toolCalls.every(isToolCallDiagnostics) &&
    (diagnostics.metrics === undefined ||
      (isDiagnosticsScopeSet(diagnostics.metrics) &&
        isDiagnosticsScope(diagnostics.metrics.root) &&
        isDiagnosticsScope(diagnostics.metrics.children) &&
        isDiagnosticsScope(diagnostics.metrics.total)))
  );
}

function isDiagnosticsScopeSet(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isDiagnosticsScope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  return (
    isTokenUsage(scope.usage) &&
    Array.isArray(scope.modelSteps) &&
    scope.modelSteps.every(isModelStepDiagnostics) &&
    Array.isArray(scope.toolCalls) &&
    scope.toolCalls.every(isToolCallDiagnostics)
  );
}

function isModelStepDiagnostics(step: unknown): boolean {
  if (!step || typeof step !== "object" || Array.isArray(step)) return false;
  const candidate = step as Record<string, unknown>;
  return (
    Number.isInteger(candidate.step) &&
    Number(candidate.step) > 0 &&
    isNonNegativeNumber(candidate.durationMs) &&
    isTokenUsage(candidate.usage) &&
    (candidate.agentId === undefined || typeof candidate.agentId === "string") &&
    (candidate.agentRole === undefined ||
      typeof candidate.agentRole === "string")
  );
}

function isToolCallDiagnostics(tool: unknown): boolean {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return false;
  }
  const candidate = tool as Record<string, unknown>;
  return (
    typeof candidate.callId === "string" &&
    typeof candidate.name === "string" &&
    isNonNegativeNumber(candidate.durationMs) &&
    typeof candidate.isError === "boolean" &&
    (candidate.errorCode === undefined ||
      typeof candidate.errorCode === "string") &&
    (candidate.agentId === undefined ||
      typeof candidate.agentId === "string") &&
    (candidate.agentRole === undefined ||
      typeof candidate.agentRole === "string")
  );
}

function isTokenUsage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return (
    isNonNegativeNumber(usage.inputTokens) &&
    isNonNegativeNumber(usage.outputTokens) &&
    isNonNegativeNumber(usage.totalTokens)
  );
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMessageCapability(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const capability = value as Record<string, unknown>;
  return (
    typeof capability.id === "string" &&
    capability.id.length > 0 &&
    (capability.kind === "skill" || capability.kind === "tool") &&
    typeof capability.name === "string" &&
    capability.name.length > 0 &&
    (capability.source === undefined ||
      typeof capability.source === "string") &&
    (capability.icon === undefined || typeof capability.icon === "string")
  );
}

function isAgentPlan(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    (plan.source === "user" || plan.source === "model") &&
    (plan.explanation === undefined || typeof plan.explanation === "string") &&
    (plan.documentPath === undefined ||
      (typeof plan.documentPath === "string" &&
        /^\.threadlight\/plans\/[A-Za-z0-9_-]+\.md$/.test(
          plan.documentPath,
        ))) &&
    (plan.documentVersion === undefined ||
      (typeof plan.documentVersion === "string" &&
        /^[a-f0-9]{16}$/.test(plan.documentVersion))) &&
    Array.isArray(plan.items) &&
    plan.items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.step === "string" &&
        (candidate.details === undefined ||
          typeof candidate.details === "string") &&
        (candidate.acceptanceCriteria === undefined ||
          (Array.isArray(candidate.acceptanceCriteria) &&
            candidate.acceptanceCriteria.every(
              (criterion) => typeof criterion === "string",
            ))) &&
        (candidate.completionEvidence === undefined ||
          (Array.isArray(candidate.completionEvidence) &&
            candidate.completionEvidence.every(
              (evidence) => typeof evidence === "string",
            ))) &&
        (candidate.status === "pending" ||
          candidate.status === "in_progress" ||
          candidate.status === "completed")
      );
    })
  );
}

function isAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    (attachment.kind === "image" || attachment.kind === "file") &&
    typeof attachment.path === "string"
  );
}

function isConversationProgress(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  return (
    typeof progress.text === "string" && Array.isArray(progress.activities)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
