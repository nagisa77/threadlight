# Threadlight Web deployment

> [!TIP]
> For new deployments, prefer the [all-in-one Host + Web setup](./SELF_HOSTING.md). The Web client is bundled with the Host and served from the same port, so it needs neither a separate Nginx deployment nor cross-origin CORS configuration. This document is for advanced deployments that keep the static Web site separate from the Host.

Threadlight Web reuses the same `@threadlight/ui` package as the desktop app. The browser implements only remote Host connection, project switching, HTTP/SSE Runtime access, remote files, and WebSocket terminal adapters. The Web process does not start a Host or access local projects on the Web deployment server.

## Local development

Start a remote Host that allows the Vite Origins first:

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"

npm run host:dev -- \
  --host 0.0.0.0 \
  --port 7432 \
  --origin http://localhost:5173 \
  --origin http://192.168.50.186:5173
```

Start the Web client in another terminal:

```bash
VITE_THREADLIGHT_HOST_URL=http://192.168.50.186:7432 npm run web:dev -- --host 0.0.0.0
```

Open `http://localhost:5173` on the computer or `http://192.168.50.186:5173` on another device on the same LAN, then enter the `THREADLIGHT_HOST_TOKEN` from above. Replace the example LAN IP with the Host machine's actual address. Add projects from the UI after connecting.

The Host URL and access token are stored together in the browser's `localStorage` Host records. Threadlight keeps the 12 most recent Hosts by default. Signing out does not clear those records, so you can reconnect quickly; you can also select, edit, or remove saved Hosts from the login page. Records are never written into source code or the production bundle.

## Production build and static deployment

The following command prefills a public Host address on the connection page. The address is not a secret. Never inject a token through a `VITE_*` variable.

```bash
npm ci
VITE_THREADLIGHT_HOST_URL=https://host.example.com npm run web:build
```

Static output is written to `apps/web/dist`. For example, serve it with an Nginx container:

```bash
docker run -d \
  --name threadlight-web \
  --restart unless-stopped \
  -p 8080:80 \
  -v "$PWD/apps/web/dist:/usr/share/nginx/html:ro" \
  -v "$PWD/apps/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine
```

The mounted Nginx configuration includes an SPA fallback, so directly refreshing `/tasks/:threadId` still loads the Web app and restores the corresponding task.

For a subpath deployment, set the base path at build time:

```bash
THREADLIGHT_WEB_BASE_PATH=/threadlight/ npm run web:build
```

### GitHub Pages + Tailscale Serve

The repository's `Deploy Web Client to GitHub Pages` workflow deploys the Web client to GitHub Pages after `main` changes. The build does not prefill a Host address. A phone must join the same Tailscale tailnet as the Host machine, then connect to that machine's Tailscale HTTPS address.

GitHub Pages uses HTTPS, so the browser cannot connect from that page to a plaintext HTTP Host. Keep the Host bound to loopback and allow the GitHub Pages Origin:

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"
printf 'Threadlight token: %s\n' "$THREADLIGHT_HOST_TOKEN"

npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --origin https://nagisa77.github.io \
  --public-url https://your-mac.example-tailnet.ts.net \
  --name "Tailscale Host"
```

In another terminal, expose an HTTPS/WSS endpoint inside the tailnet with Tailscale Serve:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 7432
```

Open the GitHub Pages address on the phone and enter the token printed above. Inspect or remove the proxy configuration with:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset
```

## Production Host command

An HTTPS Web page can connect only to an HTTPS/WSS Host. Bind the Host to loopback, then publish it through a TLS reverse proxy:

```bash
export THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)"

npm run host:dev -- \
  --host 127.0.0.1 \
  --port 7432 \
  --origin https://threadlight.example.com \
  --name "Production Host"
```

For a packaged Host, replace `npm run host:dev --` with `threadlight-host`. Every `--origin` must exactly match its browser address, including scheme and port. Repeat the option to allow multiple addresses.

For example, terminate TLS with Caddy:

```bash
caddy reverse-proxy \
  --from https://host.example.com \
  --to http://127.0.0.1:7432
```

The reverse proxy must support WebSocket upgrades and must not buffer the `text/event-stream` Runtime event stream. Never expose the Host's plaintext port 7432 directly to an untrusted network.

## Available capabilities

The Web client reuses the desktop UI. It supports remote projects and tasks, model settings, project Memory, Workspace browsing and Diff, remote system files, safe-execution approval, and remote terminals. Local capabilities that depend on Electron or macOS—Finder, Computer Use, local attachment staging, voice transcription, and local automation scheduling—do not pretend to be available in the browser.
