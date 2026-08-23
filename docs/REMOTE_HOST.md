# Threadlight Host

> [!TIP]
> If you want people to use a complete Host + Web deployment directly in a browser, start with the [all-in-one self-hosting guide](./SELF_HOSTING.md). This document covers remote desktop connections, source-based startup, and Host protocol details.

Threadlight Host is the headless remote service layer. It is not a Runtime for one project; it represents a complete Threadlight work host:

- Host-level data lives in remote `~/.threadlight`.
- The project list, task index, model settings, and API keys belong to that Host.
- Project-specific data such as conversations and memory still lives in each remote project's `.threadlight` directory.
- The desktop app shows projects and settings for only the active Host. Switching back to Local Host restores the local workspace domain.
- Local and remote modes run the same ProjectStore, SettingsStore, and app-server code.

## Start from a source checkout

```bash
npm install

export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --name "Build server"
```

`host:dev` builds the shared packages before starting the Host from the source checkout. Run it again after changing the code.

After the first connection, enter a remote absolute path in the desktop app to add a project. The Host records projects in remote `~/.threadlight/project-map.json`. The Settings page reads and writes remote `~/.threadlight/settings.json`. API keys are encrypted with a Host-local key at `~/.threadlight/host-secret.key`, whose file mode is `0600`.

### Simulate another Host on the same machine

The desktop app's Local Host and a standalone Host started by the same user both use `~/.threadlight` by default. To simulate two hosts with isolated settings on one machine, give the development Host its own data directory:

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
npm run host:dev -- \
  --home "$HOME/.threadlight-host-dev" \
  --host 127.0.0.1 \
  --port 7432 \
  --name "Local development Host"
```

After connecting to `http://127.0.0.1:7432`, that Host keeps its project index, settings, API keys, and Host ID in `~/.threadlight-host-dev`; it does not read the desktop Local Host's data. A real remote machine can continue using the default `~/.threadlight` directory.

If an older version already shared one settings file between the two modes, the current version shows keys that the active Host cannot decrypt as unconfigured instead of failing the entire Settings page. Re-enter those API keys in the target Host's Settings page.

Available options:

- `--host`: listen address; defaults to `127.0.0.1`.
- `--port`: listen port; defaults to `7432`.
- `--home`: Host data directory; defaults to `~/.threadlight`.
- `--name`: Host name displayed by the desktop app.
- `--project`: optionally register one project path at startup.
- `--token`: access token; `THREADLIGHT_HOST_TOKEN` is also supported.
- `--origin`: optional allowed Web Origin; repeat it to allow multiple Origins.

## Package and deploy

Build a standalone npm package without UI or Electron on the development machine:

```bash
npm run host:package
```

The output is `artifacts/threadlight-host-1.1.0.tgz`. It contains bundled Host, app-server, and command-client entrypoints plus the built-in skills and plugins. Copy it to the remote machine, then run:

```bash
npm install -g ./threadlight-host-1.1.0.tgz

export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
threadlight-host --host 127.0.0.1 --port 7432
```

Node.js 22 or newer is required; Electron and a desktop environment are not. Remote terminals use `node-pty`. If the target platform has no matching prebuilt binary, installation also needs Python, make, and a C++ compiler. On Debian or Ubuntu, install them first:

```bash
sudo apt install -y python3 make build-essential
```

`artifacts/` is a reproducible local build directory. It is listed in `.gitignore` and must not be committed.

## Send tasks from the command line

The Host npm package also installs the `threadlight` command. Use the same Host token to list registered projects. Prefer environment variables so the token does not enter shell history:

```bash
export THREADLIGHT_HOST_URL=https://tim-france-vps.threadlight.xyz
export THREADLIGHT_HOST_TOKEN='your-token'

threadlight projects
```

For a project task, `--project` accepts an exact id, project name, or remote absolute path from `threadlight projects`:

```bash
threadlight run \
  --project /srv/my-project \
  --worktree \
  'Fix the failing tests and explain the changes'
```

Use Host-managed standalone storage for a task that does not belong to a project:

```bash
threadlight run --standalone 'Research this issue and report the conclusion'
```

Continue an existing task with its task/thread id. Add `--project` only if that id is ambiguous on the Host:

```bash
threadlight run --thread 7a5b… 'Continue and run the tests'
```

By default, the CLI confirms each non-destructive write in an interactive terminal and denies writes when stdin is not interactive. `--yes` approves non-destructive writes while retaining the destructive-operation block. Only explicit `--full-access` bypasses the execution safety policy. `--json` prints script-friendly Host, project, thread, turn, status, and result data. The prompt can also be piped on stdin.

## SSH connection

Keep the Host bound to the remote loopback interface and open an SSH tunnel:

```bash
ssh -N -L 7432:127.0.0.1:7432 user@development-host
```

Connect the desktop app to `http://127.0.0.1:7432` with the same token. After the switch, the local app-server stops and the sidebar shows only projects from that Host. Choose Local Host in the Host picker to switch back.

## Network boundary

The Bearer token authenticates requests; it does not encrypt HTTP content. Across an untrusted network, use an SSH tunnel, VPN, or HTTPS reverse proxy. The Host does not print its token or write API keys to logs.

## HTTP protocol

The Host protocol version is 4:

- `GET /v1/health`: Host identity and protocol negotiation.
- `/v1/host/projects/*`: Host-level project and task index.
- `GET /v1/host/directories`: remote directory completion for the desktop project-path popover.
- `GET /v1/host/files`: list Host files and directories for the desktop remote-file picker.
- `GET /v1/host/file`: read a selected Host file for desktop preview.
- `/v1/host/settings`: isolated Host settings.
- `/v1/projects/:projectId/runtime/*`: project app-server RPC, events, and workspace review.

The project ID is part of the runtime route, so one port can serve multiple Threadlight projects at the same time.

After connecting to a remote Host, Open system file automatically becomes Open remote file. Browsing and reading happen on the Host; the desktop app does not open local Finder or read a local path with the same name. As with remote terminals, a client holding the Host token can read files available to the Host user.

## Remote terminal

When connected to a remote Host, the bottom terminal starts in the remote project or its task workspace, not on the desktop machine. The UI is the same as a local terminal; input, dimensions, and output travel through a Host-token-authenticated WebSocket:

- The WebSocket path is `/v1/host/terminal`.
- The desktop app sends the `Authorization` header. The browser sends an encoded token through `Sec-WebSocket-Protocol`, so the token does not enter the URL.
- One connection can carry multiple terminal tabs.
- Terminals can start only in projects registered by the Host and task workspaces recorded by the server. A client cannot submit an arbitrary working directory.
- When the WebSocket disconnects, every PTY owned by that connection closes so the Host does not retain orphaned shells.
- The Host does not pass `THREADLIGHT_HOST_TOKEN` into the terminal environment.

A terminal is an interactive shell with the Host user's permissions. A client holding the Host token therefore has remote command-execution capability. Protect the token and continue using the Host through an SSH tunnel, VPN, or HTTPS/WSS.
