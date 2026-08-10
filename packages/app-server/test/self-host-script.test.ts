import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
    expect(help).toContain("--host-only");
    expect(help).not.toContain("--project");
    expect(installer).toContain("host_home=$RUNTIME_ROOT/data");
    expect(installer).toContain(".legacy-home-migrated");
    expect(installer).toContain(
      "$RUNTIME_ROOT/lib/node_modules/@threadlight/host/web",
    );
    expect(installer).not.toContain("host_home=$HOME/.threadlight");
  });

  it("downloads the versioned Release package through a directly hosted entrypoint", () => {
    expect(installer).toContain(
      "releases/download/v$RELEASE_VERSION/threadlight-host-$RELEASE_VERSION.tgz",
    );
    expect(installer).toContain("https://threadlight.xyz/install.sh");
    expect(installer).toContain(
      'systemctl --user enable "$SERVICE_NAME.service"',
    );
    expect(installer).toContain(
      'systemctl --user restart "$SERVICE_NAME.service"',
    );
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
      existsSync(
        join(dataRoot, "threadlight-self-host", ".legacy-home-migrated"),
      ),
    ).toBe(true);
  });

  it("installs a Host-only service without bundled Web assets", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-host-only-"));
    temporaryRoots.push(root);
    const configRoot = join(root, "config");
    const dataRoot = join(root, "data");
    const fakeBin = join(root, "bin");
    const fakePackage = join(root, "threadlight-host.tgz");
    const fakeNpm = join(fakeBin, "npm");
    const startedMarker = join(root, "host-started");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakePackage, "offline fixture\n");
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
package_root="$prefix/lib/node_modules/@threadlight/host"
mkdir -p "$prefix/bin" "$package_root/web"
printf '<!doctype html>\n' > "$package_root/web/index.html"
cat > "$prefix/bin/threadlight-host" <<'HOST'
#!/bin/sh
set -eu
[ ! -e "$THREADLIGHT_FAKE_WEB_INDEX" ]
touch "$THREADLIGHT_HOST_STARTED_MARKER"
HOST
chmod 0755 "$prefix/bin/threadlight-host"
`,
    );
    chmodSync(fakeNpm, 0o755);

    const runtimeRoot = join(dataRoot, "threadlight-self-host");
    const bundledWebIndex = join(
      runtimeRoot,
      "lib/node_modules/@threadlight/host/web/index.html",
    );
    execFileSync(
      "sh",
      [
        "-s",
        "--",
        "install",
        "--host-only",
        "--foreground",
        "--origin",
        "https://nagisa77.github.io",
      ],
      {
        encoding: "utf8",
        input: installer,
        env: {
          ...process.env,
          HOME: root,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          XDG_CONFIG_HOME: configRoot,
          XDG_DATA_HOME: dataRoot,
          THREADLIGHT_FAKE_WEB_INDEX: bundledWebIndex,
          THREADLIGHT_HOST_STARTED_MARKER: startedMarker,
          THREADLIGHT_HOST_PACKAGE_URL: `file://${fakePackage}`,
          THREADLIGHT_SELF_HOST_SCRIPT_URL: `file://${installerPath}`,
        },
      },
    );

    expect(existsSync(bundledWebIndex)).toBe(false);
    expect(existsSync(startedMarker)).toBe(true);
    const savedConfig = JSON.parse(
      readFileSync(join(configRoot, "threadlight", "self-host.json"), "utf8"),
    ) as { origins: string[] };
    expect(savedConfig.origins).toEqual(["https://nagisa77.github.io"]);
  });

  it("restores executable permissions for the node-pty spawn helper", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-node-pty-mode-"));
    temporaryRoots.push(root);
    const configRoot = join(root, "config");
    const dataRoot = join(root, "data");
    const fakeBin = join(root, "bin");
    const fakePackage = join(root, "threadlight-host.tgz");
    const fakeNpm = join(fakeBin, "npm");
    const startedMarker = join(root, "host-started");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(fakePackage, "offline fixture\n");
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
helper="$prefix/lib/node_modules/@threadlight/host/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
mkdir -p "$prefix/bin" "$(dirname "$helper")"
printf '#!/bin/sh\\nexit 0\\n' > "$helper"
chmod 0644 "$helper"
cat > "$prefix/bin/threadlight-host" <<'HOST'
#!/bin/sh
set -eu
[ -x "$THREADLIGHT_FAKE_SPAWN_HELPER" ]
touch "$THREADLIGHT_HOST_STARTED_MARKER"
HOST
chmod 0755 "$prefix/bin/threadlight-host"
`,
    );
    chmodSync(fakeNpm, 0o755);

    const spawnHelper = join(
      dataRoot,
      "threadlight-self-host/lib/node_modules/@threadlight/host/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    );
    execFileSync("sh", ["-s", "--", "install", "--foreground"], {
      encoding: "utf8",
      input: installer,
      env: {
        ...process.env,
        HOME: root,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        XDG_CONFIG_HOME: configRoot,
        XDG_DATA_HOME: dataRoot,
        THREADLIGHT_FAKE_SPAWN_HELPER: spawnHelper,
        THREADLIGHT_HOST_STARTED_MARKER: startedMarker,
        THREADLIGHT_HOST_PACKAGE_URL: `file://${fakePackage}`,
        THREADLIGHT_SELF_HOST_SCRIPT_URL: `file://${installerPath}`,
      },
    });

    expect(statSync(spawnHelper).mode & 0o111).not.toBe(0);
    expect(existsSync(startedMarker)).toBe(true);
  });
});
