import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConversationAccessControl,
  ConversationAccessPopover,
} from "../src/execution-policy.js";
import { I18nProvider } from "../src/i18n.js";

describe("conversation access", () => {
  it("shows the current conversation access mode beside the composer", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ConversationAccessControl
          mode="full"
          onChange={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain("完全访问");
    expect(html).toContain("conversation-access-trigger pressable full");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("offers only approval and full-access modes in the shared popover", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ConversationAccessPopover
          mode="approval"
          position={{
            top: 80,
            left: 20,
            transformOrigin: "bottom left",
          }}
          onClose={vi.fn()}
          onSelect={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain(
      'class="action-popover conversation-access-popover"',
    );
    expect(html).toContain("请求审批");
    expect(html).toContain("写入和外部访问前询问");
    expect(html).toContain("完全访问");
    expect(html).toContain("当前对话绕过安全执行");
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });
});
