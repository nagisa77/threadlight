# Threadlight

Threadlight 是一个小而清晰的 TypeScript Agent Runtime：让模型的每个 thread、turn 和 tool event 都可见、可控、可扩展。

它包含以下模块和应用：

- `@threadlight/agent-loop`：provider-neutral 的工具循环、审批钩子、取消、事件和会话状态。
- `@threadlight/model-providers`：OpenAI Responses、DeepSeek 与千问兼容协议适配器。
- `@threadlight/project-memory`：项目记忆的安全路径、原子 Markdown 存储和版本校验。
- `@threadlight/builtin-tools`：内置的项目记忆、命令执行和互联网搜索工具。
- `@threadlight/protocol`：客户端与 app-server 共享的 JSON-RPC 类型。
- `@threadlight/app-server`：JSON-RPC 2.0、thread/turn 管理、项目内会话持久化、流式事件、审批恢复和 stdio transport。
- `@threadlight/client`：transport-neutral 的类型安全客户端、请求关联和事件订阅。
- `@threadlight/ui`：可供 Electron 和未来 Web UI 复用的 React 会话界面。
- `@threadlight/desktop`：安全 IPC、app-server 子进程和 Electron 窗口壳。

## 架构

```text
Electron / Web UI / IDE
        │ @threadlight/ui
        │ @threadlight/client + pluggable transport
        ▼
@threadlight/app-server
        ├── @threadlight/model-providers ──┐
        │                                  │ implements
        ▼                                  ▼
@threadlight/agent-loop ◄────────── ModelProvider
        └── Tool[] ◄── @threadlight/builtin-tools
```

`agent-loop` 不依赖 app-server 或任何厂商 SDK；厂商 wire format 和 opaque state
由 `model-providers` 适配。app-server 只根据运行时配置选择 Provider 并注入 loop。
client 和 app-server 不互相依赖，二者只共享 protocol。

## Client API

客户端只要求 transport 能发送请求并订阅服务端消息：

```ts
import { ThreadlightClient } from "@threadlight/client";

const client = new ThreadlightClient(transport);
await client.initialize();

const { threadId } = await client.startThread();
client.on("turn/completed", ({ output }) => console.log(output));
await client.startTurn(threadId, "现在几点？");
```

桌面端可以实现 JSONL/stdio transport，Web UI 可以实现 WebSocket transport，
上层调用方式保持不变。

## Electron 客户端

开发模式会先构建 workspace packages，再启动 Electron 和 renderer HMR：

```bash
export OPENAI_API_KEY="..."
# 可选；设置后启用 web_search
export BRAVE_SEARCH_API_KEY="..."
npm run desktop:dev
```

也可以在桌面设置中切换 DeepSeek 或阿里云百炼·千问；对应 CLI 环境变量为：

```bash
# DeepSeek
export THREADLIGHT_PROVIDER="deepseek"
export DEEPSEEK_API_KEY="..."
export THREADLIGHT_MODEL="deepseek-v4-pro"

# 或千问
export THREADLIGHT_PROVIDER="qwen"
export DASHSCOPE_API_KEY="..."
export DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export THREADLIGHT_MODEL="qwen3.7-plus"
```

构建并预览 production bundle：

```bash
npm run desktop:preview
```

Electron renderer 保持浏览器环境，不启用 Node integration。preload 只暴露受限的
Threadlight JSON-RPC bridge；app-server 作为独立子进程运行。

桌面端的全局数据统一保存在 `~/.threadlight/`：

- `settings.json`：使用系统安全存储加密过的密钥与用户偏好。
- `project-map.json`：项目、base 路径和对话摘要索引。

对话正文与 provider-neutral 的 opaque model state 保存在对应项目的
`.threadlight/conversations/<threadId>.json`。切换项目时桌面端会以该项目的 base
路径重启 app-server；空白会话不会进入任务列表或写入会话文件，首次输入后才会保存
为任务。`.threadlight/` 默认应被项目的版本控制忽略。

## 项目记忆

每个项目的长期记忆保存在明文 `.threadlight/MEMORY.md`。文件会在运行时或首次查看时自动创建，用户可以在桌面端查看渲染结果、核对 Markdown 源码，或用默认编辑器打开。

Threadlight 在创建新任务时把记忆作为上下文快照载入；已有任务不会被外部编辑悄悄改变。agent 通过 provider-neutral 的 `project_memory` 工具先读后写，写入时携带 revision，因此并发修改不会静默覆盖。工具写入限制为 25,000 字符，并遵循以下约定：

- 只保留跨任务仍然有用的项目事实、架构决定、约定、命令和已验证的坑。
- 内容保持简短、具体、可验证；修改已有条目，避免重复堆积。
- 不记录密钥、临时任务状态、聊天转录或未经验证的推测。
- 记忆是辅助上下文，不会覆盖 `AGENTS.md` 等项目指令；可能过期的事实仍需对照工作区验证。

## 开始使用

要求 Node.js 22 或更新版本。

```bash
npm install
npm test
```

运行默认 app-server：

```bash
export OPENAI_API_KEY="..."
# 可选；设置后启用 web_search
export BRAVE_SEARCH_API_KEY="..."
npm start
```

默认注册 `exec_command`；它在执行前会请求客户端审批。命令在等待时限内未结束时
会继续作为受管进程运行并返回不透明 `sessionId`，可通过 `process_status`、
`process_read`、`process_wait` 和 `process_kill` 查询输出、等待或终止。设置
`BRAVE_SEARCH_API_KEY` 后还会注册基于 Brave Search API 的 `web_search`。

app-server 使用 stdout 发送 JSONL 协议消息，日志只写入 stderr。启动后可以逐行发送：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize"}
{"jsonrpc":"2.0","id":2,"method":"thread/start"}
```

从第二条响应取出 `threadId`，再发送：

```json
{"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"...","input":"现在几点？"}}
```

## Agent Loop API

```ts
import {
  AgentLoop,
  defineAgent,
} from "@threadlight/agent-loop";
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
  "现在几点？",
  { approve: async () => true },
);

console.log(result.output);
```

## App-server 方法

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/delete`
- `turn/start`
- `turn/interrupt`
- `process/status`
- `process/read`
- `process/wait`
- `process/kill`
- `approval/resolve`

运行期间使用 `agent/event` 通知转发 Agent Loop 事件。每次模型调用后会发送
`model.output_text.delta`，把 provider 返回的真实文本增量立即送到客户端；随后发送
`model.completed`，其中包含该次返回的完整 `text`、`toolCalls` 和 token usage。最终发送
`turn/completed` 或 `turn/failed`。delta 是临时显示数据，完整响应仍是持久化与 opaque
model state 更新的提交边界；opaque model state 不会写入事件。

## 当前边界

这是有意保持精简的第一版：

- 文件会话存储由 app-server 注入，默认 CLI 使用项目内存储；`agent-loop` 不感知文件路径或存储格式。
- `exec_command` 会限制工作目录、前台等待时间和输出大小，并默认要求审批；超出等待时间的命令由进程会话继续托管。它不是操作系统 sandbox，获批的命令仍拥有当前用户权限。
- `web_search` 使用 Brave Search API，密钥只从运行时配置注入。
- stdio transport 已与核心协议解耦，之后可以增加 WebSocket。

适合下一步扩展的模块依次是 JSON Schema 本地校验、Git worktree 工具和 Docker sandbox。
