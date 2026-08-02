<div align="center">
  <img src="./apps/desktop/resources/app-icon.svg" width="104" height="104" alt="Threadlight logo" />

  <h1>Threadlight</h1>

  <p><strong>让本地 Agent 的每一步，都清晰可见。</strong></p>
  <p>
    一个面向真实工程工作的开源 Agent Runtime 与桌面客户端。<br />
    将模型推理、工具调用、终端、代码审阅、项目记忆与 Computer Use<br />
    组织成一条可观察、可恢复、可扩展的执行链路。
  </p>

  <p>
    <a href="./README.md">简体中文</a>
    ·
    <a href="./README.en.md">English</a>
    ·
    <a href="./docs/DEVELOPMENT.zh-CN.md">开发文档</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/status-alpha-D56A3A?style=flat-square" alt="Alpha status" />
    <a href="https://github.com/nagisa77/threadlight/releases/latest"><img src="https://img.shields.io/github/v/release/nagisa77/threadlight?include_prereleases&style=flat-square" alt="Latest release" /></a>
    <a href="https://github.com/nagisa77/threadlight/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/nagisa77/threadlight/ci.yml?branch=main&style=flat-square&label=tests" alt="CI status" /></a>
    <img src="https://img.shields.io/github/license/nagisa77/threadlight?style=flat-square" alt="Apache-2.0 license" />
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A522-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22 or newer" />
    <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 7" />
    <img src="https://img.shields.io/badge/Electron-desktop-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron desktop" />
  </p>
</div>

<br />

<p align="center">
  <img src="./docs/images/threadlight-agent-review.png" width="100%" alt="Threadlight 中可观察的 Agent 执行记录与并排代码审阅" />
</p>

<p align="center">
  <sub>模型思考、工具执行、文件变更与 Diff 审阅，都在同一个工作空间里。</sub>
</p>

---

Threadlight 不只是一个聊天界面，也不把 Agent 简化成一次模型请求。

一个真实任务往往会经历多轮模型调用、流式输出、工具执行、后台进程、文件修改与中断恢复。Threadlight 把这些过程完整地呈现出来，同时在工具回合之间保留模型的 opaque state，让推理连续性和调用链路不因一次工具执行而丢失。

> [!IMPORTANT]
> Threadlight 目前处于 **Alpha** 阶段，适合本地开发、架构探索和 Agent 应用原型。内置工具以当前用户权限运行，不提供操作系统级 sandbox；请只在可信工作区中使用。

## 为什么是 Threadlight

| | 能力 | Threadlight 的实现 |
| --- | --- | --- |
| **01** | **执行过程可观察** | Thread、Turn、模型增量、工具调用、命令输出、文件变更与 token usage 都以结构化事件呈现。 |
| **02** | **真正面向本地工程** | 项目、任务、附件、终端、文件审阅与长期记忆围绕工作区组织，不依赖远端业务数据库。 |
| **03** | **Provider 中立** | 核心循环不依赖厂商 SDK；OpenAI Responses、DeepSeek 与千问兼容协议由独立 adapter 接入。 |
| **04** | **状态连续且可恢复** | 工具回合内保留 opaque model state；任务可以持久化、恢复、中断，并在写盘前进行尺寸限制与脱敏。 |
| **05** | **能力边界清晰** | Agent Loop、provider adapter、app-server、protocol、client 与 UI 各司其职，可单独复用和扩展。 |
| **06** | **离线可验证** | 新行为使用 scripted model provider 测试，无需真实 API 或网络即可复现多轮工具链路。 |

## 桌面端，不只是聊天框

### 在任务里直接审阅工作成果

执行记录与最终回答保持在主对话中，文件树、源码、会话变更和 Diff 可以在右侧面板并排打开；底部面板则可承载一个或多个终端或文件标签。Git 项目中的新任务默认运行在独立 worktree，非 Git 项目则直接写入所选文件夹；Diff 面板支持按文件或全部恢复，并在恢复前检查新的工作区冲突。侧栏支持搜索、按运行状态筛选、重命名、置顶和归档任务，永久删除只对已归档任务开放。任务上下文不需要在聊天、编辑器和终端之间来回搬运。

