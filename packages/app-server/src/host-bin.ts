#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HostCliUsageError,
  hostCliUsage,
  parseHostCli,
  type HostArgs,
  type HostCliCommand,
} from "./host-cli-options.js";
import { readHostConfig } from "./host-config.js";

const command = readCliCommand(process.argv.slice(2));
if (command.action === "help") {
  process.stdout.write(hostCliUsage());
  process.exit(0);
}
if (command.action === "version") {
  try {
    process.stdout.write(`threadlight-host ${installedHostVersion()}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`Error: ${errorMessage(error)}\n`);
    process.exit(1);
  }
}

try {
  await startHost(command.args);
} catch (error) {
  process.stderr.write(`Error: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}

async function startHost(args: HostArgs): Promise<void> {
  args = resolveHostArgs(args);
  const servedWebRoot = webRoot(args);
  const publicUrl = args.publicUrl ?? process.env.THREADLIGHT_HOST_PUBLIC_URL;
  const oauthCallbackUrlPrefix = publicUrl
    ? `${normalizePublicUrl(publicUrl)}/v1/host/oauth/callback`
    : undefined;
  const token = args.token ?? process.env.THREADLIGHT_HOST_TOKEN;
  if (!token) {
    throw new Error(
      "An access token is required. Set THREADLIGHT_HOST_TOKEN or pass --token.",
    );
  }

  const [
    {
      ProductTelemetry,
      ProjectStore,
      SettingsStore,
      productTelemetryEnabled,
      runtimeEnvironment,
    },
    { TerminalSessionManager },
    { createHostSecretCodec },
    { HostConnectionService, HostConnectionStore },
    { ThreadlightHostServer },
    { hostTerminalEnvironment },
    { JsonLineRuntimePeer },
  ] = await Promise.all([
    import("@threadlight/host-core"),
    import("@threadlight/terminal-core"),
    import("./host-secret-codec.js"),
    import("./host-connection-service.js"),
    import("./host-server.js"),
    import("./host-terminal-environment.js"),
    import("./remote-runtime-peer.js"),
  ]);

  const homePath = resolve(
    args.home ??
      process.env.THREADLIGHT_HOME ??
      join(homedir(), ".threadlight"),
  );
  const appVersion = installedHostVersion();
  const productTelemetry = new ProductTelemetry({
    homePath,
    source: "self_host",
    appVersion,
    enabled: productTelemetryEnabled(),
    attributionId: process.env.THREADLIGHT_TELEMETRY_ID,
    endpoint: process.env.THREADLIGHT_TELEMETRY_ENDPOINT,
  });
  const projects = new ProjectStore(join(homePath, "project-map.json"), {
    standaloneRoot: join(homePath, "standalone"),
  });
  const secretCodec = createHostSecretCodec(join(homePath, "host-secret.key"));
  const settings = new SettingsStore(
    join(homePath, "settings.json"),
    secretCodec,
  );
  const connections = new HostConnectionStore(
    join(homePath, "connection-store.json"),
    secretCodec,
  );
  if (args.project) projects.register(resolve(args.project));

  const entry = fileURLToPath(new URL("./bin.js", import.meta.url));
  let server: InstanceType<typeof ThreadlightHostServer>;
  server = new ThreadlightHostServer({
    token,
    hostId: readOrCreateHostId(join(homePath, "host-id")),
    name: args.name?.trim() || hostname(),
    homePath,
    projects,
    settings,
    host: args.host,
    port: args.port,
    allowedOrigins: args.origins,
    ...(servedWebRoot ? { webRoot: servedWebRoot } : {}),
    ...(oauthCallbackUrlPrefix ? { oauthCallbackUrlPrefix } : {}),
    acceptOAuthCallback: (input) =>
      connections.acceptAuthorizationCallback(input),
    createPeer: ({
      projectId,
      projectRoot,
      projectBasePath,
      oauthCallbackUrlPrefix,
    }) => {
      const connectionService = new HostConnectionService(connections, (url) =>
        server.publishConnectorAuthorization(projectId, url),
      );
      return new JsonLineRuntimePeer({
        entry,
        cwd: projectRoot,
        environment: {
          ...runtimeEnvironment(settings.runtimeSettings()),
          THREADLIGHT_HOME: homePath,
          THREADLIGHT_APP_VERSION: appVersion,
          THREADLIGHT_TELEMETRY_SOURCE: "self_host",
          THREADLIGHT_PROJECT_ROOT: projectBasePath,
          ...(projects.project(projectId)?.scope === "standalone"
            ? { THREADLIGHT_TASK_SCOPE: "standalone" }
            : {}),
          THREADLIGHT_CONNECTION_RPC_FD: "3",
          ...(oauthCallbackUrlPrefix
            ? {
                THREADLIGHT_OAUTH_CALLBACK_URL_PREFIX: oauthCallbackUrlPrefix,
              }
            : {}),
          THREADLIGHT_ATTACHMENT_ROOT: join(
            projectBasePath,
            ".threadlight",
            "uploads",
          ),
        },
        onLog: (message) => process.stderr.write(`[app-server] ${message}\n`),
        handleConnectionRequest: (request) => connectionService.handle(request),
      });
    },
    createTerminalSessions: (send) =>
      new TerminalSessionManager(send, {
        environment: hostTerminalEnvironment(process.env),
        maxSessions: 16,
      }),
  });
  const address = await server.start();
  void productTelemetry.reportOnce("install_succeeded");

  process.stderr.write(
    `Threadlight Host listening on http://${address.host}:${address.port}\n`,
  );
  process.stderr.write(`Data: ${homePath}\n`);
  if (servedWebRoot) {
    const webUrl = publicUrl
      ? normalizePublicUrl(publicUrl)
      : `http://${displayHost(address.host)}:${address.port}`;
    process.stderr.write(`Web UI: ${webUrl}\n`);
  }
  if (address.host !== "127.0.0.1" && address.host !== "::1") {
    process.stderr.write(
      "Warning: HTTP is not encrypted. Use an SSH tunnel, VPN, or TLS reverse proxy on untrusted networks.\n",
    );
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void server.stop().finally(() => process.exit(0));
    });
  }
}

