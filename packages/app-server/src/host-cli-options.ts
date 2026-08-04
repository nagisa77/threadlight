export interface HostArgs {
  host?: string;
  port?: number;
  home?: string;
  project?: string;
  token?: string;
  origins: string[];
  name?: string;
  publicUrl?: string;
}

export type HostCliCommand =
  | { action: "run"; args: HostArgs }
  | { action: "help" }
  | { action: "version" };

export class HostCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostCliUsageError";
  }
}

const VALUE_OPTIONS = new Set([
  "--host",
  "--port",
  "--home",
  "--project",
  "--token",
  "--origin",
  "--name",
  "--public-url",
]);

export function parseHostCli(values: string[]): HostCliCommand {
  if (values.includes("--help") || values.includes("-h")) {
    return { action: "help" };
  }
  if (values.includes("--version") || values.includes("-v")) {
    return { action: "version" };
  }
  return { action: "run", args: parseHostArgs(values) };
}

export function parseHostArgs(values: string[]): HostArgs {
  const result: HostArgs = { origins: [] };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]!;
    if (!VALUE_OPTIONS.has(flag)) {
      throw new HostCliUsageError(
        flag.startsWith("-")
          ? `Unknown option: ${flag.split("=", 1)[0]}`
          : "Unexpected positional argument.",
      );
    }
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new HostCliUsageError(`Missing value for ${flag}`);
    }
    index += 1;
    if (flag === "--host") result.host = value;
    if (flag === "--home") result.home = value;
    if (flag === "--project") result.project = value;
    if (flag === "--token") result.token = value;
    if (flag === "--origin") result.origins.push(value);
    if (flag === "--name") result.name = value;
    if (flag === "--public-url") result.publicUrl = value;
    if (flag === "--port") {
      const port = Number(value);
      if (!/^\d+$/.test(value) || port > 65_535) {
        throw new HostCliUsageError(
          `Invalid value for --port: ${value}. Expected an integer from 0 to 65535.`,
        );
      }
      result.port = port;
    }
  }
  return result;
}

export function hostCliUsage(): string {
  return `Usage: threadlight-host [options]

Run the headless Threadlight Host for local or remote projects.

Options:
  --host <address>     Listen address (default: 127.0.0.1)
  --port <port>        Listen port, 0-65535 (default: 7432)
  --home <path>        Host data directory (default: ~/.threadlight)
  --project <path>     Register a project when the Host starts
  --token <token>      Client access token (or THREADLIGHT_HOST_TOKEN)
  --origin <url>       Allowed Web origin; may be repeated
  --name <name>        Host name shown to clients
  --public-url <url>   Public HTTP(S) URL used for OAuth callbacks
  -h, --help           Show this help
  -v, --version        Show the installed version

Environment:
  THREADLIGHT_HOST_TOKEN       Client access token
  THREADLIGHT_HOME             Host data directory
  THREADLIGHT_HOST_PUBLIC_URL  Public HTTP(S) URL for OAuth callbacks

Security:
  Use an SSH tunnel, VPN, or TLS reverse proxy on untrusted networks.
  Tokens and API keys are never printed.
`;
}
