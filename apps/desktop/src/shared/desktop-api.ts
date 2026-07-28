import type {
  AttachmentData,
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

export const DESKTOP_REQUEST_CHANNEL = "threadlight:request";
export const DESKTOP_MESSAGE_CHANNEL = "threadlight:message";
export const DESKTOP_SETTINGS_GET_CHANNEL = "threadlight:settings:get";
export const DESKTOP_SETTINGS_UPDATE_CHANNEL = "threadlight:settings:update";
export const DESKTOP_CLIPBOARD_WRITE_CHANNEL = "threadlight:clipboard:write";
export const DESKTOP_PROJECTS_GET_CHANNEL = "threadlight:projects:get";
export const DESKTOP_PROJECT_OPEN_CHANNEL = "threadlight:project:open";
export const DESKTOP_PROJECT_ACTIVATE_CHANNEL = "threadlight:project:activate";
export const DESKTOP_PROJECT_OPENERS_GET_CHANNEL =
  "threadlight:project-openers:get";
export const DESKTOP_PROJECT_OPEN_WITH_CHANNEL =
  "threadlight:project-open-with";
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
export const DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL =
  "threadlight:computer-permission:get";
export const DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL =
  "threadlight:computer-permission:request";
export const DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL =
  "threadlight:computer-permission:relaunch";
export const DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL =
  "threadlight:computer-permission:changed";
export const DESKTOP_TERMINAL_CREATE_CHANNEL = "threadlight:terminal:create";
export const DESKTOP_TERMINAL_WRITE_CHANNEL = "threadlight:terminal:write";
export const DESKTOP_TERMINAL_RESIZE_CHANNEL = "threadlight:terminal:resize";
export const DESKTOP_TERMINAL_CLOSE_CHANNEL = "threadlight:terminal:close";
export const DESKTOP_TERMINAL_EVENT_CHANNEL = "threadlight:terminal:event";
export const DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL =
  "threadlight:conversation-changes:get";
export const DESKTOP_WORKSPACE_LIST_CHANNEL = "threadlight:workspace:list";
export const DESKTOP_WORKSPACE_FILE_GET_CHANNEL =
  "threadlight:workspace-file:get";
export const DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL =
  "threadlight:workspace-file:reveal";

export type DesktopModelProvider = "openai" | "deepseek" | "qwen";
export type DesktopLanguage = "zh-CN" | "zh-TW" | "en" | "ja" | "ko";
export type DesktopTheme = "system" | "light" | "dark";
export type DesktopProjectOpener = string;

export interface DesktopSettingsSnapshot {
  language: DesktopLanguage;
  theme: DesktopTheme;
  preferredProjectOpener: DesktopProjectOpener;
  provider: DesktopModelProvider;
  openAIApiKeyConfigured: boolean;
  deepSeekApiKeyConfigured: boolean;
  qwenApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  model: string;
}

export interface DesktopSettingsUpdate {
  language?: DesktopLanguage;
  theme?: DesktopTheme;
  preferredProjectOpener?: DesktopProjectOpener;
  provider: DesktopModelProvider;
  openAIApiKey?: string | null;
  deepSeekApiKey?: string | null;
  qwenApiKey?: string | null;
  searchApiKey?: string | null;
  qwenBaseUrl: string;
  model: string;
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

export interface DesktopProjectOpenerOption {
  id: DesktopProjectOpener;
  label: string;
  available: boolean;
  default: boolean;
  iconDataUrl?: string;
}

export interface DesktopProjectOpenWithRequest {
  projectId: string;
  opener: DesktopProjectOpener;
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
  ownerThreadId?: string;
  targets: readonly DesktopComputerShareTarget[];
}

export type DesktopComputerPermissionCapability =
  | "screen_recording"
  | "accessibility";

export type DesktopComputerPermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export interface DesktopComputerPermissionSnapshot {
  required: boolean;
  blockingCapability?: DesktopComputerPermissionCapability;
  ownerThreadId?: string;
  screenRecording: DesktopComputerPermissionStatus;
  accessibility: "granted" | "denied";
  relaunchRequired: boolean;
}

export interface DesktopTerminalCreateRequest {
  projectId: string;
  cols: number;
  rows: number;
}

export interface DesktopTerminalSession {
  id: string;
  shell: string;
}

export interface DesktopTerminalWriteRequest {
  sessionId: string;
  data: string;
}

export interface DesktopTerminalResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

export type DesktopTerminalEvent =
  | {
      type: "data";
      sessionId: string;
      data: string;
    }
  | {
      type: "exit";
      sessionId: string;
      exitCode: number;
    };

export interface DesktopConversationChangesRequest {
  projectId: string;
  threadId: string;
}

export interface DesktopConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface DesktopConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly DesktopConversationFileChange[];
}

export interface DesktopWorkspaceListRequest {
  projectId: string;
  path?: string;
}

export interface DesktopWorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface DesktopWorkspaceFileRequest {
  projectId: string;
  path: string;
}

export interface DesktopWorkspaceFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export interface DesktopApi {
  send(message: JsonRpcRequest): void;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
  writeClipboardText(text: string): Promise<void>;
  getSettings(): Promise<DesktopSettingsSnapshot>;
  updateSettings(
    update: DesktopSettingsUpdate,
  ): Promise<DesktopSettingsSnapshot>;
  getProjects(): Promise<DesktopProjectsSnapshot>;
  openProject(): Promise<DesktopProjectsSnapshot>;
  activateProject(projectId: string): Promise<DesktopProjectsSnapshot>;
  getProjectOpeners(
    projectId?: string,
  ): Promise<readonly DesktopProjectOpenerOption[]>;
  openProjectWith(request: DesktopProjectOpenWithRequest): Promise<void>;
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
  getComputerPermissions(): Promise<DesktopComputerPermissionSnapshot>;
  requestComputerPermission(
    capability: DesktopComputerPermissionCapability,
  ): Promise<DesktopComputerPermissionSnapshot>;
  relaunchForComputerPermissions(): Promise<void>;
  onComputerPermissionChanged(
    listener: (snapshot: DesktopComputerPermissionSnapshot) => void,
  ): () => void;
  createTerminal(
    request: DesktopTerminalCreateRequest,
  ): Promise<DesktopTerminalSession>;
  writeTerminal(request: DesktopTerminalWriteRequest): void;
  resizeTerminal(request: DesktopTerminalResizeRequest): void;
  closeTerminal(sessionId: string): Promise<void>;
  onTerminalEvent(
    listener: (event: DesktopTerminalEvent) => void,
  ): () => void;
  getConversationChanges(
    request: DesktopConversationChangesRequest,
  ): Promise<DesktopConversationChangesSnapshot>;
  listWorkspace(
    request: DesktopWorkspaceListRequest,
  ): Promise<readonly DesktopWorkspaceEntry[]>;
  getWorkspaceFile(
    request: DesktopWorkspaceFileRequest,
  ): Promise<DesktopWorkspaceFile>;
  revealWorkspaceFile(request: DesktopWorkspaceFileRequest): Promise<void>;
}
