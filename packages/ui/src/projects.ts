export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  basePath: string;
  lastOpenedAt: string;
  conversations: readonly ConversationSummary[];
}

export interface ProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly ProjectSummary[];
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

export interface ProjectsAdapter {
  load(): Promise<ProjectsSnapshot>;
  openFolder(): Promise<ProjectsSnapshot>;
  activate(projectId: string): Promise<ProjectsSnapshot>;
  upsertConversation(
    update: ConversationSummaryUpdate,
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
