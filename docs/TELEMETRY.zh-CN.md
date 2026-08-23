# 匿名产品统计

Threadlight 1.1 只记录一条刻意收窄的第一方产品漏斗，用来区分问题究竟发生在曝光、安装还是首次使用。

## 事件

| 事件                     | 含义                               |
| ------------------------ | ---------------------------------- |
| `site_visited`           | 官网完成加载。                     |
| `download_clicked`       | 用户点击 macOS 下载入口。          |
| `install_command_copied` | 用户复制 Host 安装命令。           |
| `install_succeeded`      | 桌面端或自部署 Host 首次成功启动。 |
| `first_task_completed`   | 当前安装首次成功完成模型任务。     |

事件仅包含随机匿名安装 ID、事件 ID、事件名、时间、Threadlight 版本、粗粒度平台、来源（官网、桌面端、自部署或源码运行）、官网路径和启动方式。Threadlight **不会**发送 Prompt、回复、代码、项目名、文件路径、模型或 Provider 名、API Key、访问 Token、Host 名或 IP；Pages Function 也不会把 Cloudflare 请求元数据写入数据库。

官网和应用统一上报到第一方端点 `https://threadlight.xyz/api/events`，由 Cloudflare Pages 校验后写入 `threadlight-telemetry` D1 数据库。公开客户端中没有数据库凭据或统计密钥。

## 归因边界

官网的一行 Host 安装命令会把随机访客 ID 传入新安装的 Host，因此这条路径可以组成真正的匿名漏斗。DMG 下载无法安全地把浏览器本地状态带进桌面应用，所以桌面端的下载点击与激活只能比较聚合数量，不会逐个关联用户。

## 关闭统计

启动 Threadlight 前设置 `THREADLIGHT_TELEMETRY_DISABLED=1`。使用托管式自部署安装时，安装器会把该选择保存为 `<host-home>/telemetry-disabled`。已有桌面端或源码安装可创建 `~/.threadlight/telemetry-disabled`；删除该标记即可重新开启。

## 查询漏斗

只有 Cloudflare 账户所有者可以查询数据库：

```bash
npm run telemetry:report
```

仓库内的 SQL 会输出最近 30 天各阶段的匿名去重数、按来源/事件拆分的数据，以及每日趋势。应用数据库变更：

```bash
npx --yes wrangler@4.120.0 d1 migrations apply threadlight-telemetry --remote
```
