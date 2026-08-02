#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProjectStore,
  SettingsStore,
  runtimeEnvironment,
} from "@threadlight/host-core";
import { TerminalSessionManager } from "@threadlight/terminal-core";

import { createHostSecretCodec } from "./host-secret-codec.js";
import {
  HostConnectionService,
  HostConnectionStore,
} from "./host-connection-service.js";
import { ThreadlightHostServer } from "./host-server.js";
import { hostTerminalEnvironment } from "./host-terminal-environment.js";
import { JsonLineRuntimePeer } from "./remote-runtime-peer.js";

const args = parseArgs(process.argv.slice(2));
const publicUrl =
  args.publicUrl ?? process.env.THREADLIGHT_HOST_PUBLIC_URL;
const token =
  args.token ??
  process.env.THREADLIGHT_HOST_TOKEN;
if (!token) {
  process.stderr.write(
    "THREADLIGHT_HOST_TOKEN or --token is required. The token is never printed.\n",
  );
  process.exit(1);
}

const homePath = resolve(
  args.home ??
    process.env.THREADLIGHT_HOME ??
    join(homedir(), ".threadlight"),
);
const projects = new ProjectStore(join(homePath, "project-map.json"), {
  standaloneRoot: join(homePath, "standalone"),
});
const secretCodec = createHostSecretCodec(
  join(homePath, "host-secret.key"),
);
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
let server: ThreadlightHostServer;
server = new ThreadlightHostServer({
  token,
  hostId: readOrCreateHostId(join(homePath, "host-id")),
  name: args.name?.trim() || hostname(),
  homePath,
  projects,
  settings,
  host: args.host,
  port: args.port,
  allowedOrigin: args.origin,
  ...(publicUrl
    ? {
        oauthCallbackUrlPrefix:
          `${normalizePublicUrl(publicUrl)}/v1/host/oauth/callback`,
      }
    : {}),
  acceptOAuthCallback: (input) =>
    connections.acceptAuthorizationCallback(input),
  createPeer: ({
    projectId,
    projectRoot,
    projectBasePath,
    oauthCallbackUrlPrefix,
  }) => {
    const connectionService = new HostConnectionService(
      connections,
      (url) => server.publishConnectorAuthorization(projectId, url),
    );
    return new JsonLineRuntimePeer({
      entry,
      cwd: projectRoot,
      environment: {
        ...runtimeEnvironment(settings.runtimeSettings()),
        THREADLIGHT_PROJECT_ROOT: projectBasePath,
        ...(projects.project(projectId)?.scope === "standalone"
          ? { THREADLIGHT_TASK_SCOPE: "standalone" }
          : {}),
        THREADLIGHT_CONNECTION_RPC_FD: "3",
        ...(oauthCallbackUrlPrefix
          ? {
              THREADLIGHT_OAUTH_CALLBACK_URL_PREFIX:
                oauthCallbackUrlPrefix,
            }
          : {}),
        THREADLIGHT_ATTACHMENT_ROOT: join(
          projectBasePath,
          ".threadlight",
          "uploads",
        ),
      },
      onLog: (message) => process.stderr.write(`[app-server] ${message}\n`),
      handleConnectionRequest: (request) =>
        connectionService.handle(request),
    });
  },
  createTerminalSessions: (send) =>
    new TerminalSessionManager(send, {
      environment: hostTerminalEnvironment(process.env),
      maxSessions: 16,
    }),
});
const address = await server.start();

process.stderr.write(
  `Threadlight Host listening on http://${address.host}:${address.port}\n`,
);
process.stderr.write(`Data: ${homePath}\n`);
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

interface HostArgs {
  host?: string;
  port?: number;
  home?: string;
  project?: string;
  token?: string;
  origin?: string;
  name?: string;
  publicUrl?: string;
}

function parseArgs(values: string[]): HostArgs {
  const result: HostArgs = {};
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      flag !== "--host" &&
      flag !== "--port" &&
      flag !== "--home" &&
      flag !== "--project" &&
      flag !== "--token" &&
      flag !== "--origin" &&
      flag !== "--name" &&
      flag !== "--public-url"
    ) {
      throw new Error(`Unknown Threadlight Host option: ${flag}`);
    }
    if (!value) throw new Error(`Missing value for ${flag}`);
    index += 1;
    if (flag === "--host") result.host = value;
    if (flag === "--home") result.home = value;
    if (flag === "--project") result.project = value;
    if (flag === "--token") result.token = value;
    if (flag === "--origin") result.origin = value;
    if (flag === "--name") result.name = value;
    if (flag === "--public-url") result.publicUrl = value;
    if (flag === "--port") {
      const port = Number.parseInt(value, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid port: ${value}`);
      }
      result.port = port;
    }
  }
  return result;
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
