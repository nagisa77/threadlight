import {
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createHostSecretCodec } from "../src/host-secret-codec.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createHostSecretCodec", () => {
  it("persists a 0600 Host key and decrypts AES-GCM data after restart", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "threadlight-host-secret-"),
    );
    directories.push(directory);
    const keyPath = join(directory, "host-secret.key");
    const firstCodec = createHostSecretCodec(keyPath);
    const encrypted = firstCodec.encrypt("fixture-provider-secret");

    expect(encrypted).not.toContain("fixture-provider-secret");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);

    const restartedCodec = createHostSecretCodec(keyPath);
    expect(restartedCodec.decrypt(encrypted)).toBe(
      "fixture-provider-secret",
    );
  });
});
