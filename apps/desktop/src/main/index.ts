import { resolve } from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
} from "electron";
import {
  THREADLIGHT_METHODS,
  type JsonRpcOutgoing,
  type JsonRpcRequest,
  type ThreadlightMethod,
} from "@threadlight/protocol";

import { AppServerProcess } from "./app-server-process.js";
import {
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
} from "../shared/desktop-api.js";

let mainWindow: BrowserWindow | null = null;
let appServer: AppServerProcess | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: "Threadlight",
    backgroundColor: "#f7f6f2",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: resolve(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    appServer?.stop();
    appServer = null;
  });

  appServer = new AppServerProcess({
    entry:
      process.env.THREADLIGHT_APP_SERVER_PATH ??
      resolve(app.getAppPath(), "../../packages/app-server/dist/bin.js"),
    cwd:
      process.env.THREADLIGHT_WORKSPACE ?? resolve(app.getAppPath(), "../.."),
    send: (message) => sendToRenderer(window, message),
  });
  appServer.start();

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(resolve(import.meta.dirname, "../renderer/index.html"));
  }
}

function handleRequest(event: IpcMainEvent, value: unknown): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    return;
  }
  if (!isJsonRpcRequest(value)) {
    const id = extractId(value);
    if (id !== undefined) {
      sendToRenderer(mainWindow, {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      });
    }
    return;
  }
  appServer?.send(value);
}

function sendToRenderer(window: BrowserWindow, message: JsonRpcOutgoing): void {
  if (!window.isDestroyed()) {
    window.webContents.send(DESKTOP_MESSAGE_CHANNEL, message);
  }
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    typeof request.method === "string" &&
    THREADLIGHT_METHODS.includes(request.method as ThreadlightMethod)
  );
}

function extractId(value: unknown): string | number | null | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const id = (value as Record<string, unknown>).id;
  if (id === null || typeof id === "string" || typeof id === "number") return id;
}

app.whenReady().then(() => {
  ipcMain.on(DESKTOP_REQUEST_CHANNEL, handleRequest);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => appServer?.stop());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
