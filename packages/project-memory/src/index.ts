import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const PROJECT_MEMORY_RELATIVE_PATH = ".threadlight/MEMORY.md";
export const PROJECT_MEMORY_MAX_CHARS = 25_000;
export const PROJECT_MEMORY_TEMPLATE = `# Project memory

> Threadlight loads this file at the start of every new task. Keep only durable, project-specific knowledge here. Revise existing entries instead of duplicating them. Do not store secrets, transient task state, chat transcripts, or unverified assumptions.

## Architecture

## Decisions

## Conventions

## Commands

## Pitfalls
`;

export interface ProjectMemorySnapshot {
  path: typeof PROJECT_MEMORY_RELATIVE_PATH;
  absolutePath: string;
  content: string;
  revision: string;
}

export interface ProjectMemoryStoreOptions {
  maxChars?: number;
  initialContent?: string;
}

export class ProjectMemoryConflictError extends Error {
  constructor() {
    super("Project memory changed since it was read; read it again before writing");
    this.name = "ProjectMemoryConflictError";
  }
}

export class ProjectMemoryStore {
  private readonly maxChars: number;
  private readonly initialContent: string;

  constructor(
    private readonly workspaceRoot: string,
    options: ProjectMemoryStoreOptions = {},
  ) {
    this.maxChars = positiveInteger(
      options.maxChars ?? PROJECT_MEMORY_MAX_CHARS,
      "maxChars",
    );
    this.initialContent = normalizeContent(
      options.initialContent ?? PROJECT_MEMORY_TEMPLATE,
    );
    this.validateContent(this.initialContent);
  }

  async ensure(): Promise<ProjectMemorySnapshot> {
    const location = await this.resolveLocation();
    const temporaryPath = `${location.absolutePath}.${randomUUID()}.tmp`;

    try {
      const file = await open(temporaryPath, "wx", 0o600);
      try {
        await file.writeFile(this.initialContent, "utf8");
      } finally {
        await file.close();
      }
      await link(temporaryPath, location.absolutePath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }

    return this.readExisting(location.root, location.absolutePath);
  }

  async read(): Promise<ProjectMemorySnapshot> {
    return this.ensure();
  }

  async write(
    content: string,
    expectedRevision: string,
  ): Promise<ProjectMemorySnapshot> {
    if (!expectedRevision) {
      throw new Error("expectedRevision must be a non-empty string");
    }
    const normalized = normalizeContent(content);
    this.validateContent(normalized);

    const initial = await this.ensure();
    const lockPath = `${initial.absolutePath}.lock`;
    const lock = await acquireMemoryLock(lockPath);
    try {
      const root = await canonicalDirectory(this.workspaceRoot);
      const current = await this.readExisting(root, initial.absolutePath);
      if (current.revision !== expectedRevision) {
        throw new ProjectMemoryConflictError();
      }

      const temporaryPath = `${current.absolutePath}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporaryPath, "wx", 0o600);
        try {
          await file.writeFile(normalized, "utf8");
        } finally {
          await file.close();
        }
        await rename(temporaryPath, current.absolutePath);
      } finally {
        await rm(temporaryPath, { force: true });
      }

      return this.readExisting(root, current.absolutePath);
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  private async resolveLocation(): Promise<{
    root: string;
    absolutePath: string;
  }> {
    const root = await canonicalDirectory(this.workspaceRoot);
    const storageDirectory = resolve(root, ".threadlight");

    try {
      await mkdir(storageDirectory, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }

    const storageInfo = await lstat(storageDirectory);
    if (!storageInfo.isDirectory() || storageInfo.isSymbolicLink()) {
      throw new Error(".threadlight must be a directory inside the project");
    }
    const canonicalStorage = await realpath(storageDirectory);
    if (!isWithin(root, canonicalStorage)) {
      throw new Error(".threadlight resolves outside the project");
    }

    return {
      root,
      absolutePath: resolve(canonicalStorage, "MEMORY.md"),
    };
  }

  private async readExisting(
    root: string,
    absolutePath: string,
  ): Promise<ProjectMemorySnapshot> {
    const fileInfo = await lstat(absolutePath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new Error(".threadlight/MEMORY.md must be a regular file");
    }
    const canonicalPath = await realpath(absolutePath);
    if (!isWithin(root, canonicalPath)) {
      throw new Error(".threadlight/MEMORY.md resolves outside the project");
    }
    if (!(await stat(canonicalPath)).isFile()) {
      throw new Error(".threadlight/MEMORY.md must be a regular file");
    }

    const content = await readFile(canonicalPath, "utf8");
    return {
      path: PROJECT_MEMORY_RELATIVE_PATH,
      absolutePath: canonicalPath,
      content,
      revision: revision(content),
    };
  }

  private validateContent(content: string): void {
    if (content.length > this.maxChars) {
      throw new Error(
        `Project memory cannot exceed ${this.maxChars} characters`,
      );
    }
  }
}

function normalizeContent(content: string): string {
  if (typeof content !== "string") {
    throw new Error("content must be a string");
  }
  return `${content.replace(/\s+$/u, "")}\n`;
}

function revision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(resolve(path));
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error("Project path must be a directory");
  }
  return canonical;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function acquireMemoryLock(path: string) {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      return await open(path, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (await lockIsStale(path)) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Another project memory write is still in progress");
      }
      await delay(25);
    }
  }
}

async function lockIsStale(path: string): Promise<boolean> {
  try {
    const lock = await stat(path);
    return Date.now() - lock.mtimeMs > 10_000;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}
