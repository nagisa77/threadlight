# Threadlight Host

> [!TIP]
> 如果目标是让用户直接在浏览器使用完整 Host + Web，优先使用
> [一站式自部署指南](./SELF_HOSTING.zh-CN.md)。本文保留桌面端远程连接、源码启动和
> Host 协议细节。

Threadlight Host 是无 UI 的远端服务层。它不是“某个项目的 Runtime”，而是一台完整的
Threadlight 工作主机：

- 主机级数据保存在远端 `~/.threadlight`。
- 项目列表、任务索引、模型配置和 API Key 都属于该主机。
- 每个项目的对话、记忆等项目数据仍保存在远端项目的 `.threadlight`。
- 桌面端一次只展示当前 Host 的项目和设置；切回“本机 Host”后恢复本机工作域。
- 本机与远端使用相同的 ProjectStore、SettingsStore 和 app-server 运行代码。

## 在源码仓库启动

```bash
npm install

export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --name "Build server"
```

`host:dev` 会先构建共享 packages，再从源码仓库启动 Host。修改代码后重新执行即可。

首次连接后，可在桌面端输入远端绝对路径来添加项目。Host 会把项目登记到远端
`~/.threadlight/project-map.json`。设置页读写的是远端
`~/.threadlight/settings.json`；API Key 使用 Host 本地生成的
`~/.threadlight/host-secret.key` 加密，文件权限为 `0600`。

### 在本机模拟另一台 Host

桌面端的“本机 Host”和同一用户启动的独立 Host 默认都会使用
`~/.threadlight`。如果目的是在一台机器上模拟两台设置互相独立的主机，必须给开发
Host 指定独立数据目录：

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
npm run host:dev -- \
  --home "$HOME/.threadlight-host-dev" \
  --host 127.0.0.1 \
  --port 7432 \
  --name "Local development Host"
```

连接 `http://127.0.0.1:7432` 后，这个 Host 的项目索引、设置、API Key 和主机 ID
都保存在 `~/.threadlight-host-dev`，不会读取桌面端本机 Host 的数据。真实远端机器
仍使用默认的 `~/.threadlight`。

如果旧版本已经让两种运行方式共用了一个设置文件，当前版本会把无法由当前 Host
解密的密钥显示为“未配置”，而不会让设置页面整体失败；请在目标 Host 的设置页重新
录入对应 API Key。

可用参数：

- `--host`：监听地址，默认 `127.0.0.1`。
- `--port`：监听端口，默认 `7432`。
- `--home`：主机数据目录，默认 `~/.threadlight`。
- `--name`：桌面端显示的主机名。
- `--project`：启动时登记一个项目路径，可选。
- `--token`：访问令牌；也可使用 `THREADLIGHT_HOST_TOKEN`。
- `--origin`：允许访问的 Web Origin，可选；可重复传入以允许多个 Origin。

## 打包和部署

在开发机生成不包含 UI/Electron 的独立 npm 包：

```bash
npm run host:package
```

产物位于 `artifacts/threadlight-host-1.1.0.tgz`，包含两个已经打包的 Node.js
入口和内置 skills/plugins。复制到远端后：

```bash
npm install -g ./threadlight-host-1.1.0.tgz

export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
threadlight-host --host 127.0.0.1 --port 7432
```

要求 Node.js 22 或更高版本，不需要 Electron 或桌面环境。远端终端使用
`node-pty`；如果目标平台没有可用的预编译二进制，安装时还需要 Python、make 和
C++ 编译工具。Debian/Ubuntu 可预先安装：

```bash
sudo apt install -y python3 make build-essential
```

`artifacts/` 是可重复生成的本地构建目录，已加入 `.gitignore`，不应提交到 Git。

## SSH 连接

推荐让 Host 只监听远端回环地址，再建立 SSH 隧道：

```bash
ssh -N -L 7432:127.0.0.1:7432 user@development-host
```

桌面端连接 `http://127.0.0.1:7432` 并填写相同令牌。切换成功后，本机
app-server 会停止，侧栏只展示这台 Host 的项目；在 Host 选择器中选择“本机 Host”
即可切回。

## 网络边界

Bearer Token 只负责认证，不加密 HTTP 内容。跨不可信网络时必须使用 SSH 隧道、
VPN 或 HTTPS 反向代理。Host 不会打印令牌，也不会把 API Key 写入日志。

## HTTP 协议

Host 协议版本为 2：

- `GET /v1/health`：Host 身份和协议协商。
- `/v1/host/projects/*`：Host 级项目与任务索引。
- `GET /v1/host/directories`：为桌面端项目路径 Popover 提供远端目录补全。
- `GET /v1/host/files`：为桌面端远端文件选择器列出 Host 文件和目录。
- `GET /v1/host/file`：读取 Host 上选中的文件以供桌面端预览。
- `/v1/host/settings`：Host 独立设置。
- `/v1/projects/:projectId/runtime/*`：项目 app-server RPC、事件和 workspace 审阅。

项目 id 是运行路由的一部分，因此同一端口可以同时服务多个 Threadlight Project。

连接远端 Host 后，“打开系统文件”会自动切换为“打开远端文件”。文件浏览和内容
读取均发生在 Host，桌面端不会弹出本机 Finder，也不会读取本机同名路径。与远端
终端一致，持有 Host Token 的客户端可以访问该 Host 用户有权限读取的文件。

## 远端终端

连接远端 Host 后，底部终端会在远端项目或对应任务工作区中启动，而不是在桌面端
本机启动。终端 UI 与本机一致，输入、窗口尺寸和输出通过经过 Host Token 认证的
WebSocket 传输：

- WebSocket 路径为 `/v1/host/terminal`。
- 桌面端使用 `Authorization` Header；浏览器端通过
  `Sec-WebSocket-Protocol` 携带编码后的 Token，Token 不会进入 URL。
- 一个连接可以承载多个终端标签。
- 终端只能从 Host 已登记的项目和服务端记录的任务工作区创建，客户端不能传入任意
  工作目录。
- WebSocket 断开时，连接拥有的所有 PTY 会被关闭，避免在 Host 上遗留后台 Shell。
- Host 不会把 `THREADLIGHT_HOST_TOKEN` 传入终端环境。

终端等同于该 Host 用户权限下的交互式 Shell。持有 Host Token 的客户端因而拥有
远端命令执行能力；请保护令牌，并继续通过 SSH 隧道、VPN 或 HTTPS/WSS 使用 Host。
