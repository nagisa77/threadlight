import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { JsonRpcOutgoing } from "@threadlight/protocol";

import {
  DESKTOP_AUDIO_TRANSCRIBE_CHANNEL,
  DESKTOP_ATTACHMENT_REFERENCE_CHANNEL,
  DESKTOP_AUTOMATIONS_CHANGED_CHANNEL,
  DESKTOP_AUTOMATIONS_CREATE_CHANNEL,
  DESKTOP_AUTOMATIONS_DELETE_CHANNEL,
  DESKTOP_AUTOMATIONS_GET_CHANNEL,
  DESKTOP_AUTOMATIONS_RUN_CHANNEL,
  DESKTOP_AUTOMATIONS_UPDATE_CHANNEL,
  DESKTOP_AUTOMATION_OPEN_CHANNEL,
  DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_SHARE_GET_CHANNEL,
  DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL,
  DESKTOP_COMPUTER_SHARE_STOP_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL,
  DESKTOP_CLIPBOARD_WRITE_CHANNEL,
  DESKTOP_EXTERNAL_OPEN_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_APPLY_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_COMMIT_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_PREFLIGHT_CHANNEL,
  DESKTOP_CODE_HOST_DELIVERY_STATUS_CHANNEL,
  DESKTOP_CODE_HOST_DELIVERY_COMMIT_PUSH_CHANNEL,
  DESKTOP_CODE_HOST_DELIVERY_CREATE_PR_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_CONVERSATION_DELETE_CHANNEL,
  DESKTOP_CONVERSATION_READ_CHANNEL,
  DESKTOP_CONVERSATION_UPDATE_CHANNEL,
  DESKTOP_CONVERSATION_UPSERT_CHANNEL,
  DESKTOP_DIAGNOSTICS_GET_CHANNEL,
  DESKTOP_HOST_ACTIVATE_CHANNEL,
  DESKTOP_HOST_DELETE_CHANNEL,
  DESKTOP_HOST_DIRECTORIES_CHANNEL,
  DESKTOP_HOST_UPDATE_CHANNEL,
  DESKTOP_HOSTS_GET_CHANNEL,
  DESKTOP_PROJECT_ACTIVATE_CHANNEL,
  DESKTOP_PROJECT_UPDATE_CHANNEL,
  DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
  DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
  DESKTOP_SEARCH_CHANNEL,
  DESKTOP_PROJECT_OPEN_CHANNEL,
  DESKTOP_STANDALONE_CREATE_CHANNEL,
  DESKTOP_REMOTE_RUNTIME_CONNECT_CHANNEL,
  DESKTOP_PROJECT_OPENERS_GET_CHANNEL,
  DESKTOP_PROJECT_OPEN_WITH_CHANNEL,
  DESKTOP_PROJECTS_GET_CHANNEL,
  DESKTOP_PROVIDER_TEST_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL,
  DESKTOP_SYSTEM_FILE_LIST_CHANNEL,
  DESKTOP_SYSTEM_FILE_GET_CHANNEL,
  DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL,
  DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL,
  DESKTOP_EXECUTION_APPROVAL_RESOLVED_CHANNEL,
  DESKTOP_EXECUTION_APPROVAL_RESPOND_CHANNEL,
  DESKTOP_EXECUTION_POLICY_GET_CHANNEL,
  DESKTOP_EXECUTION_POLICY_REVOKE_CHANNEL,
  DESKTOP_TERMINAL_CLOSE_CHANNEL,
  DESKTOP_TERMINAL_CREATE_CHANNEL,
  DESKTOP_TERMINAL_EVENT_CHANNEL,
  DESKTOP_TERMINAL_RESIZE_CHANNEL,
  DESKTOP_TERMINAL_WRITE_CHANNEL,
  DESKTOP_WORKSPACE_FILE_GET_CHANNEL,
  DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL,
  DESKTOP_WORKSPACE_LIST_CHANNEL,
  type DesktopApi,
  type DesktopAutomationsSnapshot,
  type DesktopComputerPermissionSnapshot,
  type DesktopComputerShareSnapshot,
  type DesktopTerminalEvent,
  type DesktopExecutionApprovalRequest,
} from "../shared/desktop-api.js";

