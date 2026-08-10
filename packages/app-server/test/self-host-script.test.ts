import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const installerPath = fileURLToPath(
  new URL("../../../scripts/self-host.sh", import.meta.url),
);
const installer = readFileSync(installerPath, "utf8");
const redirects = readFileSync(
  new URL("../../../apps/site/public/_redirects", import.meta.url),
  "utf8",
);
const sitePackage = readFileSync(
  new URL("../../../apps/site/package.json", import.meta.url),
  "utf8",
);
const copyScript = readFileSync(
  new URL("../../../scripts/copy-site-installer.mjs", import.meta.url),
  "utf8",
);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("one-line self-host installer", () => {
  it("is valid POSIX shell and documents an empty Host install", () => {
    execFileSync("sh", ["-n", installerPath]);
    const help = execFileSync("sh", [installerPath, "help"], {
      encoding: "utf8",
    });

    expect(help).toContain(
      "Download, install, configure, and start Host + Web",
    );
    expect(help).toContain("The Host starts empty");
    expect(help).toContain(
      "default: ~/.local/share/threadlight-self-host/data",
    );
    expect(help).not.toContain("--project");
    expect(installer).toContain("host_home=$RUNTIME_ROOT/data");
    expect(installer).toContain(".legacy-home-migrated");
    expect(installer).not.toContain("host_home=$HOME/.threadlight");
  });

  it("downloads the versioned Release package through a directly hosted entrypoint", () => {
    expect(installer).toContain(
      "releases/download/v$RELEASE_VERSION/threadlight-host-$RELEASE_VERSION.tgz",
    );
    expect(installer).toContain("https://threadlight.xyz/install.sh");
    expect(installer).toContain("systemctl --user enable --now");
    expect(installer).toContain("launchctl bootstrap");
    expect(installer).toContain("bootstrap_attempt=$((bootstrap_attempt + 1))");
    expect(redirects).not.toContain("/install.sh");
    expect(sitePackage).toContain("copy-site-installer.mjs");
    expect(copyScript).toContain("scripts/self-host.sh");
    expect(copyScript).toContain("apps/site/dist/install.sh");
  });

  it("migrates the old shared home into an isolated self-host directory", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-self-host-migrate-"));
    temporaryRoots.push(root);
    const configRoot = join(root, "config");
    const dataRoot = join(root, "data");
    const legacyHome = join(root, ".threadlight");
    const fakeBin = join(root, "bin");
    const fakePackage = join(root, "threadlight-host.tgz");
    const fakeNpm = join(fakeBin, "npm");
    const configPath = join(configRoot, "threadlight", "self-host.json");
    mkdirSync(join(configRoot, "threadlight"), { recursive: true });
    mkdirSync(legacyHome, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(legacyHome, "migration-sentinel"), "preserved\n");
    writeFileSync(fakePackage, "offline fixture\n");
    writeFileSync(
      configPath,
      `${JSON.stringify({
        token: "fixture-host-token",
        host: "127.0.0.1",
        port: 7432,
        home: legacyHome,
        name: "Fixture Host",
      })}\n`,
      { mode: 0o600 },
    );
    writeFileSync(
      fakeNpm,
      `#!/bin/sh
set -eu
prefix=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then
    prefix=$2
    shift 2
  else
    shift
  fi
done
mkdir -p "$prefix/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$prefix/bin/threadlight-host"
chmod 0755 "$prefix/bin/threadlight-host"
`,
    );
    chmodSync(fakeNpm, 0o755);

    execFileSync("sh", ["-s", "--", "install", "--foreground"], {
      encoding: "utf8",
      input: installer,
      env: {
        ...process.env,
        HOME: root,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        XDG_CONFIG_HOME: configRoot,
        XDG_DATA_HOME: dataRoot,
        THREADLIGHT_HOST_PACKAGE_URL: `file://${fakePackage}`,
        THREADLIGHT_SELF_HOST_SCRIPT_URL: `file://${installerPath}`,
      },
    });

    const isolatedHome = join(dataRoot, "threadlight-self-host", "data");
    const savedConfig = JSON.parse(readFileSync(configPath, "utf8")) as {
      home: string;
    };
    expect(savedConfig.home).toBe(isolatedHome);
    expect(existsSync(join(isolatedHome, "migration-sentinel"))).toBe(true);
    expect(existsSync(join(legacyHome, "migration-sentinel"))).toBe(true);
    expect(
      existsSync(join(dataRoot, "threadlight-self-host", ".legacy-home-migrated")),
    ).toBe(true);
  });
});
