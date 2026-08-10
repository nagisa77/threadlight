import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import { composerProviderIsReady, firstRunIsComplete } from "../src/app.js";
import {
  FirstRunGuide,
  firstRunInitialStep,
  firstRunSettingsUpdate,
} from "../src/first-run.js";
import {
  providerIsConfigured,
  type SettingsSnapshot,
} from "../src/settings.js";

const settings: SettingsSnapshot = {
  language: "zh-CN",
  theme: "system",
  preferredProjectOpener: "",
  provider: "openai",
  openAIApiKeyConfigured: false,
  deepSeekApiKeyConfigured: false,
  qwenApiKeyConfigured: false,
  kimiApiKeyConfigured: false,
  doubaoApiKeyConfigured: false,
  geminiApiKeyConfigured: false,
  grokApiKeyConfigured: false,
  customApiKeyConfigured: false,
  searchApiKeyConfigured: false,
  qwenBaseUrl: "https://dashscope.example/v1",
  kimiBaseUrl: "https://kimi.example/v1",
  doubaoBaseUrl: "https://doubao.example/v1",
  geminiBaseUrl: "https://gemini.example/v1",
  grokBaseUrl: "https://grok.example/v1",
  customBaseUrl: "http://localhost:11434/v1",
  customModel: "llama3.2",
  model: "gpt-5.6-sol",
};

