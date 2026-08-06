# Threadlight Web 部署

Threadlight Web 与桌面端复用同一个 `@threadlight/ui`，浏览器侧只实现远端 Host
连接、项目切换、HTTP/SSE Runtime、远端文件和 WebSocket 终端适配。Web
进程不会启动 Host，也不会访问部署服务器的本地项目。

## 本地联调

先启动允许 Vite Origin 的远端 Host：

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"

npm run host:dev -- \
  --host 0.0.0.0 \
  --port 7432 \
  --origin http://localhost:5173 \
  --origin http://192.168.50.186:5173 \
  --project /absolute/path/to/project
```

另开一个终端启动 Web：

```bash
VITE_THREADLIGHT_HOST_URL=http://192.168.50.186:7432 npm run web:dev -- --host 0.0.0.0
```

电脑打开 `http://localhost:5173`，同一局域网设备打开
`http://192.168.50.186:5173`，输入上面的 `THREADLIGHT_HOST_TOKEN`。请把示例中的
局域网 IP 替换为 Host 机器的实际地址。连接成功后，Host 地址与访问
Token 会一起保存在浏览器的 `localStorage` 主机记录中（默认保留最近 12 台），
退出登录不会清除记录，方便下次快速重连；也可以在登录页选择、编辑或删除已保存的
主机。记录不会写进源码或 production bundle。

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

### GitHub Pages + Tailscale Serve

仓库的 `Deploy Web to GitHub Pages` workflow 会在 `main` 更新后把 Web 客户端部署到
GitHub Pages。构建不会预填 Host 地址；手机需要登录与 Host 机器相同的 Tailscale
tailnet，再手动输入该机器的 Tailscale HTTPS 地址。

由于 GitHub Pages 使用 HTTPS，浏览器不能从该页面连接明文 HTTP Host。让 Host
只监听本机回环地址，并允许 GitHub Pages 的 Origin：

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
printf 'Threadlight token: %s\n' "$THREADLIGHT_HOST_TOKEN"

npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --origin https://nagisa77.github.io \
  --public-url https://your-mac.example-tailnet.ts.net \
  --project /absolute/path/to/project \
  --name "Tailscale Host"
```

另开终端，用 Tailscale Serve 提供 tailnet 内可访问的 HTTPS/WSS 入口：

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 7432
```

然后在手机上打开 GitHub Pages 地址并输入上面打印的 Token。可用下面的命令检查或
撤销代理配置：

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
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
每个 `--origin` 都必须与对应浏览器地址完全一致，包括 scheme 和端口；需要允许
多个地址时可重复传入该参数。

例如使用 Caddy 终止 TLS：

```bash
caddy reverse-proxy \
  --from https://host.example.com \
  --to http://127.0.0.1:7432
```

反向代理必须支持 WebSocket upgrade，并且不能缓冲
`text/event-stream` Runtime 事件流。不要把 Host 的 7432 明文端口直接暴露在
不可信网络。

## 可用能力

Web 端直接复用桌面 UI，可使用远端项目与任务、模型设置、项目 Memory、Workspace
浏览与 Diff、远端系统文件、安全执行审批和远端终端。依赖 Electron/macOS 的本机
能力（Finder、Computer Use、本机附件 staging、语音转写和本机自动化调度）不会在
浏览器中伪装为可用。
