import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactRoot = resolve(repositoryRoot, "artifacts");
const packageRoot = resolve(artifactRoot, "threadlight-host");

await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

const common = {
  bundle: true,
  external: ["node-pty", "ws"],
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: [
      resolve(repositoryRoot, "packages/app-server/src/host-bin.ts"),
    ],
    outfile: resolve(packageRoot, "host.mjs"),
  }),
  build({
    ...common,
    entryPoints: [
      resolve(repositoryRoot, "packages/app-server/src/bin.ts"),
    ],
    outfile: resolve(packageRoot, "bin.js"),
  }),
  ...["builtin-skills", "builtin-plugins"].map((directory) =>
    cp(
      resolve(repositoryRoot, `packages/app-server/src/${directory}`),
      resolve(packageRoot, directory),
      { recursive: true },
    ),
  ),
]);

await writeFile(
  resolve(packageRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "@threadlight/host",
      version: "0.1.0",
      description:
        "Headless multi-project Threadlight Host for remote deployment.",
      license: "Apache-2.0",
      type: "module",
      bin: {
        "threadlight-host": "./host.mjs",
      },
      engines: {
        node: ">=22",
      },
      dependencies: {
        "node-pty": "^1.1.0",
        ws: "^8.18.0",
      },
      files: [
        "host.mjs",
        "bin.js",
        "builtin-skills",
        "builtin-plugins",
        "README.md",
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  resolve(packageRoot, "README.md"),
  `# Threadlight Host

Headless, multi-project Threadlight Host. Projects and settings live on the
host in \`~/.threadlight\` by default.

\`\`\`bash
npm install -g ./threadlight-host-0.1.0.tgz
THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)" \\
  threadlight-host --host 127.0.0.1 --port 7432
\`\`\`

Use an SSH tunnel, VPN, or HTTPS reverse proxy when connecting across an
untrusted network. Interactive remote terminals use node-pty. Linux hosts may
need Python, make, and a C++ compiler when a prebuilt binary is unavailable.
`,
  "utf8",
);

const { stdout } = await execFileAsync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["pack", "--pack-destination", artifactRoot],
  { cwd: packageRoot },
);
process.stdout.write(stdout);
