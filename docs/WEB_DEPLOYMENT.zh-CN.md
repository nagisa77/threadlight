# Threadlight Web 部署

Threadlight Web 与桌面端复用同一个 `@threadlight/ui`，浏览器侧只实现远端 Host
连接、项目切换、HTTP/NDJSON Runtime、远端文件和 WebSocket 终端适配。Web
进程不会启动 Host，也不会访问部署服务器的本地项目。

## 本地联调

先启动允许 Vite Origin 的远端 Host：

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"

npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --origin http://localhost:5173 \
  --project /absolute/path/to/project
```

另开一个终端启动 Web：

```bash
VITE_THREADLIGHT_HOST_URL=http://127.0.0.1:7432 npm run web:dev
```

打开 `http://localhost:5173`，输入上面的 `THREADLIGHT_HOST_TOKEN`。Host 地址会
保存在 `localStorage`；Token 只保存在当前标签会话的 `sessionStorage`，不会写进
源码或 production bundle。

## Production 构建与静态部署

下面的命令会把公开的 Host 地址预填到连接页。它不是密钥；不要使用 `VITE_*`
变量注入 Token。

```bash
npm ci
VITE_THREADLIGHT_HOST_URL=https://host.example.com npm run web:build
```

静态产物位于 `apps/web/dist`。例如用 Nginx 容器部署：

```bash
docker run -d \
  --name threadlight-web \
  --restart unless-stopped \
  -p 8080:80 \
  -v "$PWD/apps/web/dist:/usr/share/nginx/html:ro" \
  -v "$PWD/apps/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine
```

这里挂载的 Nginx 配置包含 SPA fallback，直接刷新 `/tasks/:threadId` 时仍会加载 Web 应用并恢复对应工作。

如果部署在子路径，可以在构建时设置：

```bash
THREADLIGHT_WEB_BASE_PATH=/threadlight/ npm run web:build
```

## Host 的 Production 命令

HTTPS Web 页面只能连接 HTTPS/WSS Host。建议让 Host 监听回环地址，再由 TLS
反向代理公开：

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"

npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --origin https://threadlight.example.com \
  --project /absolute/path/to/project \
  --name "Production Host"
```

使用已打包的 Host 时，把 `npm run host:dev --` 替换为 `threadlight-host`。
`--origin` 必须与浏览器地址完全一致，包括 scheme 和端口。

例如使用 Caddy 终止 TLS：

```bash
caddy reverse-proxy \
  --from https://host.example.com \
  --to http://127.0.0.1:7432
```

反向代理必须支持 WebSocket upgrade，并且不能缓冲
`application/x-ndjson` Runtime 事件流。不要把 Host 的 7432 明文端口直接暴露在
不可信网络。

## 可用能力

Web 端直接复用桌面 UI，可使用远端项目与任务、模型设置、项目 Memory、Workspace
浏览与 Diff、远端系统文件、安全执行审批和远端终端。依赖 Electron/macOS 的本机
能力（Finder、Computer Use、本机附件 staging、语音转写和本机自动化调度）不会在
浏览器中伪装为可用。