describe("first run", () => {
  it("starts with Provider Key and renders the five-step success path", () => {
    expect(firstRunInitialStep(settings)).toBe("provider");
    const html = renderToStaticMarkup(
      <FirstRunGuide
        adapter={{
          load: vi.fn(),
          save: vi.fn(),
          testProvider: vi.fn(),
        }}
        settings={settings}
        connectionReady={false}
        onSettingsSaved={vi.fn()}
        onRuntimeRestart={vi.fn()}
        onOpenProject={vi.fn()}
        onRunDemo={vi.fn()}
      />,
    );

    expect(html).toContain("让第一次任务顺利完成");
    expect(html).toContain("基础设置");
    expect(html).toContain("连接测试");
    expect(html).toContain("打开项目");
    expect(html).toContain("权限");
    expect(html).toContain("首次任务");
    expect(html).toContain("简体中文");
    expect(html).toContain("浅色");
    expect(html).toContain('type="password"');
    expect(html).toContain('disabled=""');
  });

  it("preserves settings and writes only the selected Provider key", () => {
    expect(
      firstRunSettingsUpdate(
        settings,
        "deepseek",
        "deepseek-v4-pro",
        "  ds-secret  ",
      ),
    ).toMatchObject({
      language: "zh-CN",
      theme: "system",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      deepSeekApiKey: "ds-secret",
      customBaseUrl: "http://localhost:11434/v1",
    });
  });

  it("presents connection testing as a compact three-part preflight", () => {
    const html = renderToStaticMarkup(
      <FirstRunGuide
        adapter={{
          load: vi.fn(),
          save: vi.fn(),
          testProvider: vi.fn(),
        }}
        settings={{ ...settings, openAIApiKeyConfigured: true }}
        connectionReady={false}
        initialStep="test"
        onSettingsSaved={vi.fn()}
        onRuntimeRestart={vi.fn()}
        onOpenProject={vi.fn()}
        onRunDemo={vi.fn()}
      />,
    );

    expect(html).toContain("等待测试");
    expect(html).toContain("身份验证");
    expect(html).toContain("API 端点");
    expect(html).toContain("模型可用性");
    expect(html).not.toContain("Threadlight Host</span>");
  });

  it("uses text fields for a custom endpoint and model while saving interface preferences", () => {
    const customSettings = {
      ...settings,
      provider: "custom" as const,
      model: "local-coder",
      customModel: "local-coder",
    };
    const html = renderToStaticMarkup(
      <FirstRunGuide
        adapter={{
          load: vi.fn(),
          save: vi.fn(),
          testProvider: vi.fn(),
        }}
        settings={customSettings}
        connectionReady={false}
        initialStep="provider"
        onSettingsSaved={vi.fn()}
        onRuntimeRestart={vi.fn()}
        onOpenProject={vi.fn()}
        onRunDemo={vi.fn()}
      />,
    );

    expect(html).toContain('id="first-run-base-url"');
    expect(html).toMatch(
      /id="first-run-model" type="text"[^>]*value="local-coder"/,
    );
    expect(
      firstRunSettingsUpdate(
        customSettings,
        "custom",
        " new-model ",
        "",
        " https://models.example/v1 ",
        "en",
        "dark",
      ),
    ).toMatchObject({
      provider: "custom",
      model: "new-model",
      customModel: "new-model",
      customBaseUrl: "https://models.example/v1",
      language: "en",
      theme: "dark",
    });
  });

  it("offers a secondary path that continues without opening a project", () => {
    const html = renderToStaticMarkup(
      <FirstRunGuide
        adapter={{
          load: vi.fn(),
          save: vi.fn(),
          testProvider: vi.fn(),
        }}
        settings={{ ...settings, openAIApiKeyConfigured: true }}
        connectionReady={true}
        initialStep="project"
        onSettingsSaved={vi.fn()}
        onRuntimeRestart={vi.fn()}
        onOpenProject={vi.fn()}
        onRunDemo={vi.fn()}
      />,
    );

    expect(html).toContain("暂不打开项目");
    expect(html).toMatch(
      /<button[^>]*class="first-run-secondary[^>]*>暂不打开，继续<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*class="first-run-primary[^>]*>打开一个项目<\/button>/,
    );
  });

  it("defaults to approval mode and waits for the runtime before the demo", () => {
    const configured = { ...settings, openAIApiKeyConfigured: true };
    const project = {
      id: "project-1",
      name: "threadlight",
      basePath: "/workspace/threadlight",
      lastOpenedAt: new Date(0).toISOString(),
      conversations: [],
    };
    const adapter = {
      load: vi.fn(),
      save: vi.fn(),
      testProvider: vi.fn(),
    };
    const permissionHtml = renderToStaticMarkup(
      <FirstRunGuide
        adapter={adapter}
        settings={configured}
        project={project}
        connectionReady={false}
        initialStep="permissions"
        onSettingsSaved={vi.fn()}
        onRuntimeRestart={vi.fn()}
        onOpenProject={vi.fn()}
        onRunDemo={vi.fn()}
      />,
    );
    expect(permissionHtml).toContain("审批模式（推荐）");
    expect(permissionHtml).toContain('checked="" value="approval"');

    const demoHtml = renderToStaticMarkup(
      <FirstRunGuide
        adapter={adapter}
        settings={configured}
        project={project}
        connectionReady={false}
        initialStep="demo"
        onSettingsSaved={vi.fn()}
        onRuntimeRestart={vi.fn()}
        onOpenProject={vi.fn()}
        onRunDemo={vi.fn()}
      />,
    );
    expect(demoHtml).toContain("正在等待运行时");
    expect(demoHtml).toMatch(/<button[^>]*disabled=""[^>]*>.*正在等待运行时/s);
    expect(demoHtml).toContain("检查连接设置");
  });

  it("recognizes configured cloud and keyless custom providers", () => {
    expect(
      providerIsConfigured({ ...settings, openAIApiKeyConfigured: true }),
    ).toBe(true);
    expect(providerIsConfigured({ ...settings, provider: "custom" })).toBe(
      true,
    );
    expect(firstRunIsComplete("true")).toBe(true);
    expect(firstRunIsComplete(null)).toBe(false);
    expect(composerProviderIsReady(true, settings)).toBe(false);
    expect(
      composerProviderIsReady(true, {
        ...settings,
        openAIApiKeyConfigured: true,
      }),
    ).toBe(true);
    expect(composerProviderIsReady(false)).toBe(true);
  });

  it("runs the multi-agent demo through an offline scripted model provider", async () => {
    const requests: string[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request.input);
        return {
          text: "两个子 Agent 已并行完成脑暴；主 Agent 汇总了核心功能、易用性风险和 MVP 方案。",
          toolCalls: [],
        };
      },
    };
    const prompt =
      "请启动 2 个子 Agent 并行完成一个番茄钟产品脑暴：一个提出 3 个能帮助用户专注的核心功能，另一个从新手易用性角度指出 3 个风险；主 Agent 去重并汇总成不超过 8 行的 MVP 方案。";
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "first-run-demo",
        instructions: "Do not call tools.",
        tools: [],
      }),
      prompt,
    );

    expect(requests).toEqual([prompt]);
    expect(result.output).toContain("两个子 Agent");
  });
});
