import { contextBridge, ipcRenderer } from "electron";
import type { JsonRpcOutgoing } from "@threadlight/protocol";

import {
  DESKTOP_MESSAGE_CHANNEL,
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
};

contextBridge.exposeInMainWorld("threadlightDesktop", api);
