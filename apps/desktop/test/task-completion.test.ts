import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { AppServer } from "@threadlight/app-server";
import type { JsonRpcOutgoing } from "@threadlight/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  completedTaskTarget,
  deliveryAttentionBody,
  deliveryAttentionTitle,
  handleTaskCompletion,
  type TaskCompletionNotification,
} from "../src/main/task-completion.js";

describe("task completion notifications", () => {
  it("builds localized delivery attention notifications with bounded detail", () => {
    expect(deliveryAttentionTitle("zh-CN", "conflict")).toBe(
      "自动同步有冲突",
    );
    expect(deliveryAttentionTitle("en", "failed")).toBe(
      "Automatic sync failed",
    );
    expect(deliveryAttentionBody("同步任务", "target changed")).toBe(
      "同步任务 · target changed",
    );
    expect(deliveryAttentionBody("同步任务", "x".repeat(220))).toHaveLength(
      "同步任务 · ".length + 178,
    );
  });

  it("projects completed and failed turns to a persistent task target", () => {
    expect(
      completedTaskTarget("project-1", {
        jsonrpc: "2.0",
        method: "turn/failed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          error: "fixture failure",
        },
      }),
    ).toEqual({ projectId: "project-1", id: "thread-1" });
    expect(
      completedTaskTarget("project-1", {
        jsonrpc: "2.0",
        method: "turn/started",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          mode: "default",
        },
      }),
    ).toBeUndefined();
  });

  it("marks a task unread and emits a localized desktop notification for a scripted model completion", async () => {
    const provider: ModelProvider = {
      generate: async () => ({
        text: "The requested work is complete.",
        toolCalls: [],
      }),
    };
    const notifications: TaskCompletionNotification[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const markUnread = vi.fn(() => ({
      activeProjectId: "project-1",
      projects: [
        {
          id: "project-1",
          name: "Threadlight",
          basePath: "/workspace/threadlight",
          lastOpenedAt: "2026-07-29T00:00:00.000Z",
          conversations: [
            {
              id: threadId,
              title: "完成通知系统",
              createdAt: "2026-07-29T00:00:00.000Z",
              updatedAt: "2026-07-29T00:00:00.000Z",
              unread: true,
            },
          ],
        },
      ],
    }));
    const completed = Promise.withResolvers<void>();
    let threadId = "";
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Complete the task.",
      }),
      send(message: JsonRpcOutgoing) {
        messages.push(message);
        const notification = handleTaskCompletion("project-1", message, {
          language: "zh-CN",
          markUnread,
          notify: (value) => notifications.push(value),
        });
        if (notification) completed.resolve();
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "Finish notifications" },
    });
    await completed.promise;

    expect(markUnread).toHaveBeenCalledWith({
      projectId: "project-1",
      id: threadId,
    });
    expect(notifications).toEqual([
      {
        projectId: "project-1",
        threadId,
        title: "任务已完成",
        body: "完成通知系统",
      },
    ]);
  });
});
