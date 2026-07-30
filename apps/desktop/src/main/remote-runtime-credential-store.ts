import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SecretCodec } from "./settings-store.js";

interface StoredRemoteRuntimeCredentials {
  version: 1;
  tokens: Record<string, string>;
}

export class RemoteRuntimeCredentialStore {
  constructor(
    private readonly path: string,
    private readonly codec: SecretCodec,
  ) {}

  get(projectId: string): string | undefined {
    const encrypted = this.read().tokens[projectId];
    return encrypted ? this.codec.decrypt(encrypted) : undefined;
  }

  set(projectId: string, token: string): void {
    if (!projectId || !token.trim()) {
      throw new Error("Remote runtime project and token are required.");
    }
    const stored = this.read();
    stored.tokens[projectId] = this.codec.encrypt(token);
    this.write(stored);
  }

  delete(projectId: string): void {
    const stored = this.read();
    if (!(projectId in stored.tokens)) return;
    delete stored.tokens[projectId];
    this.write(stored);
  }

  private read(): StoredRemoteRuntimeCredentials {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isStoredCredentials(value)) {
        throw new Error("Remote runtime credentials have an unsupported format.");
      }
      return value;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { version: 1, tokens: {} };
      }
      throw error;
    }
  }

  private write(value: StoredRemoteRuntimeCredentials): void {
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
): value is StoredRemoteRuntimeCredentials {
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
