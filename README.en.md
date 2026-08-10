<p align="center">
  <img src="./apps/desktop/resources/app-icon.png" width="96" height="96" alt="Threadlight icon">
</p>

<h1 align="center">Threadlight</h1>

<p align="center">An open-source multi-agent engineering runtime that keeps planning, delegation, tools, terminals, files, diffs, and delivery on one observable, recoverable task timeline.</p>

<p align="center">
  <a href="./README.md">中文</a> ·
  <a href="https://threadlight.xyz">Website</a> ·
  <a href="./docs/SELF_HOSTING.md">Self-hosting guide</a>
</p>

<p align="center">
  <img src="./docs/images/threadlight-overview.png" width="1200" alt="Threadlight multi-agent engineering workspace">
</p>

## Quick start

### Recommended: self-host Host + Web

Requires Node.js 22+ on macOS or Linux:

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh
```

The installer downloads Host + Web, creates a random token, and registers a launchd or systemd user service. The Host starts empty; open the printed address, enter the token, and add projects from the UI.

```bash
~/.local/share/threadlight-self-host/bin/threadlight-self-host status
~/.local/share/threadlight-self-host/bin/threadlight-self-host logs
~/.local/share/threadlight-self-host/bin/threadlight-self-host show-token
```

The default listener is `127.0.0.1:7432`. For remote access, use an SSH tunnel, VPN, or HTTPS reverse proxy instead of exposing plaintext HTTP publicly.

### macOS desktop app

[Download the unsigned Apple Silicon test DMG](https://github.com/nagisa77/threadlight/releases/download/v1.0.0/Threadlight-1.0.0-macOS-arm64-unsigned-test.dmg)

This is an **unsigned test build**. After installation, Control-click Threadlight in Finder and choose Open. If macOS still blocks it, use System Settings → Privacy & Security → Open Anyway.

```text
SHA-256: 838f0a26e9f575cdb33e694b4fa923d865bde060581ab45104ae2f2266d74e0a
```

### Web client

[Open Threadlight Web](https://nagisa77.github.io/threadlight/)

The Web client does not provide an execution environment. Self-host a Host first, expose its port through an HTTPS domain, and connect with the Host URL and token.

## Capabilities

| Capability                | What Threadlight provides                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Multi-agent orchestration | A root agent can delegate, follow up, wait, retry, interrupt, and collect child-agent results.            |
| Controlled Plan mode      | Read-only research comes first; execution advances against acceptance evidence and cannot finish early.   |
| Observable execution      | Plans, model output, tool calls, command logs, file changes, sources, and token usage remain visible.     |
| Engineering workspace     | Conversation, Git worktrees, files, diffs, terminals, review, commits, pushes, and PRs share one context. |
| Provider-neutral core     | The Agent Loop does not depend on vendor wire formats; model protocols live in separate adapters.         |
| Local and remote Hosts    | Desktop and Web share one protocol while code, models, terminals, and data stay on the target machine.    |
| Skills, Plugins, and MCP  | Discoverable capabilities compose explicitly and are snapshotted with each task.                          |
| Recoverable state         | Conversations, agent trees, and opaque model state persist across tool turns and interrupted runs.        |

Built-in tools run with the current user's permissions and are not an operating-system sandbox. Use trusted workspaces or add container/VM isolation.

Apache-2.0 · [Source](https://github.com/nagisa77/threadlight) · [Contributing](./CONTRIBUTING.md)
