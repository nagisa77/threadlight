import { Buffer } from "node:buffer";

import type {
  AgentEvent,
  AgentRuntimeSnapshot,
  AgentTreeEvent,
  AgentTreeSnapshot,
} from "@threadlight/agent-loop";
import { projectAgentProgress, projectAgentPlan } from "@threadlight/protocol";
import type {
  ActiveTurnData,
  ConversationMessageData,
  SendMessage,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
} from "./protocol.js";
import type { ThreadState, TurnCleanupContext } from "./app-server.js";
import type {
  ConversationStore,
  StoredAgentRun,
  StoredAgentThread,
  StoredConversation,
} from "./conversation-store.js";
import type { ModelStatePersistence } from "./model-state-persistence.js";
import {
  applyAgentThreadClosures,
  clientSafeAgentEvent,
  clientSafeAgentTree,
  upsertAgentRun,
  visibleAgentTree,
} from "./app-server-support.js";

export interface AppServerStateHost {
  conversationStore: ConversationStore;
  modelStatePersistence: ModelStatePersistence;
  now(): Date;
  turnCleanup?: (context: TurnCleanupContext) => void | Promise<void>;
  send: SendMessage;
}

type ActiveMetrics = NonNullable<ThreadState["activeTurn"]>["metrics"];

function addCompletedModelMetrics(
  metrics: ActiveMetrics,
  event: Extract<AgentEvent, { type: "model.completed" }>,
): ActiveMetrics {
  const inputTokens = event.usage?.inputTokens ?? 0;
  const outputTokens = event.usage?.outputTokens ?? 0;
  return {
    ...metrics,
    usage: {
      inputTokens: metrics.usage.inputTokens + inputTokens,
      outputTokens: metrics.usage.outputTokens + outputTokens,
      totalTokens:
        metrics.usage.totalTokens +
        (event.usage?.totalTokens ?? inputTokens + outputTokens),
    },
    modelDurationMs: metrics.modelDurationMs + (event.durationMs ?? 0),
    completedModelSteps: metrics.completedModelSteps + 1,
  };
}

function metricsFromAgentTree(
  current: ActiveMetrics,
  tree: AgentTreeSnapshot,
): ActiveMetrics {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let modelDurationMs = 0;
  let completedModelSteps = 0;

  for (const agent of tree.agents) {
    for (const entry of agent.transcript) {
      if (entry.kind !== "model" || entry.status !== "completed") continue;
      inputTokens += entry.usage?.inputTokens ?? 0;
      outputTokens += entry.usage?.outputTokens ?? 0;
      totalTokens += entry.usage?.totalTokens ?? 0;
      modelDurationMs += entry.durationMs ?? 0;
      completedModelSteps += 1;
    }
  }

  return {
    ...current,
    usage: { inputTokens, outputTokens, totalTokens },
    modelDurationMs,
    completedModelSteps,
  };
}

export class AppServerState {
  constructor(private readonly host: AppServerStateHost) {}

  mutateConversation(
    thread: ThreadState,
    update: (conversation: StoredConversation) => StoredConversation,
  ): Promise<void> {
    const mutation = thread.conversationMutation.then(async () => {
      const conversation = update(thread.conversation);
      if (conversation === thread.conversation) return;
      await this.host.conversationStore.save(conversation);
      thread.conversation = conversation;
    });
    thread.conversationMutation = mutation.catch(() => undefined);
    return mutation;
  }

