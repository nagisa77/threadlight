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
  HostConversationStatus,
  HostConversationSummary,
  HostProjectSummary,
  HostProjectsSnapshot,
  HostTaskWorkspace,
} from "@threadlight/protocol";

type DesktopConversationStatus = HostConversationStatus;
type DesktopConversationSummary = HostConversationSummary;
type DesktopTaskWorkspace = HostTaskWorkspace;
interface DesktopConversationTarget {
  projectId: string;
  id: string;
}
interface DesktopConversationUpdate extends DesktopConversationTarget {
  title: string;
}
interface DesktopConversationMetadataUpdate
  extends DesktopConversationTarget {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  accessMode?: "approval" | "full";
}
interface DesktopProjectMetadataUpdate {
  id: string;
  pinned: boolean;
}
interface DesktopProjectRuntime {
  kind: "remote";
  endpoint: string;
  workspacePath: string;
  runtimeId: string;
  hostId: string;
}
interface DesktopProject extends HostProjectSummary {
  runtime?: DesktopProjectRuntime;
}
interface DesktopProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly DesktopProject[];
}

interface StoredConversation
  extends Omit<DesktopConversationSummary, "status"> {
  status?: DesktopConversationStatus;
}

interface StoredProject extends Omit<DesktopProject, "conversations"> {
  conversations: StoredConversation[];
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
  standaloneRoot?: string;
}

export class ProjectStore {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly standaloneRoot?: string;

  constructor(
    private readonly path: string,
    options: ProjectStoreOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.standaloneRoot = options.standaloneRoot;
  }

  snapshot(): DesktopProjectsSnapshot {
    const stored = this.read();
    return {
      ...(stored.activeProjectId
        ? { activeProjectId: stored.activeProjectId }
        : {}),
      projects: stored.projects
        .map((project) => ({
          ...project,
          conversations: project.conversations
            .map(normalizeConversation)
            .sort(compareConversations),
        }))
        .sort(compareProjects),
    };
  }

