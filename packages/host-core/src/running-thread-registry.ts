import type { JsonRpcOutgoing } from "@threadlight/protocol";

export interface RunningThreadOwner {
  threadId: string;
  projectId: string;
  runtimeId: string;
  turnId?: string;
  revision?: number;
}

/**
 * Tracks live turns outside renderer-owned state so a refreshed client can
 * recover sidebar activity without opening every conversation.
 */
export class RunningThreadRegistry {
  private readonly owners = new Map<string, RunningThreadOwner>();

  record(projectId: string, runtimeId: string, message: JsonRpcOutgoing): void {
    if (!("method" in message)) return;
    const threadId = (message.params as { threadId?: unknown } | undefined)
      ?.threadId;
    if (typeof threadId !== "string") return;

    const params = message.params as
      { turnId?: unknown; revision?: unknown } | undefined;
    if (message.method === "turn/started") {
      this.owners.set(threadId, {
        threadId,
        projectId,
        runtimeId,
        ...(typeof params?.turnId === "string"
          ? { turnId: params.turnId }
          : {}),
        ...(typeof params?.revision === "number"
          ? { revision: params.revision }
          : {}),
      });
    } else if (
      message.method === "turn/completed" ||
      message.method === "turn/failed"
    ) {
      this.owners.delete(threadId);
    } else {
      const owner = this.owners.get(threadId);
      if (
        owner?.runtimeId === runtimeId &&
        typeof params?.revision === "number" &&
        params.revision > (owner.revision ?? -1)
      ) {
        this.owners.set(threadId, { ...owner, revision: params.revision });
      }
    }
  }

  replaceProjects(
    projects: readonly {
      id: string;
      conversations: readonly { id: string }[];
    }[],
    threadIds: readonly string[],
    runtimeId: string,
  ): void {
    const projectIds = new Set(projects.map(({ id }) => id));
    for (const [threadId, owner] of this.owners) {
      if (projectIds.has(owner.projectId)) this.owners.delete(threadId);
    }

    const projectByThread = new Map(
      projects.flatMap((project) =>
        project.conversations.map(
          (conversation) => [conversation.id, project.id] as const,
        ),
      ),
    );
    for (const threadId of threadIds) {
      const projectId = projectByThread.get(threadId);
      if (projectId) {
        this.owners.set(threadId, { threadId, projectId, runtimeId });
      }
    }
  }

  clearRuntime(runtimeId: string): readonly RunningThreadOwner[] {
    const cleared: RunningThreadOwner[] = [];
    for (const [threadId, owner] of this.owners) {
      if (owner.runtimeId !== runtimeId) continue;
      cleared.push(owner);
      this.owners.delete(threadId);
    }
    return cleared;
  }

  clearProject(projectId: string): void {
    for (const [threadId, owner] of this.owners) {
      if (owner.projectId === projectId) this.owners.delete(threadId);
    }
  }

  clear(): void {
    this.owners.clear();
  }

  threadIds(projectIds?: readonly string[]): readonly string[] {
    const allowed = projectIds ? new Set(projectIds) : undefined;
    return [...this.owners]
      .filter(([, owner]) => !allowed || allowed.has(owner.projectId))
      .map(([threadId]) => threadId)
      .sort();
  }
}
