import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SecretCodec } from "@threadlight/host-core";

const KEY_BYTES = 32;
const IV_BYTES = 12;

export function createHostSecretCodec(keyPath: string): SecretCodec {
  const key = readOrCreateKey(keyPath);
  return {
    encrypt(value) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        "base64",
      );
    },
    decrypt(value) {
      const payload = Buffer.from(value, "base64");
      if (payload.length <= IV_BYTES + 16) {
        throw new Error("Host secret payload is invalid.");
      }
      const iv = payload.subarray(0, IV_BYTES);
      const tag = payload.subarray(IV_BYTES, IV_BYTES + 16);
      const encrypted = payload.subarray(IV_BYTES + 16);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

function readOrCreateKey(path: string): Buffer {
  try {
    const key = readFileSync(path);
    if (key.length !== KEY_BYTES) {
      throw new Error("Threadlight Host key has an invalid length.");
    }
    return key;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(path, key, { mode: 0o600, flag: "wx" });
  return key;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
