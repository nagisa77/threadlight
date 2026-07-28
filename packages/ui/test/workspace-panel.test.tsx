import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildChangeTree,
  FileSource,
  isPlanDocumentPath,
  PlanDocument,
  ReviewChangesTree,
  ReviewView,
  reviewDiffStylesForLayout,
  WorkspacePanel,
  type WorkspaceAdapter,
} from "../src/workspace-panel.js";
import type { TerminalAdapter } from "../src/terminal.js";

describe("ReviewView", () => {
  it("shows task-scoped changes with unified/split and file controls", () => {
    const html = renderToStaticMarkup(
      <ReviewView
        changes={{
          threadId: "thread-1",
          additions: 2,
          deletions: 1,
          revision: "revision-1",
          files: [
            {
              path: "src/index.ts",
              status: "modified",
              additions: 2,
              deletions: 1,
              binary: false,
              oldContent: "export const value = 1;\n",
              newContent: "export const value = 2;\nexport const next = true;\n",
            },
          ],
        }}
        loading={false}
        layout="unified"
        onLayoutChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("本次对话");
    expect(html).toContain("src/index.ts");
    expect(html).toContain('aria-label="单边 Diff"');
    expect(html).toContain('aria-label="双边 Diff"');
    expect(html).toContain('aria-label="显示变更文件树"');
    expect(html).not.toContain('aria-label="新建文件标签"');
    expect(html).toContain("+2");
    expect(html).toContain("-1");
  });

  it("uses narrower line-number gutters only in the unified layout", () => {
    expect(reviewDiffStylesForLayout("unified")).toMatchObject({
      lineNumber: { minWidth: "32px" },
    });
    expect(reviewDiffStylesForLayout("split")).toMatchObject({
      lineNumber: { minWidth: "44px" },
    });
  });

  it("builds a changed-files-only tree with added, modified, and deleted states", () => {
    const files = [
      change("apps/desktop/src/main/index.ts", "modified"),
      change("apps/desktop/src/preload/new.ts", "added"),
      change("packages/ui/src/old.ts", "deleted"),
    ] as const;
    const tree = buildChangeTree(files);
    const html = renderToStaticMarkup(
      <ReviewChangesTree
        files={files}
        selectedPath="apps/desktop/src/main/index.ts"
        onSelectFile={vi.fn()}
      />,
    );

    expect(tree.map((node) => node.name)).toEqual(["apps", "packages"]);
    expect(html).toContain('aria-label="变更文件树"');
    expect(html).toContain("apps");
    expect(html).toContain("index.ts");
    expect(html).toContain('aria-label="新增"');
    expect(html).toContain('aria-label="修改"');
    expect(html).toContain('aria-label="删除"');
  });

  it("renders only one diff when a change set is large", () => {
    const files = Array.from({ length: 51 }, (_, index) => ({
      ...change(`generated/file-${index}.ts`, "added"),
      newContent: `export const value = ${index};\n`,
    }));
    const html = renderToStaticMarkup(
      <ReviewView
        changes={{
          threadId: "thread-1",
          additions: 51,
          deletions: 0,
          revision: "revision-1",
          files,
        }}
        loading={false}
        layout="unified"
        onLayoutChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("共 51 个变更文件");
    expect(html.match(/class="review-file"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="变更文件树"');
  });
});

describe("FileSource", () => {
  it("renders generated plan files as readable Markdown documents", () => {
    const html = renderToStaticMarkup(
      <PlanDocument
        content={[
          "# Plan",
          "",
          "Progress: 1 / 2",
          "",
          "- [x] Inspect",
          "- [ ] Implement — In progress",
        ].join("\n")}
      />,
    );

    expect(isPlanDocumentPath(".threadlight/plans/thread-1.md")).toBe(
      true,
    );
    expect(isPlanDocumentPath("docs/plan.md")).toBe(false);
    expect(html).toContain('class="plan-document"');
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain(
      'type="checkbox" disabled="" checked=""',
    );
  });

  it("renders stable one-based line numbers including a trailing blank line", () => {
    const html = renderToStaticMarkup(
      <FileSource name="LATEST.md" content={"# Latest\nDraft\n"} />,
    );

    expect(html).toContain('aria-label="LATEST.md 源代码"');
    expect(html.match(/file-source-line-number/g)).toHaveLength(3);
    expect(html).toContain(">1</span>");
    expect(html).toContain(">3</span>");
  });

  it("syntax-highlights supported source files", () => {
    const html = renderToStaticMarkup(
      <FileSource
        name="example.ts"
        content={'export const answer: number = 42;\n'}
      />,
    );

    expect(html).toContain("token keyword");
    expect(html).toContain("token number");
  });

  it("marks a requested source line for direct file-link previews", () => {
    const html = renderToStaticMarkup(
      <FileSource
        name="example.ts"
        content={"const first = 1;\nconst second = 2;\n"}
        line={2}
        revealRequest={1}
      />,
    );

    expect(html).toContain('class="file-source-line target" data-line="2"');
    expect(html).toContain(">2</span>");
  });
});

describe("WorkspacePanel", () => {
  it("defaults to a file tab and offers file or terminal views from add", () => {
    const adapter: WorkspaceAdapter = {
      getChanges: vi.fn(),
      list: vi.fn(async () => []),
      read: vi.fn(),
    };
    const terminal: TerminalAdapter = {
      create: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };

    const html = renderToStaticMarkup(
      <WorkspacePanel
        adapter={adapter}
        terminal={terminal}
        projectId="project-1"
        projectName="threadlight"
        changesLoading={false}
        reviewRequest={0}
        hidden={false}
        onResizeStart={vi.fn()}
        onResizeBy={vi.fn()}
        onResetSize={vi.fn()}
        onRefreshChanges={vi.fn()}
        toolbarActions={<button type="button">Global action</button>}
      />,
    );

    expect(html).toContain('aria-label="右侧面板"');
    expect(html).toContain("打开文件");
    expect(html).toContain('aria-label="新建面板标签"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain(">终端</span>");
    expect(html).toContain(">文件</span>");
    expect(html).toContain('aria-label="调整聊天与右侧面板宽度"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="文件路径"');
    expect(html).toContain('aria-label="隐藏文件树"');
    expect(html).toContain("threadlight");
    expect(html.indexOf('class="workspace-tab-strip"')).toBeLessThan(
      html.indexOf('class="panel-add-menu"'),
    );
    expect(html.indexOf('class="panel-add-menu"')).toBeLessThan(
      html.indexOf('class="workspace-panel-actions"'),
    );
  });
});

function change(
  path: string,
  status: "added" | "modified" | "deleted",
) {
  return {
    path,
    status,
    additions: status === "deleted" ? 0 : 1,
    deletions: status === "added" ? 0 : 1,
    binary: false,
    oldContent: status === "added" ? undefined : "before\n",
    newContent: status === "deleted" ? undefined : "after\n",
  };
}
