import { createRoot } from "react-dom/client";
import { ThreadlightClient } from "@threadlight/client";
import {
  ThreadlightApp,
  type AttachmentPreviewAdapter,
  type AttachmentStageAdapter,
  type ClipboardAdapter,
  type ComputerPermissionAdapter,
  type ComputerShareAdapter,
  type DiagnosticsAdapter,
  type ProjectMemoryAdapter,
  type ProjectOpenerAdapter,
  type ProjectsAdapter,
  type SettingsAdapter,
  type TerminalAdapter,
  type VoiceInputAdapter,
  type WorkspaceAdapter,
} from "@threadlight/ui";
import "@threadlight/ui/styles.css";

import { ElectronTransport } from "./electron-transport.js";
import { attachmentPreviewUrl } from "./attachment-preview.js";

const client = new ThreadlightClient(new ElectronTransport());
const clipboard: ClipboardAdapter = {
  writeText: (text) => window.threadlightDesktop.writeClipboardText(text),
};
const settings: SettingsAdapter = {
  load: () => window.threadlightDesktop.getSettings(),
  save: (update) => window.threadlightDesktop.updateSettings(update),
  testProvider: (request) => window.threadlightDesktop.testProvider(request),
};
const diagnostics: DiagnosticsAdapter = {
  load: (projectId) => window.threadlightDesktop.getDiagnostics(projectId),
};
const projects: ProjectsAdapter = {
  load: () => window.threadlightDesktop.getProjects(),
  openFolder: () => window.threadlightDesktop.openProject(),
  activate: (projectId) =>
    window.threadlightDesktop.activateProject(projectId),
  upsertConversation: (update) =>
    window.threadlightDesktop.upsertConversation(update),
  updateConversation: (update) =>
    window.threadlightDesktop.updateConversation(update),
  markConversationRead: (target) =>
    window.threadlightDesktop.markConversationRead(target),
  deleteConversation: (target) =>
    window.threadlightDesktop.deleteConversation(target),
};
const projectOpener: ProjectOpenerAdapter = {
  load: (projectId) => window.threadlightDesktop.getProjectOpeners(projectId),
  open: (projectId, opener, threadId) =>
    window.threadlightDesktop.openProjectWith({
      projectId,
      opener,
      ...(threadId ? { threadId } : {}),
    }),
};
const memory: ProjectMemoryAdapter = {
  load: (projectId) => window.threadlightDesktop.getProjectMemory(projectId),
  open: (projectId) => window.threadlightDesktop.openProjectMemory(projectId),
};
const voiceInput: VoiceInputAdapter = {
  async prepare() {
    const snapshot = await window.threadlightDesktop.getSettings();
    if (!snapshot.openAIApiKeyConfigured) {
      throw new Error("请先在设置中配置 OpenAI API Key，再使用语音输入。");
    }
  },
  transcribe: (recording) =>
    window.threadlightDesktop.transcribeAudio(recording),
};
const attachmentStage: AttachmentStageAdapter = {
  stage: (file) => window.threadlightDesktop.createAttachmentReference(file),
};
const attachmentPreview: AttachmentPreviewAdapter = {
  imageUrl: (attachment) =>
    attachment.kind === "image"
      ? attachmentPreviewUrl(attachment.path)
      : undefined,
};
const computerShare: ComputerShareAdapter = {
  load: () => window.threadlightDesktop.getComputerShare(),
  showPictureInPicture: () => window.threadlightDesktop.showComputerShare(),
  stop: () => window.threadlightDesktop.stopComputerShare(),
  subscribe: (listener) =>
    window.threadlightDesktop.onComputerShareChanged(listener),
};
const computerPermissions: ComputerPermissionAdapter = {
  load: () => window.threadlightDesktop.getComputerPermissions(),
  request: (capability) =>
    window.threadlightDesktop.requestComputerPermission(capability),
  relaunch: () =>
    window.threadlightDesktop.relaunchForComputerPermissions(),
  subscribe: (listener) =>
    window.threadlightDesktop.onComputerPermissionChanged(listener),
};
const terminal: TerminalAdapter = {
  create: (request) => window.threadlightDesktop.createTerminal(request),
  write: (request) => window.threadlightDesktop.writeTerminal(request),
  resize: (request) => window.threadlightDesktop.resizeTerminal(request),
  close: (sessionId) => window.threadlightDesktop.closeTerminal(sessionId),
  subscribe: (listener) =>
    window.threadlightDesktop.onTerminalEvent(listener),
};
const workspace: WorkspaceAdapter = {
  getChanges: (projectId, threadId) =>
    window.threadlightDesktop.getConversationChanges({ projectId, threadId }),
  restoreChanges: (projectId, threadId, revision, paths) =>
    window.threadlightDesktop.restoreConversationChanges({
      projectId,
      threadId,
      revision,
      ...(paths ? { paths } : {}),
    }),
  list: (projectId, path, threadId) =>
    window.threadlightDesktop.listWorkspace({
      projectId,
      ...(threadId ? { threadId } : {}),
      ...(path ? { path } : {}),
    }),
  read: (projectId, path, threadId) =>
    window.threadlightDesktop.getWorkspaceFile({
      projectId,
      path,
      ...(threadId ? { threadId } : {}),
    }),
  reveal: (projectId, path, threadId) =>
    window.threadlightDesktop.revealWorkspaceFile({
      projectId,
      path,
      ...(threadId ? { threadId } : {}),
    }),
  chooseSystemFile: () => window.threadlightDesktop.chooseSystemFile(),
  readSystemFile: (path) =>
    window.threadlightDesktop.getSystemFile({ path }),
  revealSystemFile: (path) =>
    window.threadlightDesktop.revealSystemFile({ path }),
};
const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <ThreadlightApp
    client={client}
    clipboard={clipboard}
    settings={settings}
    diagnostics={diagnostics}
    projects={projects}
    projectOpener={projectOpener}
    memory={memory}
    voiceInput={voiceInput}
    attachmentStage={attachmentStage}
    attachmentPreview={attachmentPreview}
    computerShare={computerShare}
    computerPermissions={computerPermissions}
    terminal={terminal}
    workspace={workspace}
  />,
);
