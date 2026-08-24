import type {
  AgentRunCheckpoint,
  ModelConversationMessage,
  ToolResult,
} from "@threadlight/agent-loop";

import type { ConversationMessageData } from "./protocol.js";
import type { StoredConversation } from "./conversation-store.js";

export function withoutResumableTurn(
  conversation: StoredConversation,
): StoredConversation {
  const { resumableTurn: _resumableTurn, ...remaining } = conversation;
  return remaining;
}

export function upsertTurnAssistantMessage(
  messages: readonly ConversationMessageData[],
  assistantMessage: ConversationMessageData,
): readonly ConversationMessageData[] {
  const index = lastIndexWhere(
    messages,
    (message) =>
      message.role === "assistant" &&
      (message.id === assistantMessage.id ||
        (assistantMessage.turnId !== undefined &&
          message.turnId === assistantMessage.turnId &&
          message.interrupted === true)),
  );
  if (index < 0) return [...messages, assistantMessage];
  return messages.map((message, messageIndex) =>
    messageIndex === index ? assistantMessage : message,
  );
}

export function continuationHistory(
  checkpoint: AgentRunCheckpoint | undefined,
  interruptedMessage: ConversationMessageData | undefined,
): readonly ModelConversationMessage[] | undefined {
  if (!checkpoint?.contextHistory) return;
  const history = checkpoint.contextHistory.map((message) => ({
    ...message,
    ...(message.toolCalls
      ? { toolCalls: message.toolCalls.map((call) => ({ ...call })) }
      : {}),
    ...(message.toolResults
      ? {
          toolResults: message.toolResults.map((result) => ({ ...result })),
        }
      : {}),
  }));
  if (checkpoint.phase === "model_started" && interruptedMessage?.text.trim()) {
    history.push({ role: "assistant", text: interruptedMessage.text });
  }
  return completeInterruptedToolResults(history);
}

function completeInterruptedToolResults(
  history: readonly ModelConversationMessage[],
): readonly ModelConversationMessage[] {
  const assistantIndex = lastIndexWhere(
    history,
    (message) =>
      message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0,
  );
  if (assistantIndex < 0) return history;
  const calls = history[assistantIndex]?.toolCalls ?? [];
  const completed = history
    .slice(assistantIndex + 1)
    .flatMap((message) => message.toolResults ?? []);
  const completedIds = new Set(completed.map(({ callId }) => callId));
  const interrupted: ToolResult[] = calls
    .filter(({ id }) => !completedIds.has(id))
    .map((call) => ({
      callId: call.id,
      name: call.name,
      output: "Tool execution was interrupted before completion.",
      isError: true,
    }));
  if (interrupted.length === 0) return history;

  const next = [...history];
  const resultIndex = next.findIndex(
    (message, index) =>
      index > assistantIndex && (message.toolResults?.length ?? 0) > 0,
  );
  if (resultIndex < 0) {
    next.splice(assistantIndex + 1, 0, {
      role: "user",
      text: "",
      toolResults: interrupted,
    });
    return next;
  }
  const resultMessage = next[resultIndex]!;
  next[resultIndex] = {
    ...resultMessage,
    toolResults: [...(resultMessage.toolResults ?? []), ...interrupted],
  };
  return next;
}

function lastIndexWhere<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}