  async persistAgentRunCheckpoint(
    thread: ThreadState,
    turnId: string,
    checkpoint: AgentRuntimeSnapshot,
  ): Promise<void> {
    const safeTasks = clientSafeAgentTree({
      rootId: checkpoint.rootId,
      maxConcurrent: checkpoint.maxConcurrent,
      agents: checkpoint.agents.map(({ task }) => task),
    }).agents;
    const agents: StoredAgentThread[] = checkpoint.agents.map(
      (runtimeAgent, index) => ({
        agent: safeTasks[index]!,
        ...(runtimeAgent.profileName
          ? { profileName: runtimeAgent.profileName }
          : {}),
        pendingInput: runtimeAgent.pendingInput,
        collected: runtimeAgent.collected,
        ...(runtimeAgent.modelState === undefined
          ? {}
          : {
              modelState: this.host.modelStatePersistence.prepare(
                runtimeAgent.modelState,
              ),
            }),
        ...(runtimeAgent.checkpointStep === undefined
          ? {}
          : { checkpointStep: runtimeAgent.checkpointStep }),
        ...(runtimeAgent.checkpointPhase === undefined
          ? {}
          : { checkpointPhase: runtimeAgent.checkpointPhase }),
      }),
    );
    await this.mutateConversation(thread, (conversation) => {
      const agentRuns = applyAgentThreadClosures(
        conversation.agentRuns ?? [],
        checkpoint.closedAgentThreads ?? [],
      );
      const existing = agentRuns.find((run) => run.turnId === turnId);
      if (existing && existing.status !== "active") {
        if (agentRuns === conversation.agentRuns) return conversation;
        return {
          ...conversation,
          updatedAt: checkpoint.updatedAt,
          agentRuns,
        };
      }
      const root = agents.find(({ agent }) => agent.id === checkpoint.rootId);
      const run: StoredAgentRun = {
        version: 1,
        turnId,
        rootId: checkpoint.rootId,
        maxConcurrent: checkpoint.maxConcurrent,
        status: "active",
        createdAt:
          existing?.createdAt ?? root?.agent.createdAt ?? checkpoint.updatedAt,
        updatedAt: checkpoint.updatedAt,
        agents,
      };
      return {
        ...conversation,
        updatedAt: checkpoint.updatedAt,
        agentRuns: upsertAgentRun(agentRuns, run),
      };
    });
  }

  finalizeAgentRun(
    conversation: StoredConversation,
    turnId: string,
    status: "completed" | "failed",
  ): StoredConversation {
    const runs = conversation.agentRuns ?? [];
    if (!runs.some((run) => run.turnId === turnId)) return conversation;
    const updatedAt = this.host.now().toISOString();
    return {
      ...conversation,
      updatedAt,
      agentRuns: runs.map((run) =>
        run.turnId === turnId ? { ...run, status, updatedAt } : run,
      ),
    };
  }

  notifyQueueUpdated(threadId: string, thread: ThreadState): void {
    this.notify("turn/queue/updated", {
      threadId,
      queuedTurns: thread.conversation.queuedTurns ?? [],
    });
  }

  async cleanupTurn(context: TurnCleanupContext): Promise<void> {
    if (!this.host.turnCleanup) return;
    try {
      await this.host.turnCleanup(context);
    } catch (error) {
      process.stderr.write(
        `Could not clean up turn ${context.turnId}: ${String(error)}\n`,
      );
    }
  }

  forwardEvent(
    threadId: string,
    turnId: string,
    thread: ThreadState,
    event: AgentEvent,
  ): void {
    const activeTurn =
      thread.activeTurn?.id === turnId ? thread.activeTurn : undefined;
    if (event.type === "model.started") {
      thread.pendingAssistantOutput = undefined;
      if (activeTurn) {
        activeTurn.isThinking = true;
        activeTurn.streamingText = "";
      }
    } else if (event.type === "model.output_text.delta") {
      if (activeTurn) {
        activeTurn.metrics.streamedBytes += Buffer.byteLength(
          event.delta,
          "utf8",
        );
        if (event.outputVisibility === "provisional") {
          activeTurn.isThinking = true;
          activeTurn.streamingText = "";
        } else {
          activeTurn.isThinking = false;
          activeTurn.streamingText += event.delta;
        }
      }
    } else if (event.type === "model.completed") {
      thread.injectedInputPendingModelResponse = false;
      if (activeTurn) {
        if (!activeTurn.agentTree) {
          activeTurn.metrics = addCompletedModelMetrics(
            activeTurn.metrics,
            event,
          );
        }
        activeTurn.isThinking = false;
        activeTurn.streamingText =
          event.toolCalls.length > 0 || event.outputVisibility === "provisional"
            ? ""
            : event.text;
      }
      thread.pendingAssistantOutput =
        event.toolCalls.length === 0 &&
        event.outputVisibility !== "provisional" &&
        event.text.trim()
          ? { text: event.text }
          : undefined;
    } else if (event.type === "tool.started") {
      if (activeTurn) activeTurn.isThinking = false;
    } else if (
      event.type === "message.completed" ||
      event.type === "run.completed" ||
      event.type === "run.failed"
    ) {
      if (activeTurn) activeTurn.isThinking = false;
      thread.injectedInputPendingModelResponse = false;
      thread.pendingAssistantOutput = undefined;
    }
    thread.progress = projectAgentProgress(thread.progress, event);
    thread.plan = projectAgentPlan(thread.plan, event);
    thread.revision += 1;
    const snapshot = this.requireActiveTurnSnapshot(thread, {
      includeAgentTree: false,
    });
    this.notify("agent/event", {
      threadId,
      turnId,
      revision: thread.revision,
      activeTurn: snapshot,
      event: clientSafeAgentEvent(event),
    });
  }

