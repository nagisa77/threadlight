import type { ConversationAccessMode } from "@threadlight/protocol";
import type { HostDirectoryListing } from "@threadlight/protocol";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: ConversationStatus;
  unread?: boolean;
  renamedAt?: string;
  pinnedAt?: string;
  archivedAt?: string;
  accessMode?: ConversationAccessMode;
  workspace?: TaskWorkspace;
}

export type ConversationStatus = "pending" | "completed" | "attention";

export type TaskWorkspace =
  | {
      mode: "folder";
      path: string;
    }
  | {
      mode: "standalone";
      path: string;
    }
  | {
      mode: "worktree";
      path: string;
      root: string;
      repositoryRoot: string;
      branch: string;
      baseCommit: string;
      sourceBranch?: string;
    };

export interface ProjectSummary {
  id: string;
  name: string;
  basePath: string;
  lastOpenedAt: string;
  scope?: "project" | "standalone";
  pinnedAt?: string;
  conversations: readonly ConversationSummary[];
  runtime?: {
    kind: "remote";
    endpoint: string;
    workspacePath: string;
    runtimeId: string;
  };
}

export interface ProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly ProjectSummary[];
}

export function projectsWithDeliveryStatus(
  snapshot: ProjectsSnapshot | undefined,
  projectId: string,
  threadId: string,
  status: "syncing" | "synced" | "conflict" | "failed",
): ProjectsSnapshot | undefined {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id !== projectId
        ? project
        : {
            ...project,
            conversations: project.conversations.map((conversation) =>
              conversation.id !== threadId
                ? conversation
                : {
                    ...conversation,
                    status:
                      status === "syncing"
                        ? "pending"
                        : status === "synced"
                          ? "completed"
                          : "attention",
                    ...(status === "conflict" || status === "failed"
                      ? { unread: true }
                      : {}),
                  },
            ),
          },
    ),
  };
}

export interface HostSummary {
  id: string;
  name: string;
  kind: "local" | "remote";
  endpoint?: string;
}

export interface HostsSnapshot {
  activeHostId: string;
  hosts: readonly HostSummary[];
}

export interface ConversationSummaryUpdate {
  projectId: string;
  id: string;
  title: string;
}

export interface ConversationSummaryTarget {
  projectId: string;
  id: string;
}

export interface ConversationMetadataUpdate extends ConversationSummaryTarget {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  accessMode?: ConversationAccessMode;
}

export interface ProjectsAdapter {
  load(): Promise<ProjectsSnapshot>;
  openFolder(path?: string): Promise<ProjectsSnapshot>;
  createStandalone?(): Promise<ProjectsSnapshot>;
  loadHosts?(): Promise<HostsSnapshot>;
  connectRemote?(input: {
    endpoint: string;
    token: string;
    name?: string;
  }): Promise<HostsSnapshot>;
  activateHost?(hostId: string): Promise<HostsSnapshot>;
  updateRemoteHost?(input: {
    hostId: string;
    endpoint: string;
    token?: string;
    name?: string;
  }): Promise<HostsSnapshot>;
  deleteRemoteHost?(hostId: string): Promise<HostsSnapshot>;
  listRemoteDirectories?(path: string): Promise<HostDirectoryListing>;
  activate(projectId: string): Promise<ProjectsSnapshot>;
  updateProject?(update: {
    id: string;
    pinned: boolean;
  }): Promise<ProjectsSnapshot>;
  upsertConversation(
    update: ConversationSummaryUpdate,
  ): Promise<ProjectsSnapshot>;
  updateConversation(
    update: ConversationMetadataUpdate,
  ): Promise<ProjectsSnapshot>;
  markConversationRead?(
    target: ConversationSummaryTarget,
  ): Promise<ProjectsSnapshot>;
  deleteConversation(
    target: ConversationSummaryTarget,
  ): Promise<ProjectsSnapshot>;
}

export function activeProject(
  snapshot: ProjectsSnapshot | undefined,
): ProjectSummary | undefined {
  return snapshot?.projects.find(
    (project) => project.id === snapshot.activeProjectId,
  );
}
