import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(repositoryRoot, "artifacts");
const packageRoot = resolve(artifactRoot, "threadlight-host");
const repositoryPackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
);
const packageVersion = repositoryPackage.version;
if (typeof packageVersion !== "string" || !packageVersion.trim()) {
  throw new Error("The repository package.json does not contain a version.");
}

const webBuild = await execFileAsync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build", "--workspace", "@threadlight/web"],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      VITE_THREADLIGHT_HOST_URL: "self",
    },
    maxBuffer: 20 * 1024 * 1024,
  },
);
process.stdout.write(webBuild.stdout);
process.stderr.write(webBuild.stderr);

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
    entryPoints: [resolve(repositoryRoot, "packages/app-server/src/bin.ts")],
    outfile: resolve(packageRoot, "bin.js"),
  }),
  ...["builtin-skills", "builtin-plugins"].map((directory) =>
    cp(
      resolve(repositoryRoot, `packages/app-server/src/${directory}`),
      resolve(packageRoot, directory),
      { recursive: true },
    ),
  ),
  cp(resolve(repositoryRoot, "apps/web/dist"), resolve(packageRoot, "web"), {
    recursive: true,
  }),
]);

await writeFile(
  resolve(packageRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "@threadlight/host",
      version: packageVersion,
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
        "web",
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

Self-hosted Threadlight Host and Web client in one package. Projects and
settings live on the host in \`~/.threadlight\` by default. The bundled Web
client is served from the same address as the Host API.

\`\`\`bash
npm install -g ./threadlight-host-${packageVersion}.tgz
THREADLIGHT_HOST_TOKEN="$(openssl rand -hex 32)" \\
  threadlight-host --host 127.0.0.1 --port 7432
\`\`\`

Open \`http://127.0.0.1:7432\` and enter the same token. For a persistent
native service, run:

\`\`\`bash
curl -fsSL https://threadlight.xyz/install.sh | sh
\`\`\`

The managed Host starts empty; add projects from the Web UI after connecting.

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
