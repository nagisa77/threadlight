import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { JsonRpcOutgoing } from "@threadlight/protocol";

import {
  DESKTOP_AUDIO_TRANSCRIBE_CHANNEL,
  DESKTOP_ATTACHMENT_REFERENCE_CHANNEL,
  DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_SHARE_GET_CHANNEL,
  DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL,
  DESKTOP_COMPUTER_SHARE_STOP_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_CONVERSATION_DELETE_CHANNEL,
  DESKTOP_CONVERSATION_UPSERT_CHANNEL,
  DESKTOP_PROJECT_ACTIVATE_CHANNEL,
  DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
  DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
  DESKTOP_PROJECT_OPEN_CHANNEL,
  DESKTOP_PROJECTS_GET_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  type DesktopApi,
  type DesktopComputerShareSnapshot,
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
  getSettings() {
    return ipcRenderer.invoke(DESKTOP_SETTINGS_GET_CHANNEL);
  },
  updateSettings(update) {
    return ipcRenderer.invoke(DESKTOP_SETTINGS_UPDATE_CHANNEL, update);
  },
  getProjects() {
    return ipcRenderer.invoke(DESKTOP_PROJECTS_GET_CHANNEL);
  },
  openProject() {
    return ipcRenderer.invoke(DESKTOP_PROJECT_OPEN_CHANNEL);
  },
  activateProject(projectId) {
    return ipcRenderer.invoke(DESKTOP_PROJECT_ACTIVATE_CHANNEL, projectId);
  },
  upsertConversation(update) {
    return ipcRenderer.invoke(DESKTOP_CONVERSATION_UPSERT_CHANNEL, update);
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
};

contextBridge.exposeInMainWorld("threadlightDesktop", api);
