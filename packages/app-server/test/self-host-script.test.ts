import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
    expect(help).not.toContain("--project");
  });

  it("downloads the versioned Release package through a directly hosted entrypoint", () => {
    expect(installer).toContain(
      "releases/download/v$RELEASE_VERSION/threadlight-host-$RELEASE_VERSION.tgz",
    );
    expect(installer).toContain("https://threadlight.xyz/install.sh");
    expect(installer).toContain("systemctl --user enable --now");
    expect(installer).toContain("launchctl bootstrap");
    expect(redirects).not.toContain("/install.sh");
    expect(sitePackage).toContain("copy-site-installer.mjs");
    expect(copyScript).toContain("scripts/self-host.sh");
    expect(copyScript).toContain("apps/site/dist/install.sh");
  });
});
