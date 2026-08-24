import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  BrowserView,
  browserKeyProducesText,
  browserKeyRequestsPaste,
  type BrowserAdapter,
} from "../src/browser.js";
import { I18nProvider } from "../src/i18n.js";
import { PanelAddMenu } from "../src/panel-add-menu.js";
import { readUiStyles } from "./style-source.js";

const adapter: BrowserAdapter = {
  create: vi.fn(async () => ({
    id: "browser-1",
    url: "about:blank",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  })),
  command: vi.fn(),
  close: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => undefined),
};

describe("BrowserView", () => {
  it("renders the real remote-Chrome toolbar and concise new-tab state", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <BrowserView
          adapter={adapter}
          projectId="project-1"
          hidden={false}
          label="新建浏览器标签"
        />
      </I18nProvider>,
    );

    expect(html).toContain('class="browser-toolbar"');
    expect(html).toContain('aria-label="后退"');
    expect(html).toContain('aria-label="前进"');
    expect(html).toContain('aria-label="地址栏"');
    expect(html).toContain("输入 URL 或搜索内容");
    expect(html).toContain("正在目标 Host 上启动无头 Chrome");
    expect(html).toContain("页面由目标 Threadlight Host 上的 Chrome 打开");
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("webview");
  });

  it("offers Browser beside files and terminals in the panel add menu", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="en">
        <PanelAddMenu
          available={["terminal", "browser", "file"]}
          onSelect={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(html).toContain("Browser");
    expect(html).toContain("File");
    expect(html).toContain("Task terminal");
  });

  it("centers browser status overlays in the canvas grid area", () => {
    expect(readUiStyles()).toMatch(
      /\.browser-empty-state,\s*\.browser-error-state\s*\{[^}]*grid-area:\s*1\s*\/\s*1;/s,
    );
  });

  it("lets text-producing keys reach the hidden input", () => {
    const key = {
      altKey: false,
      ctrlKey: false,
      key: "a",
      metaKey: false,
      getModifierState: () => false,
    };

    expect(browserKeyProducesText(key, "down")).toBe(true);
    expect(browserKeyProducesText({ ...key, key: " " }, "down")).toBe(true);
    expect(browserKeyProducesText({ ...key, key: "Enter" }, "down")).toBe(
      false,
    );
    expect(browserKeyProducesText({ ...key, ctrlKey: true }, "down")).toBe(
      false,
    );
    expect(browserKeyProducesText(key, "up")).toBe(false);
  });

  it("supports AltGraph, dead keys, and local paste shortcuts", () => {
    const key = {
      altKey: true,
      ctrlKey: true,
      key: "@",
      metaKey: false,
      getModifierState: (modifier: string) => modifier === "AltGraph",
    };

    expect(browserKeyProducesText(key, "down")).toBe(true);
    expect(
      browserKeyProducesText(
        {
          ...key,
          altKey: false,
          ctrlKey: false,
          key: "Dead",
          getModifierState: () => false,
        },
        "down",
      ),
    ).toBe(true);
    expect(
      browserKeyRequestsPaste(
        { ctrlKey: true, key: "v", metaKey: false, shiftKey: false },
        "down",
      ),
    ).toBe(true);
    expect(
      browserKeyRequestsPaste(
        { ctrlKey: false, key: "Insert", metaKey: false, shiftKey: true },
        "down",
      ),
    ).toBe(true);
  });
});