  forwardAgentTree(
    threadId: string,
    turnId: string,
    thread: ThreadState,
    event: AgentTreeEvent,
  ): void {
    const activeTurn =
      thread.activeTurn?.id === turnId ? thread.activeTurn : undefined;
    if (!activeTurn) return;
    const tree = clientSafeAgentTree(event.tree);
    activeTurn.agentTree = tree;
    activeTurn.metrics = metricsFromAgentTree(activeTurn.metrics, tree);
    thread.revision += 1;
    this.notify("agent/tree-updated", {
      threadId,
      turnId,
      revision: thread.revision,
      activeTurn: this.requireActiveTurnSnapshot(thread, {
        includeAgentTree: false,
      }),
      changedAgentId: event.changedAgentId,
      reason: event.reason,
      tree,
    });
  }

  activeTurnSnapshot(
    thread: ThreadState,
    options: { includeAgentTree?: boolean } = {},
  ): ActiveTurnData | undefined {
    const activeTurn = thread.activeTurn;
    if (!activeTurn) return;
    // The assistant message is persisted before the completion notification.
    // Do not expose the same turn as both completed history and live output in
    // the small interval between those two operations.
    if (thread.conversation.messages.at(-1)?.role === "assistant") return;
    const sourcedStreamingOutput = activeTurn.sourceCitations?.preview(
      activeTurn.streamingText,
    );
    return {
      turnId: activeTurn.id,
      revision: thread.revision,
      mode: activeTurn.mode,
      isThinking: activeTurn.isThinking,
      streamingText: sourcedStreamingOutput?.text ?? activeTurn.streamingText,
      metrics: {
        ...activeTurn.metrics,
        usage: { ...activeTurn.metrics.usage },
      },
      ...(sourcedStreamingOutput?.sources.length
        ? {
            sources: sourcedStreamingOutput.sources,
            citations: sourcedStreamingOutput.citations,
          }
        : {}),
      progress: thread.progress,
      ...(thread.plan ? { plan: thread.plan } : {}),
      ...(options.includeAgentTree !== false &&
      visibleAgentTree(activeTurn.agentTree)
        ? { agentTree: activeTurn.agentTree }
        : {}),
    };
  }

  requireActiveTurnSnapshot(
    thread: ThreadState,
    options: { includeAgentTree?: boolean } = {},
  ): ActiveTurnData {
    const snapshot = this.activeTurnSnapshot(thread, options);
    if (!snapshot) {
      throw new Error(
        `Thread ${thread.conversation.threadId} has no active turn snapshot`,
      );
    }
    return snapshot;
  }

  updateConversation(
    conversation: StoredConversation,
    messages: readonly ConversationMessageData[],
    options?: { modelState: unknown },
  ): StoredConversation {
    const { modelState: _previousModelState, ...stored } = conversation;
    const modelState = options ? options.modelState : conversation.modelState;
    return {
      ...stored,
      updatedAt: this.host.now().toISOString(),
      messages,
      ...(modelState === undefined ? {} : { modelState }),
    };
  }

  notify<Method extends ThreadlightNotificationMethod>(
    method: Method,
    params: ThreadlightNotificationMap[Method],
  ): void {
    this.host.send({ jsonrpc: "2.0", method, params });
  }
}
