# Threadlight

Threadlight 是一个小而清晰的 TypeScript Agent Runtime：让模型的每个 thread、turn 和 tool event 都可见、可控、可扩展。

它包含两个模块：

- `@threadlight/agent-loop`：模型调用、工具循环、审批钩子、取消、事件和会话状态。
- `@threadlight/app-server`：JSON-RPC 2.0、thread/turn 管理、流式事件、审批恢复和 stdio transport。

## 架构

```text
CLI / Desktop / IDE
        │ JSON-RPC over JSONL/stdio
        ▼
@threadlight/app-server
        │
        ▼
@threadlight/agent-loop
        ├── ModelProvider
        └── Tool[]
```

`agent-loop` 不依赖 app-server；app-server 只是它的一个客户端协议适配层。

## 开始使用

要求 Node.js 22 或更新版本。

```bash
npm install
npm test
```

运行默认 app-server：

```bash
export OPENAI_API_KEY="..."
npm start
```

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
  defineTool,
} from "@threadlight/agent-loop";

const time = defineTool({
  name: "current_time",
  description: "Return the current time",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async execute() {
    return new Date().toISOString();
  },
});

const loop = new AgentLoop(
  new OpenAIResponsesProvider({ defaultModel: "gpt-5.6-sol" }),
);

const result = await loop.run(
  defineAgent({
    name: "assistant",
    instructions: "Answer directly and use tools when needed.",
    tools: [time],
  }),
  "现在几点？",
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

运行期间使用 `agent/event` 通知转发 Agent Loop 事件，最终发送 `turn/completed` 或 `turn/failed`。

## 当前边界

这是有意保持精简的第一版：

- 会话存放在内存中，服务重启后不会恢复。
- 默认示例只提供无副作用的时间工具。
- 尚未实现工作区文件工具、Shell 或操作系统 sandbox。
- stdio transport 已与核心协议解耦，之后可以增加 WebSocket。

适合下一步扩展的模块依次是持久化 SessionStore、JSON Schema 本地校验、Git worktree 工具和 Docker sandbox。
