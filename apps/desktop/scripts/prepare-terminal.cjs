const { chmodSync, existsSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

if (process.platform !== "win32") {
  const nodePtyRoot = resolve(dirname(require.resolve("node-pty")), "..");
  const helper = resolve(
    nodePtyRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