### 把项目知识留在项目里

<p align="center">
  <img src="./docs/images/threadlight-project-memory.png" width="100%" alt="Threadlight 项目长期记忆界面" />
</p>

项目长期记忆保存在可读、可版本化的 `.threadlight/MEMORY.md` 中。每个新任务读取当时的上下文快照；Agent 通过带 revision 校验的 provider-neutral 工具更新它，避免并发写入静默覆盖。

### 在一个地方管理模型与体验

<p align="center">
  <img src="./docs/images/threadlight-settings.png" width="100%" alt="Threadlight 模型、主题和语言设置" />
</p>

桌面端支持：

- OpenAI、Kimi、豆包、Gemini、Grok、DeepSeek、阿里云百炼 · 千问，以及自定义 OpenAI 兼容服务之间切换。
- 针对不同任务选择默认模型。
- 简体中文、繁體中文、English、日本語与 한국어。
- 跟随系统、浅色与深色主题。
- 使用系统安全存储加密 API Key，不将密钥写入项目或日志。

### 更多内置体验

- 流式展示回答、执行进度、工具活动与命令输出。
- 支持图片和文件拖放、附件预览与语音转写输入。
- 会话级后台进程管理：查询、增量读取、等待与终止。
- GitHub 交付：从隔离任务分支 Commit & Push、创建 Draft PR，并在 Review 中查看 CI 与 review comments。
- 临时 MCP runtime：按任务连接 stdio 或 Streamable HTTP Server。
- macOS Computer Use：共享 App、窗口或显示器，并通过画中画预览 Agent 看到的稳定画布。
- 键盘快捷键、可调整面板、多标签终端与文件视图。

## 架构

```mermaid
flowchart TB
    subgraph Surfaces["交互层"]
        Desktop["Electron Desktop"]
        Other["Web · IDE · Custom UI"]
    end

    UI["@threadlight/ui"]
    Client["@threadlight/client"]
    Protocol["@threadlight/protocol"]
    Server["@threadlight/app-server"]
    Loop["@threadlight/agent-loop"]
    Providers["@threadlight/model-providers"]
    Tools["@threadlight/builtin-tools"]
    Memory["@threadlight/project-memory"]
    Models["OpenAI · Kimi · Doubao · Gemini · Grok · DeepSeek · Qwen · Custom"]
    Runtime["Shell · Process · MCP · Search · Computer"]

    Desktop --> UI
    Other --> UI
    UI --> Client
    Client -->|"pluggable transport"| Server
    Client -. "shared types" .-> Protocol
    Server -. "shared types" .-> Protocol
    Server --> Loop
    Server --> Providers
    Server --> Tools
    Server --> Memory
    Loop --> Providers
    Loop --> Tools
    Providers --> Models
    Tools --> Runtime
    Tools --> Memory
```

四条边界贯穿整个项目：

1. **Loop 不感知厂商协议。** `agent-loop` 只依赖 `ModelProvider`；请求 wire format、附件上传和 opaque state 转换都留在 adapter。
2. **Server 不侵入执行核心。** `app-server` 负责 JSON-RPC、任务生命周期、持久化与 transport，不把这些职责下沉到 loop。
3. **Client 与 Server 只共享协议。** 两端通过 `@threadlight/protocol` 对齐类型，不形成实现层面的循环依赖。
4. **工具是能力边界。** 命令、进程、MCP、搜索、项目记忆与 Computer Use 实现统一的 `Tool` 接口，可按运行环境组合或替换。

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- npm
- macOS：完整 Computer Use 需要屏幕录制与辅助功能权限

```bash
git clone https://github.com/nagisa77/threadlight.git
cd threadlight
npm install
npm test
```

### 启动桌面端

推荐直接在桌面端设置页填写模型服务、模型和搜索密钥：

```bash
npm run desktop:dev
```

