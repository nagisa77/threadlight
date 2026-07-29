import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import type {
  DesktopConversationTarget,
  DesktopConversationUpdate,
  DesktopConversationSummary,
  DesktopProject,
  DesktopProjectsSnapshot,
} from "../shared/desktop-api.js";

interface StoredProject extends Omit<DesktopProject, "conversations"> {
  conversations: DesktopConversationSummary[];
}

interface StoredProjectMap {
  version: 1;
  activeProjectId?: string;
  projects: StoredProject[];
}

const EMPTY_PROJECT_MAP: StoredProjectMap = { version: 1, projects: [] };

export interface ProjectStoreOptions {
  createId?: () => string;
  now?: () => Date;
}

export class ProjectStore {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly path: string,
    options: ProjectStoreOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  snapshot(): DesktopProjectsSnapshot {
    const stored = this.read();
    return {
      ...(stored.activeProjectId
        ? { activeProjectId: stored.activeProjectId }
        : {}),
      projects: stored.projects.map((project) => ({
        ...project,
        conversations: [...project.conversations].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      })),
    };
  }

  register(folderPath: string): DesktopProjectsSnapshot {
    const basePath = canonicalDirectory(folderPath);
    ensureConversationDirectory(basePath);
    const stored = this.read();
    const timestamp = this.now().toISOString();
    let project = stored.projects.find(
      (candidate) => candidate.basePath === basePath,
    );

    if (project) {
      project.lastOpenedAt = timestamp;
    } else {
      project = {
        id: this.createId(),
        name: basename(basePath),
        basePath,
        lastOpenedAt: timestamp,
        conversations: [],
      };
      stored.projects.push(project);
    }

    stored.activeProjectId = project.id;
    this.write(stored);
    return this.snapshot();
  }

  activate(projectId: string): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Unknown project: ${projectId}`);

    canonicalDirectory(project.basePath);
    ensureConversationDirectory(project.basePath);
    project.lastOpenedAt = this.now().toISOString();
    stored.activeProjectId = project.id;
    this.write(stored);
    return this.snapshot();
  }

  upsertConversation(
    update: DesktopConversationUpdate,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === update.projectId,
    );
    if (!project) throw new Error(`Unknown project: ${update.projectId}`);
    if (!update.id.trim()) throw new Error("Conversation id cannot be empty");
    const title = update.title.trim() || "新任务";
    const timestamp = this.now().toISOString();
    const conversation = project.conversations.find(
      (candidate) => candidate.id === update.id,
    );

    if (conversation) {
      conversation.title = title;
      conversation.updatedAt = timestamp;
    } else {
      project.conversations.push({
        id: update.id,
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        unread: false,
      });
    }
    this.write(stored);
    return this.snapshot();
  }

  markConversationUnread(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot {
    return this.setConversationUnread(target, true);
  }

  markConversationRead(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot {
    return this.setConversationUnread(target, false);
  }

  deleteConversation(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === target.projectId,
    );
    if (!project) throw new Error(`Unknown project: ${target.projectId}`);
    if (!target.id.trim()) throw new Error("Conversation id cannot be empty");

    rmSync(conversationPath(project.basePath, target.id), { force: true });

    project.conversations = project.conversations.filter(
      (conversation) => conversation.id !== target.id,
    );
    this.write(stored);
    return this.snapshot();
  }

  activeProject(): DesktopProject | undefined {
    const snapshot = this.snapshot();
    return snapshot.projects.find(
      (project) => project.id === snapshot.activeProjectId,
    );
  }

  project(projectId: string): DesktopProject | undefined {
    return this.snapshot().projects.find((project) => project.id === projectId);
  }

  private setConversationUnread(
    target: DesktopConversationTarget,
    unread: boolean,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === target.projectId,
    );
    if (!project) throw new Error(`Unknown project: ${target.projectId}`);
    if (!target.id.trim()) throw new Error("Conversation id cannot be empty");
    const conversation = project.conversations.find(
      (candidate) => candidate.id === target.id,
    );
    if (!conversation || conversation.unread === unread) {
      return this.snapshot();
    }
    conversation.unread = unread;
    this.write(stored);
    return this.snapshot();
  }

  private read(): StoredProjectMap {
    let source: string;
    try {
      source = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return structuredClone(EMPTY_PROJECT_MAP);
      }
      throw error;
    }

    const value = JSON.parse(source) as unknown;
    if (!isStoredProjectMap(value)) {
      throw new Error("Project map has an unsupported format");
    }
    return value;
  }

  private write(value: StoredProjectMap): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

}

function conversationPath(basePath: string, threadId: string): string {
  if (
    !threadId ||
    basename(threadId) !== threadId ||
    !/^[\w-]+$/.test(threadId)
  ) {
    throw new Error("Invalid conversation id");
  }
  return join(basePath, ".threadlight", "conversations", `${threadId}.json`);
}

function canonicalDirectory(path: string): string {
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) {
    throw new Error("Project path must be a directory");
  }
  return canonical;
}

function ensureConversationDirectory(basePath: string): void {
  mkdirSync(join(basePath, ".threadlight", "conversations"), {
    recursive: true,
    mode: 0o700,
  });
}

function isStoredProjectMap(value: unknown): value is StoredProjectMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const map = value as Record<string, unknown>;
  return (
    map.version === 1 &&
    (map.activeProjectId === undefined ||
      typeof map.activeProjectId === "string") &&
    Array.isArray(map.projects) &&
    map.projects.every(isProject)
  );
}

function isProject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Record<string, unknown>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.basePath === "string" &&
    typeof project.lastOpenedAt === "string" &&
    Array.isArray(project.conversations) &&
    project.conversations.every(isConversation)
  );
}

function isConversation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const conversation = value as Record<string, unknown>;
  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    typeof conversation.createdAt === "string" &&
    typeof conversation.updatedAt === "string" &&
    (conversation.unread === undefined ||
      typeof conversation.unread === "boolean")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
