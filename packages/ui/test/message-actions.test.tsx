import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageActions, writeClipboardText } from "../src/app.js";

describe("message actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets users copy answers without offering to rewrite them", () => {
    const html = renderToStaticMarkup(
      <MessageActions role="assistant" text="最终答案" />,
    );

    expect(html).toContain('aria-label="复制文字"');
    expect(html).not.toContain("重写提问");
  });

  it("lets users copy and rewrite their questions", () => {
    const html = renderToStaticMarkup(
      <MessageActions role="user" text="原始提问" onRewrite={vi.fn()} />,
    );

    expect(html).toContain('aria-label="复制文字"');
    expect(html).toContain('aria-label="重写提问"');
  });

  it("lets users bookmark important messages with persistent pressed state", () => {
    const html = renderToStaticMarkup(
      <MessageActions
        role="assistant"
        text="Important result"
        bookmarked
        onToggleBookmark={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="移除书签"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("message-action bookmark pressable active");
  });

  it("writes the complete message text to the system clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await writeClipboardText("保留 **Markdown** 和换行\n第二行");

    expect(writeText).toHaveBeenCalledWith("保留 **Markdown** 和换行\n第二行");
  });

  it("uses the desktop clipboard when the browser API is unavailable", async () => {
    const desktopWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {});

    await writeClipboardText("桌面端复制", desktopWriteText);

    expect(desktopWriteText).toHaveBeenCalledWith("桌面端复制");
  });

  it("falls back when an exposed clipboard API rejects the write", async () => {
    const desktopWriteText = vi.fn().mockRejectedValue(new Error("denied"));
    const browserWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: browserWriteText } });

    await writeClipboardText("降级复制", desktopWriteText);

    expect(desktopWriteText).toHaveBeenCalledWith("降级复制");
    expect(browserWriteText).toHaveBeenCalledWith("降级复制");
  });
});
