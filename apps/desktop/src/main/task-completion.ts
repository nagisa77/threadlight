import type { JsonRpcOutgoing } from "@threadlight/protocol";

import type {
  DesktopConversationTarget,
  DesktopLanguage,
  DesktopProjectsSnapshot,
} from "../shared/desktop-api.js";

export interface TaskCompletionNotification {
  projectId: string;
  threadId: string;
  title: string;
  body: string;
}

export interface TaskCompletionDependencies {
  language: DesktopLanguage;
  markUnread(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot;
  notify(notification: TaskCompletionNotification): void;
}

export function completedTaskTarget(
  projectId: string,
  message: JsonRpcOutgoing,
): DesktopConversationTarget | undefined {
  if (
    !("method" in message) ||
    (message.method !== "turn/completed" &&
      message.method !== "turn/failed") ||
    !message.params ||
    typeof message.params !== "object" ||
    Array.isArray(message.params)
  ) {
    return;
  }
  const threadId = (message.params as Record<string, unknown>).threadId;
  return typeof threadId === "string"
    ? { projectId, id: threadId }
    : undefined;
}

export function handleTaskCompletion(
  projectId: string,
  message: JsonRpcOutgoing,
  dependencies: TaskCompletionDependencies,
): TaskCompletionNotification | undefined {
  if (
    !("method" in message) ||
    message.method !== "turn/completed" ||
    !message.params ||
    typeof message.params !== "object" ||
    Array.isArray(message.params)
  ) {
    return;
  }

  const threadId = (message.params as Record<string, unknown>).threadId;
  if (typeof threadId !== "string") return;
  const snapshot = dependencies.markUnread({ projectId, id: threadId });
  const project = snapshot.projects.find(
    (candidate) => candidate.id === projectId,
  );
  const conversation = project?.conversations.find(
    (candidate) => candidate.id === threadId,
  );
  const title = completionTitle(dependencies.language);
  const notification = {
    projectId,
    threadId,
    title,
    body: conversation?.title ?? title,
  };
  dependencies.notify(notification);
  return notification;
}

export function completionTitle(language: DesktopLanguage): string {
  switch (language) {
    case "zh-CN":
      return "任务已完成";
    case "zh-TW":
      return "工作已完成";
    case "ja":
      return "タスクが完了しました";
    case "ko":
      return "작업 완료";
    case "en":
      return "Task completed";
  }
}
