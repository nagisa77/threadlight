# 自部署 Threadlight Host + Web

Threadlight 的推荐部署形态是一个原生进程同时提供 Web 界面、鉴权 API、事件流和终端 WebSocket。你只需要管理一个服务、一个端口和一个访问 Token。

## 一行安装

要求：Node.js 22+、npm，以及 macOS 或 Linux。

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh
```

安装器会：

1. 下载当前稳定版 Host + Web Release 包。
2. 安装到当前用户目录，不要求 root。
3. 生成或复用 64 字符随机 Token，并写入 mode `0600` 配置。
4. 在 Linux 注册 systemd user service，在 macOS 注册 launchd LaunchAgent。
5. 启动服务并输出 Web 地址和 Token。

Host 默认从空状态启动。打开输出的地址并输入 Token，然后在 Web UI 中添加目标机器上的项目路径。

再次运行同一条安装命令会更新 Host + Web，同时保留 Token 和已有配置。

## 仅安装 Host

如果使用[托管的 Threadlight Web 客户端](https://nagisa77.github.io/threadlight/)，可以只安装 Host 服务：

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh -s -- install --host-only --origin https://nagisa77.github.io
```

`--host-only` 会移除包内置的 Web UI，只保留 Host API、事件流和终端 WebSocket。命令同时允许托管 Web 客户端的 Origin。远程连接前仍需为 Host 端口配置 HTTPS 域名；安装完成后，使用脚本输出的 Host 地址和 Token 连接。

## 管理服务

```bash
~/.local/share/threadlight-self-host/bin/threadlight-self-host status
~/.local/share/threadlight-self-host/bin/threadlight-self-host logs
~/.local/share/threadlight-self-host/bin/threadlight-self-host restart
~/.local/share/threadlight-self-host/bin/threadlight-self-host stop
~/.local/share/threadlight-self-host/bin/threadlight-self-host show-token
```

如果只想在当前终端运行：

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh -s -- install --foreground
```

## 远程访问

默认监听 `127.0.0.1:7432`。远程服务器推荐保持回环监听并建立 SSH 隧道：

```bash
ssh -N -L 7432:127.0.0.1:7432 user@development-host
```

然后在本机打开 `http://127.0.0.1:7432`。

公网访问时，请用 Caddy、Nginx、Tailscale Serve 或其他反向代理终止 HTTPS，并让代理转发到回环端口：

```bash
curl -fsSL https://threadlight.xyz/install.sh | \
  sh -s -- install --public-url https://threadlight.example.com

caddy reverse-proxy \
  --from https://threadlight.example.com \
  --to http://127.0.0.1:7432
```

反向代理必须支持 WebSocket upgrade，且不能缓冲 `text/event-stream`。Bearer Token 只负责身份认证，不加密 HTTP；不要将 `7432` 明文暴露到公网。

## 路径与配置

| 内容       | 默认位置                               |
| ---------- | -------------------------------------- |
| 安装目录   | `~/.local/share/threadlight-self-host` |
| Host 配置  | `~/.config/threadlight/self-host.json` |
| Host 数据  | `~/.local/share/threadlight-self-host/data` |
| macOS 日志 | `~/.local/share/threadlight-self-host/logs/host.log` |

可以使用 `--host`、`--port`、`--name`、`--home`、`--public-url`、`--host-only` 和可重复的 `--origin` 覆盖默认值。项目统一在 UI 中管理。

从源码仓库运行时，安装器会先构建本地 Host + Web 包：

```bash
git clone https://github.com/nagisa77/threadlight.git
cd threadlight
npm run self-host -- install
```

## 安全与备份

- 配置和 Token 不应提交到 Git，也不会写入服务日志。
- Web 会把 Host 地址和 Token 保存到当前浏览器的 `localStorage`，不要在共享设备保存。
- 持有 Host Token 的客户端可以使用当前用户权限下的文件和终端能力，请按管理员凭据保护。
- 内置工具不是操作系统级 sandbox；请使用可信项目，强隔离请配合容器或虚拟机。
- 备份至少应包含 Host 数据目录和项目中的 `.threadlight` 目录。

单独部署 Web 或配置跨 Origin 访问时，参见 [Web 部署文档](./WEB_DEPLOYMENT.zh-CN.md)；Host 协议和源码运行参数见 [远程 Host 文档](./REMOTE_HOST.zh-CN.md)。
