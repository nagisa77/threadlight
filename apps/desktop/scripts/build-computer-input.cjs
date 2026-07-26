const { mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.platform !== "darwin") process.exit(0);

const desktopRoot = resolve(__dirname, "..");
const source = resolve(desktopRoot, "native/computer-input.mm");
const output = resolve(desktopRoot, "out/native/computer-input.node");
const nodeInclude =
  process.env.NODE_INCLUDE_DIR ||
  resolve(dirname(process.execPath), "../include/node");

mkdirSync(dirname(output), { recursive: true });
const result = spawnSync(
  "xcrun",
  [
    "clang++",
    "-std=c++20",
    "-fobjc-arc",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-mmacosx-version-min=13.0",
    "-arch",
    "arm64",
    "-arch",
    "x86_64",
    "-I",
    nodeInclude,
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "ScreenCaptureKit",
    source,
    "-o",
    output,
  ],
  { encoding: "utf8" },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
