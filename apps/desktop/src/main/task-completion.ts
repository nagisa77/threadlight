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

export function deliveryAttentionTitle(
  language: DesktopLanguage,
  status: "conflict" | "failed",
): string {
  const copy = (() => {
    switch (language) {
      case "zh-CN":
        return { conflict: "自动同步有冲突", failed: "自动同步失败" };
      case "zh-TW":
        return { conflict: "自動同步發生衝突", failed: "自動同步失敗" };
      case "ja":
        return {
          conflict: "自動同期に競合があります",
          failed: "自動同期に失敗しました",
        };
      case "ko":
        return { conflict: "자동 동기화 충돌", failed: "자동 동기화 실패" };
      case "en":
        return {
          conflict: "Automatic sync conflict",
          failed: "Automatic sync failed",
        };
    }
  })();
  return copy[status];
}

export function deliveryAttentionBody(task: string, error?: string): string {
  const detail = error?.trim();
  if (!detail) return task;
  return `${task} · ${detail.length > 180 ? `${detail.slice(0, 177)}…` : detail}`;
}
