import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  automaticDeliveryFromHistory,
  DeliveryTurnStatus,
} from "../src/delivery-turn-status.js";
import { I18nProvider } from "../src/i18n.js";
import { projectsWithDeliveryStatus } from "../src/projects.js";

describe("DeliveryTurnStatus", () => {
  it("keeps a successful delivery visible at the end of the turn", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <DeliveryTurnStatus
          delivery={{
            scope: "project-1\u0000thread-1",
            revision: "revision-1",
            status: "synced",
            result: {
              taskBranch: "threadlight/task-1",
              targetBranch: "main",
              branchChanged: false,
              files: 2,
              pendingFiles: 0,
              alreadyAppliedFiles: 2,
              conflicts: [],
              appliedFiles: 2,
              undoAvailable: true,
            },
          }}
          onOpen={vi.fn()}
          onUndo={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("已同步");
    expect(html).toContain("已同步 2 个文件到 main");
    expect(html).toContain("撤回");
    expect(html).toContain("查看交付中心");
  });

  it("surfaces conflicts as an alert with direct recovery actions", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <DeliveryTurnStatus
          delivery={{
            scope: "project-1\u0000thread-1",
            revision: "revision-2",
            status: "conflict",
            preflight: {
              taskBranch: "threadlight/task-1",
              targetBranch: "main",
              branchChanged: false,
              files: 1,
              pendingFiles: 1,
              alreadyAppliedFiles: 0,
              conflicts: [
                { path: "src/index.ts", reason: "merge_conflict" },
              ],
            },
          }}
          onOpen={vi.fn()}
          onRetry={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("存在冲突");
    expect(html).toContain("发现 1 个冲突");
    expect(html).toContain("src/index.ts");
    expect(html).toContain("重试");
  });
});

describe("automaticDeliveryFromHistory", () => {
  it("restores the latest persisted delivery state after a UI reload", () => {
    const restored = automaticDeliveryFromHistory(
      "project-1\u0000thread-1",
      {
        projectId: "project-1",
        threadId: "thread-1",
        targetBranch: "main",
        synchronizedFiles: 0,
        entries: [
          {
            id: "delivery-1",
            createdAt: "2026-08-04T08:00:00.000Z",
            revision: "revision-1",
            status: "synced",
            files: 2,
          },
          {
            id: "delivery-2",
            createdAt: "2026-08-04T08:01:00.000Z",
            revision: "revision-2",
            status: "conflict",
            taskBranch: "threadlight/task-1",
            conflicts: [
              { path: "src/index.ts", reason: "target_modified" },
            ],
          },
        ],
      },
    );

    expect(restored).toMatchObject({
      scope: "project-1\u0000thread-1",
      revision: "revision-2",
      status: "conflict",
      preflight: {
        targetBranch: "main",
        conflicts: [{ path: "src/index.ts", reason: "target_modified" }],
      },
    });
  });
});

describe("projectsWithDeliveryStatus", () => {
  it("marks a conflicted task as unread attention immediately", () => {
    const snapshot = projectsWithDeliveryStatus(
      {
        activeProjectId: "project-1",
        projects: [
          {
            id: "project-1",
            name: "Threadlight",
            basePath: "/tmp/threadlight",
            lastOpenedAt: "2026-08-04T08:00:00.000Z",
            conversations: [
              {
                id: "thread-1",
                title: "Fix delivery",
                createdAt: "2026-08-04T08:00:00.000Z",
                updatedAt: "2026-08-04T08:00:00.000Z",
                status: "completed",
              },
            ],
          },
        ],
      },
      "project-1",
      "thread-1",
      "conflict",
    );

    expect(snapshot?.projects[0].conversations[0]).toMatchObject({
      status: "attention",
      unread: true,
    });
  });
});
