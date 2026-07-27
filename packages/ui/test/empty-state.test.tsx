import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "../src/app.js";

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
});
