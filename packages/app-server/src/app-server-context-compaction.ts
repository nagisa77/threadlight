import { randomUUID } from "node:crypto";

import type {
  Agent,
  ModelConversationMessage,
  RunOptions,
} from "@threadlight/agent-loop";

import type { ConversationMessageData } from "./protocol.js";
import type { ThreadState } from "./thread-state.js";
import type { AppServerState } from "./app-server-state.js";
import { composePrompt, promptBlocksFromSnapshot } from "./prompt-composer.js";
import type { TurnDiagnosticsRecorder } from "./app-server-support.js";
import {
  ContextCompactor,
  lastProviderContextTokens,
  modelHistoryContext,
  type ContextCompactionOutcome,
  type RuntimeContextCompactionOutcome,
} from "./context-compaction.js";

interface ManualContextCompactionInput {
  compactor: ContextCompactor;
  state: AppServerState;
  thread: ThreadState;
  threadId: string;
  turnId: string;
  input: string;
  provider?: string;
  model?: string;
  controller: AbortController;
  diagnostics: TurnDiagnosticsRecorder;
  now(): Date;
  cleanup(): Promise<void>;
}

interface AutomaticContextCompactionInput {
  compactor: ContextCompactor;
  state: AppServerState;
  thread: ThreadState;
  agent: Agent;
  input: string;
  signal: AbortSignal;
  now(): Date;
}

interface RuntimeContextCompactionInput {
  compactor: ContextCompactor;
  state: AppServerState;
  thread: ThreadState;
  currentInputPersisted?: boolean;
  now(): Date;
}

interface RuntimeContextCompaction {
  history: readonly ModelConversationMessage[];
  beforeModelRequest: NonNullable<RunOptions["beforeModelRequest"]>;
  outcome(): ContextCompactionOutcome | undefined;
}

export async function completeManualContextCompaction({
  compactor,
  state,
  thread,
  threadId,
  turnId,
  input,
  provider,
  model,
  controller,
  diagnostics,
  now,
  cleanup,
}: ManualContextCompactionInput): Promise<void> {
  const compactionAgent = {
    ...thread.agent,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    instructions: composePrompt(promptBlocksFromSnapshot(thread.promptSnapshot))
      .instructions,
  };
  const compaction = await compactor.compact({
    conversation: thread.conversation,
    messages: thread.conversation.messages.slice(0, -1),
    agent: compactionAgent,
    input,
    source: "manual",
    now: now(),
    signal: controller.signal,
  });
  await persistContextCompaction(state, thread, compaction);
  const turnDiagnostics = diagnostics.complete(
    "completed",
    now(),
    compaction.durationMs,
  );
  const assistantMessage: ConversationMessageData = {
    id: randomUUID(),
    role: "assistant",
    text: "",
    ...(compaction.receipt ? { contextCompaction: compaction.receipt } : {}),
    diagnostics: turnDiagnostics,
  };
  await state.mutateConversation(thread, (conversation) =>
    state.updateConversation(conversation, [
      ...conversation.messages,
      assistantMessage,
    ]),
  );
  await cleanup();
  thread.revision += 1;
  state.notify("turn/completed", {
    threadId,
    turnId,
    revision: thread.revision,
    message: assistantMessage,
    output: "",
    usage: compaction.usage,
    diagnostics: turnDiagnostics,
  });
}

export async function maybeCompactContext({
  compactor,
  state,
  thread,
  agent,
  input,
  signal,
  now,
}: AutomaticContextCompactionInput): Promise<
  ContextCompactionOutcome | undefined
> {
  const messages = thread.conversation.messages.slice(0, -1);
  if (
    !compactor.shouldCompact({
      conversation: thread.conversation,
      messages,
      agent,
      input,
      signal,
    })
  ) {
    return;
  }
  const outcome = await compactor.compact({
    conversation: thread.conversation,
    messages,
    agent,
    input,
    source: "automatic",
    now: now(),
    signal,
  });
  await persistContextCompaction(state, thread, outcome);
  return outcome;
}

export function createRuntimeContextCompaction({
  compactor,
  state,
  thread,
  currentInputPersisted = true,
  now,
}: RuntimeContextCompactionInput): RuntimeContextCompaction {
  const messages = currentInputPersisted
    ? thread.conversation.messages.slice(0, -1)
    : thread.conversation.messages;
  const historyContext = modelHistoryContext(thread.conversation, messages);
  const sourceMessageIds = new Map(
    historyContext.history.flatMap((message, index) => {
      const sourceId = historyContext.sourceMessageIds[index];
      return sourceId ? [[message, sourceId] as const] : [];
    }),
  );
  let latest: ContextCompactionOutcome | undefined;
  return {
    history: historyContext.history,
    beforeModelRequest: compactor.createBeforeModelRequest({
      initialGeneration: thread.conversation.contextCompaction?.generation,
      initialContextTokens: lastProviderContextTokens(messages),
      onCompacted: async (outcome) => {
        const firstKeptMessageId = outcome.firstKeptMessage
          ? sourceMessageIds.get(outcome.firstKeptMessage)
          : undefined;
        latest = await persistRuntimeContextCompaction(
          state,
          thread,
          outcome,
          firstKeptMessageId ?? thread.conversation.messages.at(-1)?.id,
          now(),
        );
      },
    }),
    outcome: () => latest,
  };
}

export async function persistRuntimeContextCompaction(
  state: AppServerState,
  thread: ThreadState,
  outcome: RuntimeContextCompactionOutcome,
  firstKeptMessageId: string | undefined,
  now: Date,
): Promise<ContextCompactionOutcome> {
  const checkpoint = {
    version: 1 as const,
    generation: outcome.record.generation,
    summary: outcome.summary,
    ...(firstKeptMessageId ? { firstKeptMessageId } : {}),
    source: "automatic" as const,
    compactedAt: now.toISOString(),
    tokensBefore: outcome.record.tokensBefore,
    tokensAfter: outcome.record.tokensAfter,
    messagesCompacted: outcome.record.messagesCompacted,
  };
  const compacted: ContextCompactionOutcome = {
    checkpoint,
    receipt: {
      status: "compacted",
      source: "automatic",
      generation: checkpoint.generation,
      compactedAt: checkpoint.compactedAt,
      tokensBefore: checkpoint.tokensBefore,
      tokensAfter: checkpoint.tokensAfter,
      messagesCompacted: checkpoint.messagesCompacted,
    },
    usage: outcome.usage,
    durationMs: outcome.record.durationMs,
  };
  await persistContextCompaction(state, thread, compacted);
  return compacted;
}

async function persistContextCompaction(
  state: AppServerState,
  thread: ThreadState,
  outcome: ContextCompactionOutcome,
): Promise<void> {
  if (!outcome.checkpoint) return;
  await state.mutateConversation(thread, (conversation) =>
    state.updateConversation(
      { ...conversation, contextCompaction: outcome.checkpoint },
      conversation.messages,
      { modelState: undefined },
    ),
  );
}