const api: DesktopApi = {
  send(message) {
    ipcRenderer.send(DESKTOP_REQUEST_CHANNEL, message);
  },
  onMessage(listener) {
    const handler = (_event: Electron.IpcRendererEvent, message: JsonRpcOutgoing) => {
      listener(message);
    };
    ipcRenderer.on(DESKTOP_MESSAGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(DESKTOP_MESSAGE_CHANNEL, handler);
  },
  writeClipboardText(text) {
    return ipcRenderer.invoke(DESKTOP_CLIPBOARD_WRITE_CHANNEL, text);
  },
  openExternal(url) {
    return ipcRenderer.invoke(DESKTOP_EXTERNAL_OPEN_CHANNEL, url);
  },
  getSettings() {
    return ipcRenderer.invoke(DESKTOP_SETTINGS_GET_CHANNEL);
  },
  updateSettings(update) {
    return ipcRenderer.invoke(DESKTOP_SETTINGS_UPDATE_CHANNEL, update);
  },
  getDiagnostics(projectId) {
    return ipcRenderer.invoke(DESKTOP_DIAGNOSTICS_GET_CHANNEL, projectId);
  },
  testProvider(request) {
    return ipcRenderer.invoke(DESKTOP_PROVIDER_TEST_CHANNEL, request);
  },
  getProjects() {
    return ipcRenderer.invoke(DESKTOP_PROJECTS_GET_CHANNEL);
  },
  openProject(path) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_OPEN_CHANNEL, path);
  },
  createStandaloneTask() {
    return ipcRenderer.invoke(DESKTOP_STANDALONE_CREATE_CHANNEL);
  },
  getHosts() {
    return ipcRenderer.invoke(DESKTOP_HOSTS_GET_CHANNEL);
  },
  connectRemoteRuntime(request) {
    return ipcRenderer.invoke(
      DESKTOP_REMOTE_RUNTIME_CONNECT_CHANNEL,
      request,
    );
  },
  activateHost(hostId) {
    return ipcRenderer.invoke(DESKTOP_HOST_ACTIVATE_CHANNEL, hostId);
  },
  updateHost(request) {
    return ipcRenderer.invoke(DESKTOP_HOST_UPDATE_CHANNEL, request);
  },
  deleteHost(hostId) {
    return ipcRenderer.invoke(DESKTOP_HOST_DELETE_CHANNEL, hostId);
  },
  listRemoteDirectories(path) {
    return ipcRenderer.invoke(DESKTOP_HOST_DIRECTORIES_CHANNEL, path);
  },
  activateProject(projectId) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_ACTIVATE_CHANNEL, projectId);
  },
  updateProject(update) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_UPDATE_CHANNEL, update);
  },
  getProjectOpeners(projectId) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_OPENERS_GET_CHANNEL, projectId);
  },
  openProjectWith(request) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_OPEN_WITH_CHANNEL, request);
  },
  upsertConversation(update) {
    return ipcRenderer.invoke(DESKTOP_CONVERSATION_UPSERT_CHANNEL, update);
  },
  updateConversation(update) {
    return ipcRenderer.invoke(DESKTOP_CONVERSATION_UPDATE_CHANNEL, update);
  },
  markConversationRead(target) {
    return ipcRenderer.invoke(DESKTOP_CONVERSATION_READ_CHANNEL, target);
  },
  deleteConversation(target) {
    return ipcRenderer.invoke(DESKTOP_CONVERSATION_DELETE_CHANNEL, target);
  },
  getProjectMemory(projectId) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_MEMORY_GET_CHANNEL, projectId);
  },
  openProjectMemory(projectId) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL, projectId);
  },
  search(request) {
    return ipcRenderer.invoke(DESKTOP_SEARCH_CHANNEL, request);
  },
  getAutomations(projectId) {
    return ipcRenderer.invoke(DESKTOP_AUTOMATIONS_GET_CHANNEL, projectId);
  },
  createAutomation(request) {
    return ipcRenderer.invoke(DESKTOP_AUTOMATIONS_CREATE_CHANNEL, request);
  },
  updateAutomation(request) {
    return ipcRenderer.invoke(DESKTOP_AUTOMATIONS_UPDATE_CHANNEL, request);
  },
  deleteAutomation(target) {
    return ipcRenderer.invoke(DESKTOP_AUTOMATIONS_DELETE_CHANNEL, target);
  },
  runAutomation(target) {
    return ipcRenderer.invoke(DESKTOP_AUTOMATIONS_RUN_CHANNEL, target);
  },
  onAutomationsChanged(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: DesktopAutomationsSnapshot,
    ) => listener(snapshot);
    ipcRenderer.on(DESKTOP_AUTOMATIONS_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_AUTOMATIONS_CHANGED_CHANNEL, handler);
  },
  onAutomationOpen(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      target: { projectId: string; id: string },
    ) => listener(target);
    ipcRenderer.on(DESKTOP_AUTOMATION_OPEN_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_AUTOMATION_OPEN_CHANNEL, handler);
  },
  onExecutionApprovalRequired(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      request: DesktopExecutionApprovalRequest,
    ) => listener(request);
    ipcRenderer.on(DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL,
        handler,
      );
  },
  onExecutionApprovalResolved(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      requestId: string,
    ) => listener(requestId);
    ipcRenderer.on(DESKTOP_EXECUTION_APPROVAL_RESOLVED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_EXECUTION_APPROVAL_RESOLVED_CHANNEL,
        handler,
      );
  },
  respondExecutionApproval(response) {
    return ipcRenderer.invoke(
      DESKTOP_EXECUTION_APPROVAL_RESPOND_CHANNEL,
      response,
    );
  },
  getExecutionPolicy(projectId) {
    return ipcRenderer.invoke(DESKTOP_EXECUTION_POLICY_GET_CHANNEL, projectId);
  },
  revokeExecutionPolicyGrant(request) {
    return ipcRenderer.invoke(DESKTOP_EXECUTION_POLICY_REVOKE_CHANNEL, request);
  },
  transcribeAudio(request) {
    return ipcRenderer.invoke(DESKTOP_AUDIO_TRANSCRIBE_CHANNEL, request);
  },
  createAttachmentReference(file) {
    const path = webUtils.getPathForFile(file);
    if (!path) throw new Error("无法读取附件的本地路径。");
    return ipcRenderer.invoke(DESKTOP_ATTACHMENT_REFERENCE_CHANNEL, {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      path,
    });
  },
  getComputerShare() {
    return ipcRenderer.invoke(DESKTOP_COMPUTER_SHARE_GET_CHANNEL);
  },
  showComputerShare() {
    return ipcRenderer.invoke(DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL);
  },
  stopComputerShare() {
    return ipcRenderer.invoke(DESKTOP_COMPUTER_SHARE_STOP_CHANNEL);
  },
  onComputerShareChanged(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: DesktopComputerShareSnapshot,
    ) => listener(snapshot);
    ipcRenderer.on(DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
        handler,
      );
  },
  getComputerPermissions() {
    return ipcRenderer.invoke(DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL);
  },
  requestComputerPermission(capability) {
    return ipcRenderer.invoke(
      DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL,
      capability,
    );
  },
  relaunchForComputerPermissions() {
    return ipcRenderer.invoke(DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL);
  },
  onComputerPermissionChanged(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      snapshot: DesktopComputerPermissionSnapshot,
    ) => listener(snapshot);
    ipcRenderer.on(DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL,
        handler,
      );
  },
  createTerminal(request) {
    return ipcRenderer.invoke(DESKTOP_TERMINAL_CREATE_CHANNEL, request);
  },
  writeTerminal(request) {
    ipcRenderer.send(DESKTOP_TERMINAL_WRITE_CHANNEL, request);
  },
  resizeTerminal(request) {
    ipcRenderer.send(DESKTOP_TERMINAL_RESIZE_CHANNEL, request);
  },
  closeTerminal(sessionId) {
    return ipcRenderer.invoke(DESKTOP_TERMINAL_CLOSE_CHANNEL, sessionId);
  },
  onTerminalEvent(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      terminalEvent: DesktopTerminalEvent,
    ) => listener(terminalEvent);
    ipcRenderer.on(DESKTOP_TERMINAL_EVENT_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(DESKTOP_TERMINAL_EVENT_CHANNEL, handler);
  },
  getConversationChanges(request) {
    return ipcRenderer.invoke(DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL, request);
  },
  restoreConversationChanges(request) {
    return ipcRenderer.invoke(
      DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL,
      request,
    );
  },
  preflightWorktreeDelivery(request) {
    return ipcRenderer.invoke(
      DESKTOP_WORKTREE_DELIVERY_PREFLIGHT_CHANNEL,
      request,
    );
  },
  applyWorktreeDelivery(request) {
    return ipcRenderer.invoke(
      DESKTOP_WORKTREE_DELIVERY_APPLY_CHANNEL,
      request,
    );
  },
  commitWorktreeDelivery(request) {
    return ipcRenderer.invoke(
      DESKTOP_WORKTREE_DELIVERY_COMMIT_CHANNEL,
      request,
    );
  },
  getCodeHostDeliveryStatus(request) {
    return ipcRenderer.invoke(
      DESKTOP_CODE_HOST_DELIVERY_STATUS_CHANNEL,
      request,
    );
  },
  commitAndPushCodeHostDelivery(request) {
    return ipcRenderer.invoke(
      DESKTOP_CODE_HOST_DELIVERY_COMMIT_PUSH_CHANNEL,
      request,
    );
  },
  createDraftPullRequest(request) {
    return ipcRenderer.invoke(
      DESKTOP_CODE_HOST_DELIVERY_CREATE_PR_CHANNEL,
      request,
    );
  },
  listWorkspace(request) {
    return ipcRenderer.invoke(DESKTOP_WORKSPACE_LIST_CHANNEL, request);
  },
  getWorkspaceFile(request) {
    return ipcRenderer.invoke(DESKTOP_WORKSPACE_FILE_GET_CHANNEL, request);
  },
  revealWorkspaceFile(request) {
    return ipcRenderer.invoke(DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL, request);
  },
  chooseSystemFile() {
    return ipcRenderer.invoke(DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL);
  },
  listSystemFiles(path) {
    return ipcRenderer.invoke(DESKTOP_SYSTEM_FILE_LIST_CHANNEL, { path });
  },
  getSystemFile(request) {
    return ipcRenderer.invoke(DESKTOP_SYSTEM_FILE_GET_CHANNEL, request);
  },
  revealSystemFile(request) {
    return ipcRenderer.invoke(DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL, request);
  },
};

contextBridge.exposeInMainWorld("threadlightDesktop", api);