  snapshotForHost(hostId: string): DesktopProjectsSnapshot {
    const snapshot = this.snapshot();
    const projects = snapshot.projects.filter((project) =>
      hostId === "local"
        ? !project.runtime
        : project.runtime?.hostId === hostId,
    );
    const activeProjectId = projects.some(
      (project) => project.id === snapshot.activeProjectId,
    )
      ? snapshot.activeProjectId
      : projects[0]?.id;
    return {
      ...(activeProjectId ? { activeProjectId } : {}),
      projects,
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

  activateStandalone(): DesktopProjectsSnapshot {
    if (!this.standaloneRoot) {
      throw new Error("Standalone tasks are not configured");
    }
    mkdirSync(this.standaloneRoot, { recursive: true, mode: 0o700 });
    const basePath = canonicalDirectory(this.standaloneRoot);
    ensureConversationDirectory(basePath);
    const stored = this.read();
    const timestamp = this.now().toISOString();
    let project = stored.projects.find(
      (candidate) => candidate.scope === "standalone",
    );
    if (project) {
      project.basePath = basePath;
      project.lastOpenedAt = timestamp;
    } else {
      project = {
        id: "standalone",
        name: "Standalone",
        basePath,
        scope: "standalone",
        lastOpenedAt: timestamp,
        conversations: [],
      };
      stored.projects.push(project);
    }
    stored.activeProjectId = project.id;
    this.write(stored);
    return this.snapshot();
  }

  replaceRemoteHostProjects(
    input: {
      hostId: string;
      endpoint: string;
      activeProjectId?: string;
    },
    snapshot: HostProjectsSnapshot,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const otherProjects = stored.projects.filter(
      (project) => project.runtime?.hostId !== input.hostId,
    );
    const remoteProjects: StoredProject[] = snapshot.projects.map(
      (project) => ({
        ...project,
        conversations: project.conversations.map((conversation) => ({
          ...conversation,
        })),
        runtime: {
          kind: "remote",
          hostId: input.hostId,
          endpoint: input.endpoint,
          workspacePath: project.basePath,
          runtimeId: project.id,
        },
      }),
    );
    stored.projects = [...otherProjects, ...remoteProjects];
    stored.activeProjectId = remoteProjects.some(
      (project) => project.id === input.activeProjectId,
    )
      ? input.activeProjectId
      : snapshot.activeProjectId;
    this.write(stored);
    return this.snapshotForHost(input.hostId);
  }

  removeRemoteHost(hostId: string): DesktopProjectsSnapshot {
    const stored = this.read();
    const removedProjectIds = new Set(
      stored.projects
        .filter((project) => project.runtime?.hostId === hostId)
        .map((project) => project.id),
    );
    if (removedProjectIds.size === 0) return this.snapshot();
    stored.projects = stored.projects.filter(
      (project) => !removedProjectIds.has(project.id),
    );
    if (
      stored.activeProjectId &&
      removedProjectIds.has(stored.activeProjectId)
    ) {
      stored.activeProjectId = stored.projects[0]?.id;
    }
    this.write(stored);
    return this.snapshot();
  }

  activate(projectId: string): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Unknown project: ${projectId}`);

    if (project.runtime?.kind !== "remote") {
      canonicalDirectory(project.basePath);
      ensureConversationDirectory(project.basePath);
    }
    project.lastOpenedAt = this.now().toISOString();
    stored.activeProjectId = project.id;
    this.write(stored);
    return this.snapshot();
  }

  updateProject(
    update: DesktopProjectMetadataUpdate,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === update.id,
    );
    if (!project) throw new Error(`Unknown project: ${update.id}`);
    if (update.pinned) {
      project.pinnedAt ??= this.now().toISOString();
    } else {
      delete project.pinnedAt;
    }
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
      if (!conversation.renamedAt && !conversation.titleGeneratedAt) {
        conversation.title = title;
      }
      conversation.updatedAt = timestamp;
    } else {
      project.conversations.push({
        id: update.id,
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "pending",
        unread: false,
      });
    }
    this.write(stored);
    return this.snapshot();
  }

  setGeneratedConversationTitle(
    target: DesktopConversationTarget,
    value: string,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const conversation = findConversation(stored, target);
    if (conversation.renamedAt || conversation.titleGeneratedAt) {
      return this.snapshot();
    }
    const title = value.trim();
    if (!title) throw new Error("Conversation title cannot be empty");
    const timestamp = this.now().toISOString();
    conversation.title = title;
    conversation.titleGeneratedAt = timestamp;
    conversation.updatedAt = timestamp;
    this.write(stored);
    return this.snapshot();
  }

  setConversationWorkspace(
    target: DesktopConversationTarget,
    workspace: DesktopTaskWorkspace,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === target.projectId,
    );
    if (!project) throw new Error(`Unknown project: ${target.projectId}`);
    if (!target.id.trim()) throw new Error("Conversation id cannot be empty");
    const timestamp = this.now().toISOString();
    const conversation = project.conversations.find(
      (candidate) => candidate.id === target.id,
    );
    if (conversation) {
      conversation.workspace = workspace;
      conversation.updatedAt = timestamp;
    } else {
      project.conversations.push({
        id: target.id,
        title: "新任务",
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "pending",
        unread: false,
        workspace,
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

  updateConversation(
    update: DesktopConversationMetadataUpdate,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const conversation = findConversation(stored, update);
    const timestamp = this.now().toISOString();

    if (update.title !== undefined) {
      const title = update.title.trim();
      if (!title) throw new Error("Conversation title cannot be empty");
      conversation.title = title;
      conversation.renamedAt = timestamp;
    }
    if (update.archived !== undefined) {
      if (update.archived) {
        conversation.archivedAt ??= timestamp;
        delete conversation.pinnedAt;
      } else {
        delete conversation.archivedAt;
      }
    }
    if (update.pinned !== undefined) {
      if (update.pinned && conversation.archivedAt) {
        throw new Error("Archived conversations cannot be pinned");
      }
      if (update.pinned) {
        conversation.pinnedAt ??= timestamp;
      } else {
        delete conversation.pinnedAt;
      }
    }
    if (update.accessMode !== undefined) {
      conversation.accessMode = update.accessMode;
    }
    this.write(stored);
    return this.snapshot();
  }

  markConversationPending(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot {
    return this.setConversationStatus(target, "pending");
  }

  markConversationCompleted(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot {
    return this.setConversationStatus(target, "completed");
  }

  deleteConversation(
    target: DesktopConversationTarget,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const project = stored.projects.find(
      (candidate) => candidate.id === target.projectId,
    );
    if (!project) throw new Error(`Unknown project: ${target.projectId}`);
    const conversation = findConversation(stored, target);
    if (!conversation.archivedAt) {
      throw new Error("Archive the conversation before deleting it");
    }

    if (project.runtime?.kind !== "remote") {
      rmSync(conversationPath(project.basePath, target.id), { force: true });
    }

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

  private setConversationStatus(
    target: DesktopConversationTarget,
    status: DesktopConversationStatus,
  ): DesktopProjectsSnapshot {
    const stored = this.read();
    const conversation = findConversation(stored, target);
    if (conversation.status === status) return this.snapshot();
    conversation.status = status;
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
    for (const project of value.projects) {
      if (project.runtime && !project.runtime.hostId) {
        project.runtime.hostId = "legacy-runtime";
      }
      for (const conversation of project.conversations) {
        conversation.status ??= "completed";
      }
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
    (project.pinnedAt === undefined ||
      typeof project.pinnedAt === "string") &&
    (project.scope === undefined ||
      project.scope === "project" ||
      project.scope === "standalone") &&
    (project.runtime === undefined || isProjectRuntime(project.runtime)) &&
    Array.isArray(project.conversations) &&
    project.conversations.every(isConversation)
  );
}

function isProjectRuntime(value: unknown): value is DesktopProjectRuntime {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const runtime = value as Record<string, unknown>;
  return (
    runtime.kind === "remote" &&
    (runtime.hostId === undefined || typeof runtime.hostId === "string") &&
    typeof runtime.endpoint === "string" &&
    typeof runtime.workspacePath === "string" &&
    typeof runtime.runtimeId === "string"
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
    (conversation.status === undefined ||
      conversation.status === "pending" ||
      conversation.status === "completed") &&
    (conversation.unread === undefined ||
      typeof conversation.unread === "boolean") &&
    (conversation.renamedAt === undefined ||
      typeof conversation.renamedAt === "string") &&
    (conversation.titleGeneratedAt === undefined ||
      typeof conversation.titleGeneratedAt === "string") &&
    (conversation.pinnedAt === undefined ||
      typeof conversation.pinnedAt === "string") &&
    (conversation.archivedAt === undefined ||
      typeof conversation.archivedAt === "string") &&
    (conversation.accessMode === undefined ||
      conversation.accessMode === "approval" ||
      conversation.accessMode === "full") &&
    (conversation.workspace === undefined ||
      isTaskWorkspace(conversation.workspace))
  );
}

function findConversation(
  stored: StoredProjectMap,
  target: DesktopConversationTarget,
): StoredConversation {
  const project = stored.projects.find(
    (candidate) => candidate.id === target.projectId,
  );
  if (!project) throw new Error(`Unknown project: ${target.projectId}`);
  if (!target.id.trim()) throw new Error("Conversation id cannot be empty");
  const conversation = project.conversations.find(
    (candidate) => candidate.id === target.id,
  );
  if (!conversation) throw new Error(`Unknown conversation: ${target.id}`);
  return conversation;
}

function normalizeConversation(
  conversation: StoredConversation,
): DesktopConversationSummary {
  return {
    ...conversation,
    status: conversation.status ?? "completed",
  };
}

function compareConversations(
  left: DesktopConversationSummary,
  right: DesktopConversationSummary,
): number {
  if (left.archivedAt || right.archivedAt) {
    if (!left.archivedAt) return -1;
    if (!right.archivedAt) return 1;
    return right.archivedAt.localeCompare(left.archivedAt);
  }
  if (left.pinnedAt || right.pinnedAt) {
    if (!left.pinnedAt) return 1;
    if (!right.pinnedAt) return -1;
    const pinnedOrder = right.pinnedAt.localeCompare(left.pinnedAt);
    if (pinnedOrder !== 0) return pinnedOrder;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareProjects(
  left: DesktopProject,
  right: DesktopProject,
): number {
  if (!left.pinnedAt && !right.pinnedAt) return 0;
  if (!left.pinnedAt) return 1;
  if (!right.pinnedAt) return -1;
  return right.pinnedAt.localeCompare(left.pinnedAt);
}

function isTaskWorkspace(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const workspace = value as Record<string, unknown>;
  if (workspace.mode === "folder") {
    return typeof workspace.path === "string" && workspace.path.length > 0;
  }
  if (workspace.mode === "standalone") {
    return typeof workspace.path === "string" && workspace.path.length > 0;
  }
  return (
    workspace.mode === "worktree" &&
    typeof workspace.path === "string" &&
    workspace.path.length > 0 &&
    typeof workspace.root === "string" &&
    workspace.root.length > 0 &&
    typeof workspace.repositoryRoot === "string" &&
    workspace.repositoryRoot.length > 0 &&
    typeof workspace.branch === "string" &&
    workspace.branch.startsWith("threadlight/") &&
    typeof workspace.baseCommit === "string" &&
    workspace.baseCommit.length > 0 &&
    (workspace.sourceBranch === undefined ||
      (typeof workspace.sourceBranch === "string" &&
        workspace.sourceBranch.length > 0))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
