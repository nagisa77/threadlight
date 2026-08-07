import { createRoot } from "react-dom/client";
import { ThreadlightClient } from "@threadlight/client";
import { ThreadlightApp } from "@threadlight/ui/app";
import {
  type AttachmentPreviewAdapter,
  type AttachmentStageAdapter,
  type AutomationAdapter,
  type ClipboardAdapter,
  type ComputerPermissionAdapter,
  type ComputerShareAdapter,
  type ConnectorAuthorizationAdapter,
  type DiagnosticsAdapter,
  type ExecutionPolicyAdapter,
  type ProjectMemoryAdapter,
  type ProjectOpenerAdapter,
  type ProjectsAdapter,
  type SearchAdapter,
  type SettingsAdapter,
  type TerminalAdapter,
  type VoiceInputAdapter,
  type WorkspaceAdapter,
} from "@threadlight/ui";
import "@threadlight/ui/styles.css";

import { ElectronTransport } from "./electron-transport.js";
import { attachmentPreviewUrl } from "./attachment-preview.js";

document.documentElement.dataset.platform = "desktop";
if (window.threadlightDesktop.isMacOS) {
  document.documentElement.dataset.os = "macos";
}

const client = new ThreadlightClient(new ElectronTransport());
const clipboard: ClipboardAdapter = {
  writeText: (text) => window.threadlightDesktop.writeClipboardText(text),
};
const connectorAuthorization: ConnectorAuthorizationAdapter = {
  async authorize<Result>(action: () => Promise<Result>) {
    let rejectOpen!: (error: unknown) => void;
    const openFailure = new Promise<never>((_resolve, reject) => {
      rejectOpen = reject;
    });
    const unsubscribe = client.on(
      "connector/authorization-requested",
      ({ url }) => {
        void window.threadlightDesktop.openExternal(url).catch(rejectOpen);
      },
    );
    try {
      return await Promise.race([action(), openFailure]);
    } finally {
      unsubscribe();
    }
  },
};
const settings: SettingsAdapter = {
  load: () => window.threadlightDesktop.getSettings(),
  save: (update) => window.threadlightDesktop.updateSettings(update),
  testProvider: (request) => window.threadlightDesktop.testProvider(request),
};
const diagnostics: DiagnosticsAdapter = {
  load: (projectId) => window.threadlightDesktop.getDiagnostics(projectId),
  exportBundle: (projectId, conversationIds) =>
    window.threadlightDesktop.exportDiagnostics(projectId, conversationIds),
};
const projects: ProjectsAdapter = {
  load: () => window.threadlightDesktop.getProjects(),
  openFolder: (path) => window.threadlightDesktop.openProject(path),
  createStandalone: () => window.threadlightDesktop.createStandaloneTask(),
  loadHosts: () => window.threadlightDesktop.getHosts(),
  connectRemote: (request) =>
    window.threadlightDesktop.connectRemoteRuntime(request),
  activateHost: (hostId) =>
    window.threadlightDesktop.activateHost(hostId),
  updateRemoteHost: (request) =>
    window.threadlightDesktop.updateHost(request),
  deleteRemoteHost: (hostId) =>
    window.threadlightDesktop.deleteHost(hostId),
  listRemoteDirectories: (path) =>
    window.threadlightDesktop.listRemoteDirectories(path),
  activate: (projectId) =>
    window.threadlightDesktop.activateProject(projectId),
  updateProject: (update) =>
    window.threadlightDesktop.updateProject(update),

  deleteProject: (projectId) =>
    window.threadlightDesktop.deleteProject(projectId),
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
const search: SearchAdapter = {
  search: (projectId, threadId, query, mode) =>
    window.threadlightDesktop.search({
      projectId,
      ...(threadId ? { threadId } : {}),
      query,
      mode,
    }),
};
const automations: AutomationAdapter = {
  load: (projectId) => window.threadlightDesktop.getAutomations(projectId),
  create: (request) => window.threadlightDesktop.createAutomation(request),
  update: (request) => window.threadlightDesktop.updateAutomation(request),
  delete: (projectId, id) =>
    window.threadlightDesktop.deleteAutomation({ projectId, id }),
  run: (projectId, id) =>
    window.threadlightDesktop.runAutomation({ projectId, id }),
  subscribe: (listener) =>
    window.threadlightDesktop.onAutomationsChanged(listener),
  subscribeOpen: (listener) =>
    window.threadlightDesktop.onAutomationOpen(listener),
};
const executionPolicy: ExecutionPolicyAdapter = {
  subscribe: (listener) =>
    window.threadlightDesktop.onExecutionApprovalRequired(listener),
  subscribeResolved: (listener) =>
    window.threadlightDesktop.onExecutionApprovalResolved(listener),
  respond: (requestId, decision, scope) =>
    window.threadlightDesktop.respondExecutionApproval({
      requestId,
      decision,
      scope,
    }),
  load: (projectId) =>
    window.threadlightDesktop.getExecutionPolicy(projectId),
  revoke: (projectId, permissionKey) =>
    window.threadlightDesktop.revokeExecutionPolicyGrant({
      projectId,
      permissionKey,
    }),
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
      ? attachmentPreviewUrl(
          attachment.path,
          attachment.id,
          attachment.mimeType,
        )
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
  preflightDelivery: (projectId, threadId, revision) =>
    window.threadlightDesktop.preflightWorktreeDelivery({
      projectId,
      threadId,
      revision,
    }),
  getDeliveryHistory: (projectId, threadId) =>
    window.threadlightDesktop.getWorktreeDeliveryHistory({
      projectId,
      threadId,
    }),
  applyDelivery: (projectId, threadId, revision) =>
    window.threadlightDesktop.applyWorktreeDelivery({
      projectId,
      threadId,
      revision,
    }),
  undoDelivery: (projectId, threadId, revision) =>
    window.threadlightDesktop.undoWorktreeDelivery({
      projectId,
      threadId,
      revision,
    }),
  commitDelivery: (projectId, threadId, revision, message) =>
    window.threadlightDesktop.commitWorktreeDelivery({
      projectId,
      threadId,
      revision,
      message,
    }),
  getCodeHostStatus: (projectId, threadId, revision) =>
    window.threadlightDesktop.getCodeHostDeliveryStatus({
      projectId,
      threadId,
      revision,
    }),
  commitAndPush: (projectId, threadId, revision, message) =>
    window.threadlightDesktop.commitAndPushCodeHostDelivery({
      projectId,
      threadId,
      revision,
      message,
    }),
  createPullRequest: (
    projectId,
    threadId,
    revision,
    title,
    body,
    draft,
  ) =>
    window.threadlightDesktop.createPullRequest({
      projectId,
      threadId,
      revision,
      title,
      draft: draft !== false,
      ...(body?.trim() ? { body } : {}),
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
  listSystemFiles: (path) =>
    window.threadlightDesktop.listSystemFiles(path),
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
    connectorAuthorization={connectorAuthorization}
    settings={settings}
    diagnostics={diagnostics}
    projects={projects}
    projectOpener={projectOpener}
    memory={memory}
    search={search}
    automations={automations}
    voiceInput={voiceInput}
    attachmentStage={attachmentStage}
    attachmentPreview={attachmentPreview}
    computerShare={computerShare}
    computerPermissions={computerPermissions}
    terminal={terminal}
    workspace={workspace}
    executionPolicy={executionPolicy}
  />,
);