也可以从环境变量注入配置：

```bash
export OPENAI_API_KEY="your-key"

# 可选：启用 web_search
export BRAVE_SEARCH_API_KEY="your-key"

npm run desktop:dev
```

构建并预览 production bundle：

```bash
npm run desktop:preview
```

生成当前 Mac 架构的独立 `.app`：

```bash
npm run desktop:package
```

### 单独启动 Threadlight Host

在远程开发机、容器或 SSH workspace 中安装并构建后，可以启动无 UI、支持多项目且拥有独立设置的 Host：

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"

npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432
```

Host 的项目、任务和设置保存在远端 `~/.threadlight`，各项目数据保存在远端项目的 `.threadlight`。桌面端切换 Host 后只显示当前 Host 的工作域。推荐保持 Host 只监听回环地址，并使用 SSH 隧道：

```bash
ssh -N -L 7432:127.0.0.1:7432 user@development-host
```

容器中可改为 `--host 0.0.0.0`，但跨不可信网络时需要 HTTPS 反向代理、VPN 或 SSH 隧道。访问令牌会在桌面端使用系统安全存储加密，Runtime 不会把令牌写入日志。

在本机模拟另一台独立 Host 时，请增加
`--home "$HOME/.threadlight-host-dev"`，避免和桌面端的本机 Host 共用
`~/.threadlight/settings.json`。`host:dev` 会先构建共享 packages 再启动服务。

生成可复制到远端安装的无 UI 包：

```bash
npm run host:package
```

完整用法见 [Threadlight Host 文档](./docs/REMOTE_HOST.zh-CN.md)。远程 Runtime
Transport 使用浏览器兼容的 HTTP + NDJSON，交互式终端使用经过 Host Token
鉴权的 WebSocket；`@threadlight/client` 不依赖 Electron，可同时供桌面端与
Web 端复用。

### 启动与部署 Web 端

Web 端直接复用桌面端的 `@threadlight/ui`，只连接已经运行的远端 Host，不会自行
启动 Host：

```bash
# 开发
VITE_THREADLIGHT_HOST_URL=http://127.0.0.1:7432 npm run web:dev

# Production 静态构建
VITE_THREADLIGHT_HOST_URL=https://host.example.com npm run web:build

# 部署 apps/web/dist
docker run -d \
  --name threadlight-web \
  --restart unless-stopped \
  -p 8080:80 \
  -v "$PWD/apps/web/dist:/usr/share/nginx/html:ro" \
  nginx:alpine
```

Host 启动时必须把 Web 地址配置为允许的 Origin，例如
`--origin https://threadlight.example.com`。HTTPS Web 页面需要 HTTPS/WSS Host；
Token 只保存在浏览器的当前标签会话中。完整命令、TLS 反向代理与本地联调方式见
[Web 部署文档](./docs/WEB_DEPLOYMENT.zh-CN.md)。

| 服务 | 必需配置 | 可选配置 |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `THREADLIGHT_MODEL` |
| DeepSeek | `THREADLIGHT_PROVIDER=deepseek`、`DEEPSEEK_API_KEY` | `THREADLIGHT_MODEL` |
| Kimi | `THREADLIGHT_PROVIDER=kimi`、`MOONSHOT_API_KEY` | `MOONSHOT_BASE_URL`、`THREADLIGHT_MODEL` |
| 豆包 | `THREADLIGHT_PROVIDER=doubao`、`ARK_API_KEY` | `ARK_BASE_URL`、`THREADLIGHT_MODEL` |
| Gemini | `THREADLIGHT_PROVIDER=gemini`、`GEMINI_API_KEY` | `GEMINI_BASE_URL`、`THREADLIGHT_MODEL` |
| Grok | `THREADLIGHT_PROVIDER=grok`、`XAI_API_KEY` | `XAI_BASE_URL`、`THREADLIGHT_MODEL` |
| 自定义兼容服务 | `THREADLIGHT_PROVIDER=custom`、`CUSTOM_BASE_URL`、`THREADLIGHT_MODEL` | `CUSTOM_API_KEY` |
| 千问 | `THREADLIGHT_PROVIDER=qwen`、`DASHSCOPE_API_KEY` | `DASHSCOPE_BASE_URL`、`THREADLIGHT_MODEL` |

