# Self-host Threadlight Host + Web

The recommended deployment runs one native process that serves the Web UI, authenticated API, event stream, and terminal WebSocket. You manage one service, one port, and one access token.

## One-line install

Requirements: Node.js 22+, npm, `tar`, and macOS or Linux. The first build also needs enough free disk space for the repository dependencies.

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh
```

The installer:

1. Downloads a fresh archive of the latest `main` source.
2. Installs dependencies and builds Host + Web from that single source snapshot.
3. Installs the package for the current user without root.
4. Creates or reuses a 64-character random token in a mode-`0600` config.
5. Registers a systemd user service on Linux or launchd LaunchAgent on macOS.
6. Starts the service and prints the Web address and token.

The Host starts empty. Open the printed address, enter the token, and add projects from the Web UI using paths on the Host machine.

Run the same command again to rebuild and update both Host and Web from the latest `main` snapshot while preserving the token and existing configuration. Because the installer builds on the target machine, an update takes longer than downloading a prebuilt Release package.

To keep the bundled Web UI while also allowing the separately hosted Web client, use:

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh -s -- install --origin https://nagisa77.github.io
```

## Host-only install

When using the [hosted Threadlight Web client](https://nagisa77.github.io/threadlight/), install only the Host service with one command:

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh -s -- install --host-only --origin https://nagisa77.github.io
```

`--host-only` removes the bundled Web UI and keeps the Host API, event stream, and terminal WebSocket. The command also allows the hosted Web client's origin. Before connecting remotely, expose the Host port through an HTTPS domain, then connect with the Host URL and token printed by the installer.

## Manage the service

```bash
~/.local/share/threadlight-self-host/bin/threadlight-self-host status
~/.local/share/threadlight-self-host/bin/threadlight-self-host logs
~/.local/share/threadlight-self-host/bin/threadlight-self-host restart
~/.local/share/threadlight-self-host/bin/threadlight-self-host stop
~/.local/share/threadlight-self-host/bin/threadlight-self-host show-token
```

To run in the current terminal without installing a background service:

```bash
curl -fsSL https://threadlight.xyz/install.sh | sh -s -- install --foreground
```

## Remote access

The default listener is `127.0.0.1:7432`. For a remote server, keep the loopback binding and create an SSH tunnel:

```bash
ssh -N -L 7432:127.0.0.1:7432 user@development-host
```

Then open `http://127.0.0.1:7432` locally.

For public access, terminate HTTPS with Caddy, Nginx, Tailscale Serve, or another reverse proxy and forward it to the loopback port:

```bash
curl -fsSL https://threadlight.xyz/install.sh | \
  sh -s -- install --public-url https://threadlight.example.com

caddy reverse-proxy \
  --from https://threadlight.example.com \
  --to http://127.0.0.1:7432
```

The proxy must support WebSocket upgrades and must not buffer `text/event-stream`. A Bearer Token authenticates requests but does not encrypt HTTP; never expose port `7432` publicly over plaintext.

## Paths and configuration

| Content      | Default path                           |
| ------------ | -------------------------------------- |
| Installation | `~/.local/share/threadlight-self-host` |
| Host config  | `~/.config/threadlight/self-host.json` |
| Host data    | `~/.local/share/threadlight-self-host/data` |
| macOS log    | `~/.local/share/threadlight-self-host/logs/host.log` |

Use `--host`, `--port`, `--name`, `--home`, `--public-url`, `--host-only`, and repeatable `--origin` options to override defaults. Projects are managed in the UI.

When run from a source checkout, the installer builds the local Host + Web package first:

```bash
git clone https://github.com/nagisa77/threadlight.git
cd threadlight
npm run self-host -- install
```

The default `main` channel is intentionally mutable. For a pinned deployment, set `THREADLIGHT_SELF_HOST_VERSION` to an existing Release version, or set `THREADLIGHT_HOST_PACKAGE_URL` to a trusted package URL. `THREADLIGHT_SELF_HOST_SOURCE_URL` can point the source-build channel at another trusted archive with the same repository layout.

## Security and backups

- Never commit the config or token. The service does not write the token to its logs.
- The default installer executes dependency and build scripts from the latest `main`; use a pinned package channel when deployment policy requires reviewed, immutable inputs.
- The Web client stores its Host URL and token in browser `localStorage`; do not save them on shared devices.
- A client holding the Host token can use file and terminal capabilities with the current user's permissions. Protect it as an administrator credential.
- Built-in tools are not an operating-system sandbox. Use trusted projects or add container/VM isolation.
- Back up the Host data directory and project `.threadlight` directories.

For a separately deployed Web client or cross-origin access, see [Web deployment](./WEB_DEPLOYMENT.md). For Host protocol and source CLI details, see [Remote Host](./REMOTE_HOST.md).
