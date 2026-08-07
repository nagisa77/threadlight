import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MissingThreadRecovery } from "../src/features/task-session/conversation-content.js";
import { DeleteConversationDialog } from "../src/features/navigation/project-dialogs.js";

describe("missing task recovery", () => {
  it("offers explicit repair, relink, and metadata-only removal actions", () => {
    const html = renderToStaticMarkup(
      <MissingThreadRecovery
        threadId="missing-thread"
        busy={false}
        onRepair={vi.fn()}
        onRelink={vi.fn()}
        onDeleteMetadata={vi.fn()}
      />,
    );

    expect(html).toContain("任务运行数据缺失");
    expect(html).toContain("missing-thread");
    expect(html).toContain("修复并创建替代任务");
    expect(html).toContain("重新关联");
    expect(html).toContain("删除元数据");
  });

  it("states that metadata removal preserves local task data", () => {
    const html = renderToStaticMarkup(
      <DeleteConversationDialog
        conversation={{
          id: "missing-thread",
          title: "旧任务",
          createdAt: "2026-08-07T00:00:00.000Z",
          updatedAt: "2026-08-07T00:00:00.000Z",
        }}
        metadataOnly
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain("从侧边栏移除此任务");
    expect(html).toContain("不会删除本地会话文件或工作区");
  });
});
