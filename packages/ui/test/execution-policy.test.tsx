import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConversationAccessControl,
  ConversationAccessPopover,
  ExecutionApprovalGate,
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

describe("execution approval", () => {
  it("separates permission scope from the deny or allow decision", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ExecutionApprovalGate
          adapter={{
            subscribe: () => () => undefined,
            subscribeResolved: () => () => undefined,
            respond: vi.fn(async () => undefined),
            load: vi.fn(async () => ({
              projectId: "project-1",
              rules: {
                read: "allow",
                write: "ask",
                destructive: "deny",
              },
              permanentGrants: [],
            })),
            revoke: vi.fn(async () => ({
              projectId: "project-1",
              rules: {
                read: "allow",
                write: "ask",
                destructive: "deny",
              },
              permanentGrants: [],
            })),
          }}
          initialRequests={[
            {
              requestId: "approval-1",
              projectId: "project-1",
              projectName: "Reminders",
              threadId: "thread-1",
              runId: "run-1",
              toolName: "mcp_connect",
              permissionKey: "tool:mcp_connect",
              risk: "write",
              summary: "Run write-capable tool mcp_connect",
              external: false,
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain("仅执行当前操作");
    expect(html).toContain("本任务后续的同类操作");
    expect(html).toContain("此项目后续的同类操作");
    expect(html).toContain(
      '<div class="execution-approval-actions"><button',
    );
    expect(html).toContain(">拒绝</button>");
    expect(html).toContain(">允许</button>");
  });
});
