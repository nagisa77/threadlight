#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JsonLineRuntimePeer } from "./remote-runtime-peer.js";
import { RemoteRuntimeServer } from "./remote-runtime-server.js";

const args = parseArgs(process.argv.slice(2));
const token = args.token ?? process.env.THREADLIGHT_RUNTIME_TOKEN;
if (!token) {
  process.stderr.write(
    "THREADLIGHT_RUNTIME_TOKEN or --token is required. The token is never printed.\n",
  );
  process.exit(1);
}

const workspaceRoot = resolve(args.workspace ?? process.cwd());
const entry = fileURLToPath(new URL("./bin.js", import.meta.url));
const peer = new JsonLineRuntimePeer({
  entry,
  cwd: workspaceRoot,
  onLog: (message) => process.stderr.write(`[app-server] ${message}\n`),
});
const runtime = new RemoteRuntimeServer({
  peer,
  token,
  workspaceRoot,
  host: args.host,
  port: args.port,
  allowedOrigin: args.origin,
});
const address = await runtime.start();

process.stderr.write(
  `Threadlight Remote Runtime listening on http://${address.host}:${address.port}\n`,
);
process.stderr.write(`Workspace: ${workspaceRoot}\n`);
if (address.host !== "127.0.0.1" && address.host !== "::1") {
  process.stderr.write(
    "Warning: HTTP is not encrypted. Use an SSH tunnel, VPN, or TLS reverse proxy on untrusted networks.\n",
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runtime.stop().finally(() => process.exit(0));
  });
}

interface RuntimeArgs {
  host?: string;
  port?: number;
  workspace?: string;
  token?: string;
  origin?: string;
}

function parseArgs(values: string[]): RuntimeArgs {
  const result: RuntimeArgs = {};
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      flag !== "--host" &&
      flag !== "--port" &&
      flag !== "--workspace" &&
      flag !== "--token" &&
      flag !== "--origin"
    ) {
      throw new Error(`Unknown Remote Runtime option: ${flag}`);
    }
    if (!value) throw new Error(`Missing value for ${flag}`);
    index += 1;
    if (flag === "--host") result.host = value;
    if (flag === "--workspace") result.workspace = value;
    if (flag === "--token") result.token = value;
    if (flag === "--origin") result.origin = value;
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