function readCliCommand(values: string[]): HostCliCommand {
  try {
    return parseHostCli(values);
  } catch (error) {
    if (!(error instanceof HostCliUsageError)) throw error;
    process.stderr.write(
      `Error: ${error.message}\n\nUsage: threadlight-host [options]\nRun 'threadlight-host --help' for details.\n`,
    );
    process.exit(2);
  }
}

function installedHostVersion(): string {
  for (const url of [
    new URL("../package.json", import.meta.url),
    new URL("./package.json", import.meta.url),
  ]) {
    try {
      const value = JSON.parse(readFileSync(url, "utf8")) as {
        version?: unknown;
      };
      if (typeof value.version === "string" && value.version.trim()) {
        return value.version;
      }
    } catch {
      // The bundled and workspace layouts keep package.json in different places.
    }
  }
  throw new Error("Unable to read the installed Host version.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("--public-url must use http or https");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function resolveHostArgs(args: HostArgs): HostArgs {
  const configPath = args.config ?? process.env.THREADLIGHT_HOST_CONFIG;
  const config = configPath ? readHostConfig(configPath) : {};
  return {
    config: configPath,
    host: args.host ?? config.host,
    port: args.port ?? config.port,
    home: args.home ?? process.env.THREADLIGHT_HOME ?? config.home,
    project: args.project ?? config.project,
    token: args.token ?? process.env.THREADLIGHT_HOST_TOKEN ?? config.token,
    origins: args.origins.length > 0 ? args.origins : (config.origins ?? []),
    name: args.name ?? config.name,
    publicUrl:
      args.publicUrl ??
      process.env.THREADLIGHT_HOST_PUBLIC_URL ??
      config.publicUrl,
    webRoot: args.webRoot ?? process.env.THREADLIGHT_WEB_ROOT ?? config.webRoot,
  };
}

function webRoot(args: HostArgs): string | undefined {
  if (args.webRoot) return resolve(args.webRoot);
  const bundled = fileURLToPath(new URL("./web", import.meta.url));
  return existsSync(join(bundled, "index.html")) ? bundled : undefined;
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

function readOrCreateHostId(path: string): string {
  if (existsSync(path)) {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const id = randomUUID();
  writeFileSync(path, `${id}\n`, { encoding: "utf8", mode: 0o600 });
  return id;
}
