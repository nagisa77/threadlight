import { randomUUID } from "node:crypto";

import type { ConversationMessageData, QueuedTurnData } from "./protocol.js";
import type { ThreadState } from "./thread-state.js";
import type { AppServerState } from "./app-server-state.js";

export async function consumeInjectedInput(
  state: AppServerState,
  threadId: string,
  turnId: string,
  thread: ThreadState,
): Promise<QueuedTurnData | undefined> {
  if (
    thread.activeTurn?.id !== turnId ||
    thread.injectedInputPendingModelResponse
  ) {
    return;
  }
  let consumed: QueuedTurnData | undefined;
  let message: ConversationMessageData | undefined;
  let precedingAssistantMessage: ConversationMessageData | undefined;
  const pendingAssistantOutput = thread.pendingAssistantOutput;
  const finalizedPendingOutput = thread.activeTurn?.sourceCitations?.finalize(
    pendingAssistantOutput?.text ?? "",
  );
  await state.mutateConversation(thread, (conversation) => {
    consumed = (conversation.queuedTurns ?? []).find(
      ({ delivery }) => delivery === "inject",
    );
    if (!consumed) return conversation;
    message = {
      id: randomUUID(),
      turnId,
      role: "user",
      text: consumed.input,
      followUpDelivery: "inject",
      ...(consumed.attachments?.length
        ? { attachments: consumed.attachments }
        : {}),
    };
    if (pendingAssistantOutput || thread.progress.length > 0) {
      precedingAssistantMessage = {
        id: randomUUID(),
        turnId,
        role: "assistant",
        text:
          finalizedPendingOutput?.text ?? pendingAssistantOutput?.text ?? "",
        ...(thread.progress.length > 0 ? { progress: thread.progress } : {}),
        ...(finalizedPendingOutput?.sources.length
          ? {
              sources: finalizedPendingOutput.sources,
              citations: finalizedPendingOutput.citations,
            }
          : {}),
      };
    }
    return state.updateConversation(
      {
        ...conversation,
        queuedTurns: (conversation.queuedTurns ?? []).filter(
          ({ id }) => id !== consumed?.id,
        ),
      },
      [
        ...conversation.messages,
        ...(precedingAssistantMessage ? [precedingAssistantMessage] : []),
        message,
      ],
    );
  });
  if (!consumed || !message) return;
  thread.injectedInputPendingModelResponse = true;
  if (
    precedingAssistantMessage &&
    thread.pendingAssistantOutput === pendingAssistantOutput
  ) {
    thread.pendingAssistantOutput = undefined;
    thread.progress = [];
    if (thread.activeTurn?.id === turnId) {
      thread.activeTurn.streamingText = "";
    }
  }
  state.notifyQueueUpdated(threadId, thread);
  state.notify("turn/follow-up/consumed", {
    threadId,
    itemId: consumed.id,
    message,
    ...(precedingAssistantMessage ? { precedingAssistantMessage } : {}),
  });
  return consumed;
}
