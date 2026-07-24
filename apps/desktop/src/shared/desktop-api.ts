import type {
  AttachmentData,
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
export const DESKTOP_PROJECT_MEMORY_GET_CHANNEL =
  "threadlight:project-memory:get";
export const DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL =
  "threadlight:project-memory:open";
export const DESKTOP_AUDIO_TRANSCRIBE_CHANNEL =
  "threadlight:audio:transcribe";
export const DESKTOP_ATTACHMENT_REFERENCE_CHANNEL =
  "threadlight:attachment:reference";
export const DESKTOP_COMPUTER_SHARE_GET_CHANNEL =
  "threadlight:computer-share:get";
export const DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL =
  "threadlight:computer-share:show";
export const DESKTOP_COMPUTER_SHARE_STOP_CHANNEL =
  "threadlight:computer-share:stop";
export const DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL =
  "threadlight:computer-share:changed";

export type DesktopModelProvider = "openai" | "deepseek" | "qwen";

export interface DesktopSettingsSnapshot {
  provider: DesktopModelProvider;
  openAIApiKeyConfigured: boolean;
  deepSeekApiKeyConfigured: boolean;
  qwenApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  model: string;
  autoApproveAll: boolean;
}

export interface DesktopSettingsUpdate {
  provider: DesktopModelProvider;
  openAIApiKey?: string | null;
  deepSeekApiKey?: string | null;
  qwenApiKey?: string | null;
  searchApiKey?: string | null;
  qwenBaseUrl: string;
  model: string;
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

export interface DesktopProjectMemorySnapshot {
  path: string;
  content: string;
  revision: string;
}

export interface DesktopAudioTranscriptionRequest {
  audio: ArrayBuffer;
  mimeType: string;
}

export interface DesktopAttachmentReferenceRequest {
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export interface DesktopComputerShareTarget {
  id: string;
  name: string;
  applicationName?: string;
}

export interface DesktopComputerShareSnapshot {
  active: boolean;
  pictureInPicture: boolean;
  targets: readonly DesktopComputerShareTarget[];
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
  getProjectMemory(projectId: string): Promise<DesktopProjectMemorySnapshot>;
  openProjectMemory(projectId: string): Promise<void>;
  transcribeAudio(
    request: DesktopAudioTranscriptionRequest,
  ): Promise<string>;
  createAttachmentReference(file: File): Promise<AttachmentData>;
  getComputerShare(): Promise<DesktopComputerShareSnapshot>;
  showComputerShare(): Promise<DesktopComputerShareSnapshot>;
  stopComputerShare(): Promise<DesktopComputerShareSnapshot>;
  onComputerShareChanged(
    listener: (snapshot: DesktopComputerShareSnapshot) => void,
  ): () => void;
}
