import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EmptyState,
  NewTaskProjectPrompt,
  ProjectPickerPopover,
  filterProjectsForPicker,
} from "../src/app.js";
import type { ProjectSummary } from "../src/projects.js";

const projects: readonly ProjectSummary[] = [
  {
    id: "threadlight",
    name: "threadlight",
    basePath: "/Users/tim/Desktop/threadlight",
    lastOpenedAt: "2026-07-30T10:00:00.000Z",
    conversations: [],
  },
  {
    id: "remote",
    name: "Compute Lab",
    basePath: "/workspace/model",
    lastOpenedAt: "2026-07-30T09:00:00.000Z",
    conversations: [],
    runtime: {
      kind: "remote",
      endpoint: "https://runtime.example.test",
      workspacePath: "/workspace/model",
      runtimeId: "runtime-1",
    },
  },
];

describe("empty state", () => {
  it("renders the three AI-provided questions instead of static defaults", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        connecting={false}
        suggestions={[
          "当前最需要梳理的模块边界是什么？",
          "哪些失败场景还缺少测试覆盖？",
          "哪个功能最适合作为下一步迭代？",
        ]}
        suggestionsLoading={false}
        suggestionsFailed={false}
        onRetrySuggestions={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("当前最需要梳理的模块边界是什么？");
    expect(html).toContain("哪些失败场景还缺少测试覆盖？");
    expect(html).toContain("哪个功能最适合作为下一步迭代？");
    expect(html).not.toContain("解释这个代码库的架构");
    expect(html).not.toContain("运行测试并修复失败");
    expect(html).not.toContain("帮我规划下一个功能");
  });

  it("keeps the three-row layout while AI suggestions are loading", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        connecting={false}
        suggestions={[]}
        suggestionsLoading
        suggestionsFailed={false}
        onRetrySuggestions={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html.match(/suggestion-placeholder/g)).toHaveLength(3);
    expect(html).toContain("AI 正在生成项目问题推荐");
  });

  it("replaces the two-line empty copy with an inline project prompt", () => {
    const html = renderToStaticMarkup(
      <NewTaskProjectPrompt
        project={projects[0]!}
        projects={projects}
        onSelectProject={vi.fn()}
      />,
    );

    expect(html).toContain("接下来要在");
    expect(html).toContain("threadlight");
    expect(html).toContain("中构建什么？");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("描述目标，Threadlight");
  });

  it("searches projects by name and runtime path", () => {
    expect(filterProjectsForPicker(projects, "compute")).toEqual([
      projects[1],
    ]);
    expect(filterProjectsForPicker(projects, "WORKSPACE/MODEL")).toEqual([
      projects[1],
    ]);
    expect(filterProjectsForPicker(projects, "missing")).toEqual([]);
  });

  it("renders the generic searchable project popover with current selection", () => {
    const html = renderToStaticMarkup(
      <ProjectPickerPopover
        projects={projects}
        currentProjectId="threadlight"
        query="thread"
        position={{
          top: 80,
          left: 20,
          transformOrigin: "top right",
        }}
        onQueryChange={vi.fn()}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('class="action-popover project-picker-popover"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('placeholder="搜索项目"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("threadlight");
    expect(html).not.toContain("Compute Lab");
  });

  it("adds new-project and standalone actions below the project list", () => {
    const html = renderToStaticMarkup(
      <ProjectPickerPopover
        projects={projects}
        currentProjectId="threadlight"
        query=""
        position={{ top: 80, left: 20, transformOrigin: "top left" }}
        onQueryChange={vi.fn()}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onOpenProject={vi.fn()}
        onCreateStandalone={vi.fn()}
      />,
    );

    expect(html).toContain("新建项目");
    expect(html).toContain("不在项目中");
    expect(html).toContain('class="project-picker-actions"');
  });

  it("does not expose the standalone storage container as a project", () => {
    const standalone: ProjectSummary = {
      id: "standalone",
      name: "Standalone",
      basePath: "/Users/tim/.threadlight/standalone",
      scope: "standalone",
      lastOpenedAt: "2026-07-31T10:00:00.000Z",
      conversations: [],
    };

    expect(filterProjectsForPicker([...projects, standalone], "")).toEqual(
      projects,
    );
  });
});
