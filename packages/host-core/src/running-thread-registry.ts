import type { JsonRpcOutgoing } from "@threadlight/protocol";

interface RunningThreadOwner {
  projectId: string;
  runtimeId: string;
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

    if (message.method === "turn/started") {
      this.owners.set(threadId, { projectId, runtimeId });
    } else if (
      message.method === "turn/completed" ||
      message.method === "turn/failed"
    ) {
      this.owners.delete(threadId);
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
      if (projectId) this.owners.set(threadId, { projectId, runtimeId });
    }
  }

  clearRuntime(runtimeId: string): void {
    for (const [threadId, owner] of this.owners) {
      if (owner.runtimeId === runtimeId) this.owners.delete(threadId);
    }
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
