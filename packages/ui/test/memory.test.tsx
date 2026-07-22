import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MemoryDocument } from "../src/memory.js";

describe("MemoryDocument", () => {
  it("shows the actual memory path and a rendered Markdown preview", () => {
    const html = renderToStaticMarkup(
      <MemoryDocument
        snapshot={{
          path: ".threadlight/MEMORY.md",
          revision: "revision-1",
          content: "# Project memory\n\n- Use cursor pagination.\n",
        }}
        refreshing={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain(".threadlight/MEMORY.md");
    expect(html).toContain("Project memory");
    expect(html).toContain("Use cursor pagination.");
    expect(html).toContain('aria-label="重新读取记忆文件"');
    expect(html).toContain('aria-selected="true"');
  });
});