```bash
# DeepSeek
export THREADLIGHT_PROVIDER="deepseek"
export DEEPSEEK_API_KEY="your-key"
export THREADLIGHT_MODEL="deepseek-v4-pro"

# 或 Kimi（默认使用 Kimi K3）
export THREADLIGHT_PROVIDER="kimi"
export MOONSHOT_API_KEY="your-key"
export MOONSHOT_BASE_URL="https://api.moonshot.ai/v1"
export THREADLIGHT_MODEL="kimi-k3"

# 或豆包（火山方舟）
export THREADLIGHT_PROVIDER="doubao"
export ARK_API_KEY="your-key"
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
export THREADLIGHT_MODEL="doubao-seed-2-0-pro-260215"

# 或 Gemini
export THREADLIGHT_PROVIDER="gemini"
export GEMINI_API_KEY="your-key"
export GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export THREADLIGHT_MODEL="gemini-3.6-flash"

# 或 Grok
export THREADLIGHT_PROVIDER="grok"
export XAI_API_KEY="your-key"
export XAI_BASE_URL="https://api.x.ai/v1"
export THREADLIGHT_MODEL="grok-4.5"

# 或自定义 OpenAI 兼容服务（API Key 可选）
export THREADLIGHT_PROVIDER="custom"
export CUSTOM_BASE_URL="http://127.0.0.1:11434/v1"
export THREADLIGHT_MODEL="llama3.2"

# 或阿里云百炼 · 千问
export THREADLIGHT_PROVIDER="qwen"
export DASHSCOPE_API_KEY="your-key"
export DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export THREADLIGHT_MODEL="qwen3.7-plus"
```

Electron renderer 保持浏览器环境且不启用 Node integration。Preload 只暴露受限的 Threadlight bridge，app-server 作为独立子进程运行。

## 作为 Runtime 使用

### Agent Loop

```ts
import { AgentLoop, defineAgent } from "@threadlight/agent-loop";
import { createExecCommandTool } from "@threadlight/builtin-tools";
import { OpenAIResponsesProvider } from "@threadlight/model-providers";

const loop = new AgentLoop(
  new OpenAIResponsesProvider({ defaultModel: "gpt-5.6-sol" }),
);

const result = await loop.run(
  defineAgent({
    name: "assistant",
    instructions: "Answer directly and use tools when needed.",
    tools: [createExecCommandTool({ workspaceRoot: process.cwd() })],
  }),
  "运行测试并总结结果",
  { onEvent: (event) => console.log(event) },
);

console.log(result.output);
```

### 类型安全客户端

```ts
import { ThreadlightClient } from "@threadlight/client";

const client = new ThreadlightClient(transport);
await client.initialize();

const { threadId } = await client.startThread();
client.on("turn/completed", ({ output }) => console.log(output));

await client.startTurn(threadId, "分析当前工作区");
```

客户端只要求 transport 能发送请求并订阅服务端消息。桌面端使用 JSONL/stdio，Web 或 IDE 可以实现 WebSocket 等其他 transport，上层调用保持不变。

## 内置能力

### 命令与后台进程

`exec_command` 直接在受约束的工作目录中执行命令。超过前台等待时间后，进程转入受管后台并返回 opaque `sessionId`：

- `process_status`：查看状态。
- `process_read`：增量读取输出。
- `process_wait`：等待结束或超时。
- `process_kill`：终止进程。

### MCP

每个会话拥有独立的临时 MCP runtime。Agent 可以连接用户明确提供、工作区内可验证或 Plugin 注册的 stdio / Streamable HTTP MCP Server，先读取工具 schema，再执行调用。Plugin MCP 工具会包装为稳定的 `<connector>__<tool>` 名称，并把 MCP 的只读、破坏性与开放世界 annotation 映射到 Threadlight 的工具影响元数据。连接只在当前 app-server 进程的对应会话中复用，删除会话或服务退出时自动释放。

