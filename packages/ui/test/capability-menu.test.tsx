import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CapabilityChips,
  CapabilityMenu,
  ConnectorSetupDialog,
  MessageCapabilityReceipts,
} from "../src/capabilities.js";
import { I18nProvider } from "../src/i18n.js";

describe("CapabilityMenu", () => {
  it("groups tools and skills and renders stable built-in icons", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <CapabilityMenu
          actions={[]}
          activeIndex={0}
          loading={false}
          onSelectAction={() => undefined}
          onSelect={() => undefined}
          capabilities={[
            {
              id: "mcp:gmail",
              kind: "tool",
              name: "Gmail",
              description: "Search mail",
              icon: "gmail",
              visibility: "featured",
              status: "ready",
            },
            {
              id: "skill:documents",
              kind: "skill",
              name: "Documents",
              description: "Create documents",
              icon: "documents",
              visibility: "featured",
              status: "ready",
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(html).toContain("工具");
    expect(html).toContain("技能");
    expect(html).toContain("lucide-mail");
    expect(html).toContain("lucide-file-text");
  });

  it("uses one menu surface for files, tools, and skills", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <CapabilityMenu
          activeIndex={1}
          loading={false}
          onSelectAction={() => undefined}
          onSelect={() => undefined}
          actions={[
            {
              id: "attachment",
              name: "添加图片或文件",
              description: "选择本地文件",
              icon: "attachment",
            },
          ]}
          capabilities={[
            {
              id: "tool:plan",
              kind: "tool",
              name: "Plan",
              description: "先研究再计划",
              icon: "plan",
              visibility: "featured",
            },
            {
              id: "skill:excel",
              kind: "skill",
              name: "Excel",
              description: "创建并验证工作簿",
              icon: "excel",
              visibility: "featured",
            },
            {
              id: "skill:powerpoint",
              kind: "skill",
              name: "PowerPoint",
              description: "创建并验证演示文稿",
              icon: "powerpoint",
              visibility: "featured",
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(html).toContain('id="composer-capability-menu"');
    expect(html).toContain("lucide-paperclip");
    expect(html).toContain("lucide-list-todo");
    expect(html).toContain("lucide-table-2");
    expect(html).toContain("lucide-presentation");
    expect(html).toContain("添加");
    expect(html).toContain("工具");
    expect(html).toContain("技能");
  });

  it("renders selected and applied capability receipts, including legacy refs", () => {
    const catalog = [
      {
        id: "skill:documents",
        kind: "skill" as const,
        name: "Documents",
        description: "Create documents",
        icon: "documents",
      },
    ];
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <>
          <MessageCapabilityReceipts
            role="user"
            capabilityRefs={["skill:documents"]}
            catalog={catalog}
          />
          <MessageCapabilityReceipts
            role="assistant"
            capabilities={[
              {
                id: "skill:documents",
                kind: "skill",
                name: "Documents",
                icon: "documents",
              },
            ]}
            catalog={[]}
          />
        </>
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="本轮选择的能力"');
    expect(html).toContain("本轮选择");
    expect(html).toContain('aria-label="本轮已应用的能力"');
    expect(html).toContain("Skill 已加载");
    expect(html).toContain("lucide-check");
  });

  it("renders secure Gmail OAuth setup without echoing a client secret", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ConnectorSetupDialog
          capability={{
            id: "mcp:gmail",
            kind: "tool",
            name: "Gmail",
            description: "Search mail",
            icon: "gmail",
            status: "needs_configuration",
          }}
          status={{
            capabilityId: "mcp:gmail",
            connectorId: "gmail",
            name: "Gmail",
            status: "needs_configuration",
            configured: false,
            authorized: false,
            redirectUrl:
              "http://127.0.0.1:43119/oauth/callback/gmail",
          }}
          busy={false}
          onCancel={() => undefined}
          onConnect={() => undefined}
          onDisconnect={() => undefined}
        />
      </I18nProvider>,
    );

    expect(html).toContain("连接 Gmail");
    expect(html).toContain("OAuth Client Secret");
    expect(html).toContain('type="password"');
    expect(html).toContain(
      "http://127.0.0.1:43119/oauth/callback/gmail",
    );
  });

  it("offers connection management from a selected connector chip", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <CapabilityChips
          capabilities={[
            {
              id: "skill:gmail",
              kind: "skill",
              name: "Gmail",
              description: "Search mail",
              connectorRef: "mcp:gmail",
              status: "ready",
            },
          ]}
          disabled={false}
          onManage={() => undefined}
          onRemove={() => undefined}
        />
      </I18nProvider>,
    );

    expect(html).toContain('aria-label="管理 Gmail 连接"');
    expect(html).toContain('aria-label="移除能力 Gmail"');
    expect(html).toContain("lucide-settings");
  });

  it("renders connected Gmail management with a disconnect action", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ConnectorSetupDialog
          capability={{
            id: "mcp:gmail",
            kind: "tool",
            name: "Gmail",
            description: "Search mail",
            icon: "gmail",
            status: "ready",
          }}
          status={{
            capabilityId: "mcp:gmail",
            connectorId: "gmail",
            name: "Gmail",
            status: "ready",
            configured: true,
            authorized: true,
            redirectUrl:
              "http://127.0.0.1:43119/oauth/callback/gmail",
          }}
          busy={false}
          onCancel={() => undefined}
          onConnect={() => undefined}
          onDisconnect={() => undefined}
        />
      </I18nProvider>,
    );

    expect(html).toContain("管理 Gmail 连接");
    expect(html).toContain("断开并清除凭据");
    expect(html).toContain("从本机安全存储中清除");
    expect(html).toContain(">完成</button>");
    expect(html).not.toContain("继续授权");
  });
});
