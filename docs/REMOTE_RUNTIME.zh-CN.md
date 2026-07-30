# Remote Runtime

Remote Runtime 把模型、Agent Loop、工具、命令和项目数据留在远程开发机或容器中。桌面端只建立经过认证的控制连接，并负责展示任务过程、文件树和只读 Diff。

## 单独启动

先在远程机器完成安装和构建：

```bash
npm install
npm run build:packages
```

准备模型配置和一个强随机令牌，然后在目标仓库启动：

```bash
export OPENAI_API_KEY="your-model-key"
export THREADLIGHT_RUNTIME_TOKEN="$(openssl rand -hex 32)"

npm run runtime -- \
  --workspace /absolute/path/to/repository \
  --host 127.0.0.1 \
  --port 7432
```

Runtime 不会打印访问令牌。桌面端选择“连接 Remote Runtime”，填写 `http://127.0.0.1:7432` 和相同令牌。

也可以直接运行构建后的 CLI：

```bash
THREADLIGHT_RUNTIME_TOKEN="your-strong-token" \
node packages/app-server/dist/remote-bin.js \
  --workspace /absolute/path/to/repository
```

## SSH workspace

推荐让 Runtime 只监听远程回环地址，再使用 SSH 隧道：

```bash
ssh -N -L 7432:127.0.0.1:7432 user@development-host
```

桌面端仍连接 `http://127.0.0.1:7432`。HTTP 流量不会暴露到远程机器的公网网卡。

## 容器

容器内需要监听所有网卡：

```bash
npm run runtime -- \
  --workspace /workspace \
  --host 0.0.0.0 \
  --port 7432
```

将宿主机端口映射到容器，并使用强随机令牌。跨不可信网络时，在 Runtime 前配置 HTTPS 反向代理、VPN，或继续使用 SSH 隧道；Bearer Token 只负责认证，不加密 HTTP 内容。

## Web 端适配

Remote Runtime 使用版本化的 HTTP 接口：

- `POST /v1/rpc`：JSON-RPC 请求与响应。
- `GET /v1/events`：浏览器 `fetch` 可读取的 NDJSON 事件流。
- `GET /v1/workspace/*`：只读文件和 Git 变更审阅。

`@threadlight/client` 中的 `HttpRuntimeTransport` 不依赖 Electron 或 Node API，可直接复用于后续 Web 客户端。需要跨源访问时，用 `--origin https://your-web-app.example` 精确允许一个来源；Runtime 不提供通配 CORS。
