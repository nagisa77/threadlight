import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

export const DESKTOP_REQUEST_CHANNEL = "threadlight:request";
export const DESKTOP_MESSAGE_CHANNEL = "threadlight:message";
export const DESKTOP_SETTINGS_GET_CHANNEL = "threadlight:settings:get";
export const DESKTOP_SETTINGS_UPDATE_CHANNEL = "threadlight:settings:update";
export const DESKTOP_PROJECTS_GET_CHANNEL = "threadlight:projects:get";
export const DESKTOP_PROJECT_OPEN_CHANNEL = "threadlight:project:open";
export const DESKTOP_PROJECT_ACTIVATE_CHANNEL = "threadlight:project:activate";
export const DESKTOP_CONVERSATION_UPSERT_CHANNEL =
  "threadlight:conversation:upsert";
export const DESKTOP_CONVERSATION_DELETE_CHANNEL =
  "threadlight:conversation:delete";

export interface DesktopSettingsSnapshot {
  openAIApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  autoApproveAll: boolean;
}

export interface DesktopSettingsUpdate {
  openAIApiKey?: string | null;
  searchApiKey?: string | null;
  autoApproveAll: boolean;
}

export interface DesktopConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopProject {
  id: string;
  name: string;
  basePath: string;
  lastOpenedAt: string;
  conversations: readonly DesktopConversationSummary[];
}

export interface DesktopProjectsSnapshot {
  activeProjectId?: string;
  projects: readonly DesktopProject[];
}

export interface DesktopConversationUpdate {
  projectId: string;
  id: string;
  title: string;
}

export interface DesktopConversationTarget {
  projectId: string;
  id: string;
}

export interface DesktopApi {
  send(message: JsonRpcRequest): void;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
  getSettings(): Promise<DesktopSettingsSnapshot>;
  updateSettings(
    update: DesktopSettingsUpdate,
  ): Promise<DesktopSettingsSnapshot>;
  getProjects(): Promise<DesktopProjectsSnapshot>;
  openProject(): Promise<DesktopProjectsSnapshot>;
  activateProject(projectId: string): Promise<DesktopProjectsSnapshot>;
  upsertConversation(
    update: DesktopConversationUpdate,
  ): Promise<DesktopProjectsSnapshot>;
  deleteConversation(
    target: DesktopConversationTarget,
  ): Promise<DesktopProjectsSnapshot>;
}
