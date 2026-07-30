import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SecretCodec } from "./settings-store.js";

interface StoredHostCredentials {
  version: 1;
  tokens: Record<string, string>;
}

export class HostCredentialStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  get(hostId: string): string | undefined {
    const encrypted = this.read().tokens[hostId];
    return encrypted ? this.codec.decrypt(encrypted) : undefined;
  }

  set(hostId: string, token: string): void {
    if (!hostId || !token.trim()) {
      throw new Error("Threadlight Host id and token are required.");
    }
    const stored = this.read();
    stored.tokens[hostId] = this.codec.encrypt(token);
    this.write(stored);
  }

  delete(hostId: string): void {
    const stored = this.read();
    if (!(hostId in stored.tokens)) return;
    delete stored.tokens[hostId];
    this.write(stored);
  }

  private read(): StoredHostCredentials {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isStoredCredentials(value)) {
        throw new Error("Host credentials have an unsupported format.");
      }
      return value;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { version: 1, tokens: {} };
      }
      throw error;
    }
  }

  private write(value: StoredHostCredentials): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporary, this.path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}

function isStoredCredentials(
  value: unknown,
): value is StoredHostCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.tokens) &&
    typeof candidate.tokens === "object" &&
    !Array.isArray(candidate.tokens) &&
    Object.values(candidate.tokens as Record<string, unknown>).every(
      (token) => typeof token === "string",
    )
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
