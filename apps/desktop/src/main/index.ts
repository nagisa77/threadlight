import { join, resolve } from "node:path";

import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  safeStorage,
  shell,
} from "electron";
import {
  THREADLIGHT_METHODS,
  type JsonRpcOutgoing,
  type JsonRpcRequest,
  type ThreadlightMethod,
} from "@threadlight/protocol";

import { AppServerProcess } from "./app-server-process.js";
import { createExternalWindowHandler } from "./external-links.js";
import { runtimeEnvironment, SettingsStore } from "./settings-store.js";
import {
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  type DesktopSettingsUpdate,
} from "../shared/desktop-api.js";

let mainWindow: BrowserWindow | null = null;
let appServer: AppServerProcess | null = null;
let settingsStore: SettingsStore | null = null;

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

  window.webContents.setWindowOpenHandler(
    createExternalWindowHandler((url) => shell.openExternal(url)),
  );
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
    environment: runtimeEnvironment(
      settingsStore?.runtimeSettings() ?? { autoApproveAll: false },
    ),
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

function handleSettingsGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");
  return settingsStore.snapshot();
}

function handleSettingsUpdate(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");

  const update = parseSettingsUpdate(value);
  const snapshot = settingsStore.update(update);
  appServer?.restart(runtimeEnvironment(settingsStore.runtimeSettings()));
  return snapshot;
}

function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Settings request came from an untrusted frame");
  }
}

function parseSettingsUpdate(value: unknown): DesktopSettingsUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings update");
  }
  const update = value as Record<string, unknown>;
  if (typeof update.autoApproveAll !== "boolean") {
    throw new Error("autoApproveAll must be a boolean");
  }
  if (!isOptionalSecret(update.openAIApiKey)) {
    throw new Error("openAIApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.searchApiKey)) {
    throw new Error("searchApiKey must be a string or null");
  }
  return {
    autoApproveAll: update.autoApproveAll,
    ...(update.openAIApiKey !== undefined
      ? { openAIApiKey: update.openAIApiKey }
      : {}),
    ...(update.searchApiKey !== undefined
      ? { searchApiKey: update.searchApiKey }
      : {}),
  } as DesktopSettingsUpdate;
}

function isOptionalSecret(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
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
  settingsStore = new SettingsStore(
    join(app.getPath("userData"), "settings.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  ipcMain.on(DESKTOP_REQUEST_CHANNEL, handleRequest);
  ipcMain.handle(DESKTOP_SETTINGS_GET_CHANNEL, handleSettingsGet);
  ipcMain.handle(DESKTOP_SETTINGS_UPDATE_CHANNEL, handleSettingsUpdate);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => appServer?.stop());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
