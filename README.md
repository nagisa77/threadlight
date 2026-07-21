# Threadlight

Threadlight 是一个小而清晰的 TypeScript Agent Runtime：让模型的每个 thread、turn 和 tool event 都可见、可控、可扩展。

它包含以下模块和应用：

- `@threadlight/agent-loop`：模型调用、工具循环、审批钩子、取消、事件和会话状态。
- `@threadlight/builtin-tools`：内置的命令执行和互联网搜索工具。
- `@threadlight/protocol`：客户端与 app-server 共享的 JSON-RPC 类型。
- `@threadlight/app-server`：JSON-RPC 2.0、thread/turn 管理、流式事件、审批恢复和 stdio transport。
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
        │
        ▼
@threadlight/agent-loop
        ├── ModelProvider
        └── Tool[] ◄── @threadlight/builtin-tools
```

`agent-loop` 不依赖 app-server；app-server 只是它的一个客户端协议适配层。
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

构建并预览 production bundle：

```bash
npm run desktop:preview
```

Electron renderer 保持浏览器环境，不启用 Node integration。preload 只暴露受限的
Threadlight JSON-RPC bridge；app-server 作为独立子进程运行。

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

默认注册 `exec_command`；它在执行前会请求客户端审批。设置
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
  OpenAIResponsesProvider,
  defineAgent,
} from "@threadlight/agent-loop";
import { createExecCommandTool } from "@threadlight/builtin-tools";

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
- `turn/start`
- `turn/interrupt`
- `approval/resolve`

运行期间使用 `agent/event` 通知转发 Agent Loop 事件。每次模型调用后会发送
`model.completed`，其中包含该次返回的 `text`、`toolCalls` 和 token usage；最终发送
`turn/completed` 或 `turn/failed`。opaque model state 不会写入事件。

## 当前边界

这是有意保持精简的第一版：

- 会话存放在内存中，服务重启后不会恢复。
- `exec_command` 会限制工作目录、执行时间和输出大小，并默认要求审批；它不是操作系统 sandbox，获批的命令仍拥有当前用户权限。
- `web_search` 使用 Brave Search API，密钥只从运行时配置注入。
- stdio transport 已与核心协议解耦，之后可以增加 WebSocket。

适合下一步扩展的模块依次是持久化 SessionStore、JSON Schema 本地校验、Git worktree 工具和 Docker sandbox。
