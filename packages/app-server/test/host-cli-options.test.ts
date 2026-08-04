import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HostCliUsageError,
  hostCliUsage,
  parseHostArgs,
  parseHostCli,
} from "../src/host-cli-options.js";

const hostEntry = fileURLToPath(
  new URL("../dist/host-bin.js", import.meta.url),
);

describe("parseHostArgs", () => {
  it("collects every repeated --origin value", () => {
    expect(
      parseHostArgs([
        "--origin",
        "http://localhost:5173",
        "--host",
        "0.0.0.0",
        "--origin",
        "http://192.168.50.186:5173",
      ]),
    ).toMatchObject({
      host: "0.0.0.0",
      origins: [
        "http://localhost:5173",
        "http://192.168.50.186:5173",
      ],
    });
  });

  it("keeps a single --origin compatible", () => {
    expect(
      parseHostArgs(["--origin", "http://localhost:5173"]).origins,
    ).toEqual(["http://localhost:5173"]);
  });

  it("recognizes long and short help and version flags", () => {
    expect(parseHostCli(["--help"])).toEqual({ action: "help" });
    expect(parseHostCli(["-h"])).toEqual({ action: "help" });
    expect(parseHostCli(["--version"])).toEqual({ action: "version" });
    expect(parseHostCli(["-v"])).toEqual({ action: "version" });
  });

  it("describes every supported option without exposing a token", () => {
    const usage = hostCliUsage();

    expect(usage).toContain("Usage: threadlight-host [options]");
    expect(usage).toContain("--public-url <url>");
    expect(usage).toContain("--help");
    expect(usage).toContain("--version");
    const configuredToken = process.env.THREADLIGHT_HOST_TOKEN;
    if (configuredToken) expect(usage).not.toContain(configuredToken);
  });

  it("rejects unknown options, missing values, and malformed ports", () => {
    expect(() => parseHostArgs(["--unknown"])).toThrow(
      new HostCliUsageError("Unknown option: --unknown"),
    );
    expect(() => parseHostArgs(["--host", "--port", "7432"])).toThrow(
      "Missing value for --host",
    );
    expect(() => parseHostArgs(["--port", "7432oops"])).toThrow(
      "Invalid value for --port: 7432oops",
    );
  });

  it("prints help and version with successful process exit codes", () => {
    const help = runHost("--help");
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: threadlight-host [options]");
    expect(help.stderr).toBe("");

    const packageVersion = (
      JSON.parse(
        readFileSync(
          new URL("../package.json", import.meta.url),
          "utf8",
        ),
      ) as { version: string }
    ).version;
    const version = runHost("--version");
    expect(version.status).toBe(0);
    expect(version.stdout).toBe(`threadlight-host ${packageVersion}\n`);
    expect(version.stderr).toBe("");
  });

  it("uses exit code 2 for usage errors without printing a stack", () => {
    const result = runHost("--unknown");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Error: Unknown option: --unknown");
    expect(result.stderr).toContain("Usage: threadlight-host [options]");
    expect(result.stderr).toContain("threadlight-host --help");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("uses exit code 1 for missing runtime configuration without a stack", () => {
    const result = runHost();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("An access token is required");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });
});

function runHost(...args: string[]) {
  const environment = { ...process.env };
  delete environment.THREADLIGHT_HOST_TOKEN;
  return spawnSync(process.execPath, [hostEntry, ...args], {
    encoding: "utf8",
    env: environment,
  });
}
