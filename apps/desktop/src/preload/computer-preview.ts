import { contextBridge, ipcRenderer } from "electron";

import {
  DESKTOP_COMPUTER_PREVIEW_CLOSE_CHANNEL,
  DESKTOP_COMPUTER_PREVIEW_DRAG_CHANNEL,
  DESKTOP_COMPUTER_PREVIEW_RESIZE_CHANNEL,
} from "../shared/computer-preview-api.js";

contextBridge.exposeInMainWorld("threadlightComputerPreview", {
  close() {
    ipcRenderer.send(DESKTOP_COMPUTER_PREVIEW_CLOSE_CHANNEL);
  },
  resize(deltaY: number) {
    ipcRenderer.send(DESKTOP_COMPUTER_PREVIEW_RESIZE_CHANNEL, deltaY);
  },
  drag(phase: "start" | "move" | "end", x: number, y: number) {
    ipcRenderer.send(DESKTOP_COMPUTER_PREVIEW_DRAG_CHANNEL, {
      phase,
      x,
      y,
    });
  },
});
