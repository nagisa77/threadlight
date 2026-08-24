import type {
  ActiveTurnData,
  ConversationActivityData,
  ConversationDisplayMessageData,
  ConversationMessageData,
  ConversationProgressData,
} from "@threadlight/protocol";

export function conversationMessagesForDisplay(
  messages: readonly ConversationMessageData[],
): ConversationDisplayMessageData[] {
  return messages
    .filter((message) => message.interrupted !== true)
    .map(conversationMessageForDisplay);
}

export function activeTurnForDisplay(
  activeTurn: ActiveTurnData,
): ActiveTurnData {
  return {
    ...activeTurn,
    progress: progressForDisplay(activeTurn.progress),
  };
}

export function findConversationActivity(
  messages: readonly ConversationMessageData[],
  activeProgress: readonly ConversationProgressData[],
  activityId: string,
): ConversationActivityData | undefined {
  const active = findProgressActivity(activeProgress, activityId);
  if (active) return active;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const activity =
      findProgressActivity(message.progress ?? [], activityId) ??
      message.activities?.find(({ id }) => id === activityId);
    if (activity) return activity;
  }
  return;
}

function conversationMessageForDisplay(
  message: ConversationMessageData,
): ConversationDisplayMessageData {
  const {
    diagnostics: _diagnostics,
    interrupted: _interrupted,
    ...display
  } = message;
  return {
    ...display,
    ...(message.progress
      ? { progress: progressForDisplay(message.progress) }
      : {}),
    ...(message.activities
      ? { activities: message.activities.map(activityForDisplay) }
      : {}),
  };
}

function progressForDisplay(
  progress: readonly ConversationProgressData[],
): ConversationProgressData[] {
  return progress.map((step) => ({
    ...step,
    activities: step.activities.map(activityForDisplay),
  }));
}

function activityForDisplay(
  activity: ConversationActivityData,
): ConversationActivityData {
  if (activity.status === "running") return activity;
  const { detail, process, ...summary } = activity;
  return {
    ...summary,
    ...(detail || process ? { detailAvailable: true } : {}),
  };
}

function findProgressActivity(
  progress: readonly ConversationProgressData[],
  activityId: string,
): ConversationActivityData | undefined {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    const activity = progress[index]?.activities.find(
      ({ id }) => id === activityId,
    );
    if (activity) return activity;
  }
  return;
}
