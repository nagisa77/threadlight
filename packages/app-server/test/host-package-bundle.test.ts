import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("self-hosted runtime bundle", () => {
  it("starts the packaged ESM app-server without dynamic require failures", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-host-bundle-"));
    temporaryRoots.push(root);
    const outfile = join(root, "bin.mjs");

    buildSync({
      entryPoints: [
        fileURLToPath(new URL("../src/bin.ts", import.meta.url)),
      ],
      outfile,
      bundle: true,
      external: ["node-pty", "ws"],
      format: "esm",
      banner: {
        js: 'import { createRequire as __threadlightCreateRequire } from "node:module"; const require = __threadlightCreateRequire(import.meta.url);',
      },
      platform: "node",
      target: "node22",
      logLevel: "silent",
    });

    const result = spawnSync(process.execPath, [outfile], {
      cwd: root,
      encoding: "utf8",
      input: "",
      timeout: 10_000,
      env: {
        ...process.env,
        BRAVE_SEARCH_API_KEY: "",
        OPENAI_API_KEY: "",
        THREADLIGHT_COMPUTER_USE: "0",
        THREADLIGHT_HOME: join(root, "home"),
        THREADLIGHT_PROJECT_ROOT: root,
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "Threadlight app-server is listening on stdio",
    );
    expect(result.stderr).not.toContain("Dynamic require");
  });
});
