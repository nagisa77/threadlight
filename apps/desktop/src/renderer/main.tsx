import { createRoot } from "react-dom/client";
import { ThreadlightClient } from "@threadlight/client";
import {
  ThreadlightApp,
  type AttachmentPreviewAdapter,
  type AttachmentStageAdapter,
  type ComputerShareAdapter,
  type ProjectMemoryAdapter,
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
const settings: SettingsAdapter = {
  load: () => window.threadlightDesktop.getSettings(),
  save: (update) => window.threadlightDesktop.updateSettings(update),
};
const projects: ProjectsAdapter = {
  load: () => window.threadlightDesktop.getProjects(),
  openFolder: () => window.threadlightDesktop.openProject(),
  activate: (projectId) =>
    window.threadlightDesktop.activateProject(projectId),
  upsertConversation: (update) =>
    window.threadlightDesktop.upsertConversation(update),
  deleteConversation: (target) =>
    window.threadlightDesktop.deleteConversation(target),
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
  list: (projectId, path) =>
    window.threadlightDesktop.listWorkspace({ projectId, path }),
  read: (projectId, path) =>
    window.threadlightDesktop.getWorkspaceFile({ projectId, path }),
};
const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <ThreadlightApp
    client={client}
    settings={settings}
    projects={projects}
    memory={memory}
    voiceInput={voiceInput}
    attachmentStage={attachmentStage}
    attachmentPreview={attachmentPreview}
    computerShare={computerShare}
    terminal={terminal}
    workspace={workspace}
  />,
);