远程 MCP 支持 OAuth 2.1 authorization code + S256 PKCE。Electron 主进程负责打开授权页，并使用 `safeStorage` 把 token、PKCE verifier、动态客户端信息和发现状态加密写入独立的 `~/.threadlight/connection-store.json`。renderer、Settings 和会话快照都不保存 access token；会话只记录 connector ID、版本与当轮 `capabilityRefs` 选择。

### Prompt、Skills 与 Plugins

Threadlight 使用带版本和 SHA-256 hash 的 Prompt Composer，将 Host 规则、项目上下文、运行时能力、Skill 与回合模式组合成可验证的 instructions。首次用户输入会把 Prompt、Skill 和 Plugin 快照一起写入任务；恢复任务时继续使用原快照，避免 `AGENTS.md`、内置 Prompt 或已安装扩展变化后污染既有模型状态。

Skills 使用兼容 Agent Skills 的 `SKILL.md` 格式，并按渐进披露加载：

- 项目 Skills：`<project>/.agents/skills/<skill-name>/SKILL.md`
- 用户 Skills：`~/.agents/skills/<skill-name>/SKILL.md`
- 显式调用：在请求中写 `$skill-name`
- 桌面端选择：在输入框中键入 `@`，按“工具 / 技能”分组搜索；仓库级 Skills 与精选能力会直接显示，用户全局和其他长尾 Skills 输入关键词后出现；选择结果以 chip 显示，并仅对当前一轮生效
- Composer `+` 菜单：集中提供添加文件与 Plan 模式，使用和 `@` 菜单一致的键盘交互
- 可强调工具使用显式应用侧 allowlist；当前包含 Plan 与可用时的 Computer Use，不会把 `exec_command` 等内部工具自动暴露到 `@`
- 隐式调用：Agent 根据描述匹配后使用只读 `skill_read` 加载完整工作流

内置 `$skill-creator` 可以通过原子、受校验的 `skill_create` 工具创建项目或用户级 instruction-only Skill。新 Skill 从下一个任务开始被发现。

Plugin 使用 `.codex-plugin/plugin.json`，可以声明 `skills` 和 `mcpServers`。`mcpServers` 指向插件内的 JSON 清单；远程地址可以直接写 HTTPS URL，也可以通过 `urlEnv` 在运行时注入。插件可以放在项目或用户的 `.agents/plugins`、`.threadlight/plugins` 目录中，其 Skills 以 `$plugin-name:skill-name` 调用。内置 Documents、PDF 与 Gmail 也使用同一目录结构。

Gmail 使用 Google 官方 Remote MCP endpoint。首次从 `@` 选择 Gmail 时，Threadlight 会打开独立连接窗口：

1. 在 Google Cloud 项目启用 Gmail API 与 Gmail MCP API。
2. 配置 OAuth consent screen，并加入 `gmail.readonly`、`gmail.compose` scopes。
3. 创建 Web application OAuth Client，把连接窗口显示的 localhost 地址加入 Authorized redirect URIs。
4. 在连接窗口输入 Client ID 与 Client Secret，随后在浏览器完成授权。

Client Secret、PKCE verifier 与 token 只会经 Electron `safeStorage` 加密写入 `connection-store.json`，不会进入 Settings、会话快照或日志。Google 的完整配置要求见 [Configure the Gmail MCP server](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)。

### Computer Use

Electron 桌面端的 `computer_share` 可以：

- 选择一个或多个 App、窗口或显示器。
- 将目标组合成 1440 × 900 的稳定画布。
- 通过不抢焦点的置顶画中画同步展示 Agent 视野。
- 优先使用 macOS Accessibility action 定向输入。
- 在桌面或不支持定向输入的界面显式启用 system input 兼容模式。

首次使用需要授予屏幕录制和辅助功能权限。设置 `THREADLIGHT_COMPUTER_USE=0` 可以关闭该能力。

