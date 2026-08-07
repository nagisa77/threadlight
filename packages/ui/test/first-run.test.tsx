import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import {
  composerProviderIsReady,
  firstRunIsComplete,
} from "../src/app.js";
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
    expect(html).toContain("Provider Key");
    expect(html).toContain("连接测试");
    expect(html).toContain("打开项目");
    expect(html).toContain("权限");
    expect(html).toContain("首次任务");
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
    expect(
      providerIsConfigured({ ...settings, provider: "custom" }),
    ).toBe(true);
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

  it("runs the read-only demo prompt through an offline scripted model provider", async () => {
    const requests: string[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request.input);
        return {
          text: "项目包含 packages 和 apps；可运行 npm test。下一步建议补充 README。",
          toolCalls: [],
        };
      },
    };
    const prompt =
      "只读检查这个项目，不要修改文件。概括项目结构、如何运行，并建议一个适合作为下一步的小改进。";
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "first-run-demo",
        instructions: "Read only. Do not call tools or modify files.",
        tools: [],
      }),
      prompt,
    );

    expect(requests).toEqual([prompt]);
    expect(result.output).toContain("npm test");
  });
});
