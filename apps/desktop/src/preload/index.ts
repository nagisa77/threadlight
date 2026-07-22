import { contextBridge, ipcRenderer } from "electron";
import type { JsonRpcOutgoing } from "@threadlight/protocol";

import {
  DESKTOP_AUDIO_TRANSCRIBE_CHANNEL,
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
};

contextBridge.exposeInMainWorld("threadlightDesktop", api);