### 项目记忆

项目长期记忆存放在 `.threadlight/MEMORY.md`。Agent 使用 `project_memory` 工具先读后写，并携带 revision 更新。它适合保存稳定、可验证、跨任务仍然有效的项目事实、架构决定和约定，不应包含密钥、聊天转录、临时状态或未经验证的推测。

## 数据与安全

```text
~/.threadlight/
├── settings.json                 # 模型密钥与全局偏好
├── connection-store.json         # safeStorage 加密的 connector OAuth 状态
└── project-map.json              # 项目、路径与会话摘要索引

<project>/.threadlight/
├── MEMORY.md                     # 用户可读的长期项目记忆
├── plugins/                      # 可选的项目级 Plugins
├── suggestions.json              # 项目级推荐问题缓存（每种语言至多每小时刷新一次）
└── conversations/
    └── <threadId>.json           # 会话与受限、脱敏的 opaque model state
```

- 密钥只从运行时环境或系统安全存储注入，不进入源码、fixtures、项目文件或日志。
- app-server 的协议输出与诊断日志分别写入 stdout 和 stderr。
- 持久化的 opaque model state 上限为 5 MiB；Computer Use 截图写盘前会替换为占位图。
- 首页推荐问题按项目和语言缓存；只有距离上次生成尝试超过一小时才会惰性刷新，失败时继续使用旧问题。
- 每个 Skill 最大 64,000 字符；每个任务最多快照 128 个 Skills、合计 2,000,000 字符，初始 Skill 目录最多占 8,000 字符 Prompt。
- 附件通过受校验的本地路径引用，wire adapter 不直接内联文件字节。
- `.threadlight/` 默认应加入版本控制忽略规则。
- 内置工具不是系统 sandbox；需要强隔离时，请在容器、虚拟机或操作系统 sandbox 中运行。

## Monorepo

```text
threadlight/
├── apps/
│   └── desktop/              Electron 主进程、preload、renderer 与原生输入桥
├── packages/
│   ├── agent-loop/           Provider-neutral Agent 执行核心
│   ├── model-providers/      模型厂商 adapter
│   ├── project-memory/       原子 Markdown 存储与 revision 校验
│   ├── builtin-tools/        命令、进程、MCP、搜索、记忆与 Computer Use
│   ├── protocol/             JSON-RPC 请求、响应、通知与共享类型
│   ├── app-server/           Thread / Turn 编排、持久化与 transport
│   ├── client/               类型安全、transport-neutral 客户端
│   └── ui/                   可复用 React 会话界面
└── test/                     跨 package 集成测试
```

## 开发与验证

第一次贡献请从 **[完整开发指南](./docs/DEVELOPMENT.zh-CN.md)** 开始；其中包含架构调用链、package 边界、新增工具、新增模型 Provider、扩展协议、桌面端调试和离线测试示例。提交规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

```bash
npm run build       # 构建所有 packages 与桌面端
npm run typecheck   # TypeScript 类型检查
npm test            # 完整离线测试
npm run clean       # 清理 TypeScript build artifacts
```

提交新行为时，请同时添加使用 scripted model provider 的离线测试，并遵守以下约束：

- `agent-loop` 必须保持 provider-neutral。
- 厂商 wire format 只能出现在 adapter 中。
- app-server 的 transport / protocol 职责不能进入 loop。
- 工具回合之间必须保留 opaque model state。
- 不得在源码、fixtures 或日志中写入 API Key 或其他密钥。

## 当前边界

- `exec_command` 会限制工作目录、前台等待时间和输出大小，但不是系统 sandbox。
- `web_search` 当前通过 Brave Search API 提供。
- stdio 已与核心协议解耦，可以继续扩展 WebSocket 等 transport。
- 当前优先面向本地单用户工程工作流，项目仍处于快速演进阶段。

---

<div align="center">
  <strong>Threadlight</strong>
  <br />
  <sub>让 Agent 的思考、行动与结果，在同一条时间线上发光。</sub>
</div>
