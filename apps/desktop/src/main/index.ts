import { join, resolve } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
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
import { ProjectMemoryStore } from "@threadlight/project-memory";

import { AppServerProcess } from "./app-server-process.js";
import { createExternalWindowHandler } from "./external-links.js";
import {
  DEFAULT_MODEL,
  DEFAULT_QWEN_BASE_URL,
  runtimeEnvironment,
  SettingsStore,
} from "./settings-store.js";
import { ProjectStore } from "./project-store.js";
import {
  DESKTOP_CONVERSATION_DELETE_CHANNEL,
  DESKTOP_CONVERSATION_UPSERT_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_PROJECT_ACTIVATE_CHANNEL,
  DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
  DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
  DESKTOP_PROJECT_OPEN_CHANNEL,
  DESKTOP_PROJECTS_GET_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  type DesktopConversationTarget,
  type DesktopSettingsUpdate,
  type DesktopConversationUpdate,
} from "../shared/desktop-api.js";

let mainWindow: BrowserWindow | null = null;
let appServer: AppServerProcess | null = null;
let settingsStore: SettingsStore | null = null;
let projectStore: ProjectStore | null = null;
const appIconPath = resolve(
  import.meta.dirname,
  "../../resources/app-icon.png",
);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: "Threadlight",
    icon: appIconPath,
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

  const activeProject = projectStore?.activeProject();
  if (activeProject) startAppServer(window, activeProject.basePath);

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(resolve(import.meta.dirname, "../renderer/index.html"));
  }
}

function startAppServer(window: BrowserWindow, cwd: string): void {
  appServer?.stop();
  appServer = new AppServerProcess({
    entry:
      process.env.THREADLIGHT_APP_SERVER_PATH ??
      resolve(app.getAppPath(), "../../packages/app-server/dist/bin.js"),
    cwd,
    environment: runtimeEnvironment(
      settingsStore?.runtimeSettings() ?? {
        provider: "openai",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: DEFAULT_MODEL,
        autoApproveAll: false,
      },
    ),
    send: (message) => sendToRenderer(window, message),
  });
  appServer.start();
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
  const activeProject = projectStore?.activeProject();
  if (mainWindow && activeProject) {
    startAppServer(mainWindow, activeProject.basePath);
  }
  return snapshot;
}

function handleProjectsGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  return projectStore.snapshot();
}

async function handleProjectOpen(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!projectStore || !mainWindow) {
    throw new Error("Projects are not available");
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开项目文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return projectStore.snapshot();

  const snapshot = projectStore.register(result.filePaths[0]);
  const activeProject = projectStore.activeProject();
  if (activeProject) startAppServer(mainWindow, activeProject.basePath);
  return snapshot;
}

function handleProjectActivate(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectStore || !mainWindow) {
    throw new Error("Projects are not available");
  }
  if (typeof value !== "string" || !value) throw new Error("Invalid project id");

  const snapshot = projectStore.activate(value);
  const activeProject = projectStore.activeProject();
  if (activeProject) startAppServer(mainWindow, activeProject.basePath);
  return snapshot;
}

function handleConversationUpsert(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  return projectStore.upsertConversation(parseConversationUpdate(value));
}

function handleConversationDelete(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  return projectStore.deleteConversation(parseConversationTarget(value));
}

async function handleProjectMemoryGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const project = requireProject(value);
  const snapshot = await new ProjectMemoryStore(project.basePath).read();
  return {
    path: snapshot.path,
    content: snapshot.content,
    revision: snapshot.revision,
  };
}

async function handleProjectMemoryOpen(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<void> {
  requireTrustedSender(event);
  const project = requireProject(value);
  const snapshot = await new ProjectMemoryStore(project.basePath).read();
  const error = await shell.openPath(snapshot.absolutePath);
  if (error) throw new Error(error);
}

function requireProject(value: unknown) {
  if (!projectStore) throw new Error("Projects are not available");
  if (typeof value !== "string" || !value) throw new Error("Invalid project id");
  const project = projectStore.project(value);
  if (!project) throw new Error(`Unknown project: ${value}`);
  return project;
}

function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("Desktop request came from an untrusted frame");
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
  if (!isModelProvider(update.provider)) {
    throw new Error("provider must be openai, deepseek, or qwen");
  }
  if (!isOptionalSecret(update.openAIApiKey)) {
    throw new Error("openAIApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.deepSeekApiKey)) {
    throw new Error("deepSeekApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.qwenApiKey)) {
    throw new Error("qwenApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.searchApiKey)) {
    throw new Error("searchApiKey must be a string or null");
  }
  if (typeof update.model !== "string" || !update.model.trim()) {
    throw new Error("model must be a non-empty string");
  }
  if (typeof update.qwenBaseUrl !== "string" || !update.qwenBaseUrl.trim()) {
    throw new Error("qwenBaseUrl must be a non-empty string");
  }
  return {
    provider: update.provider,
    model: update.model.trim(),
    qwenBaseUrl: update.qwenBaseUrl.trim(),
    autoApproveAll: update.autoApproveAll,
    ...(update.openAIApiKey !== undefined
      ? { openAIApiKey: update.openAIApiKey }
      : {}),
    ...(update.deepSeekApiKey !== undefined
      ? { deepSeekApiKey: update.deepSeekApiKey }
      : {}),
    ...(update.qwenApiKey !== undefined
      ? { qwenApiKey: update.qwenApiKey }
      : {}),
    ...(update.searchApiKey !== undefined
      ? { searchApiKey: update.searchApiKey }
      : {}),
  } as DesktopSettingsUpdate;
}

function isModelProvider(
  value: unknown,
): value is DesktopSettingsUpdate["provider"] {
  return value === "openai" || value === "deepseek" || value === "qwen";
}

function isOptionalSecret(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function parseConversationUpdate(value: unknown): DesktopConversationUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation update");
  }
  const update = value as Record<string, unknown>;
  if (
    typeof update.projectId !== "string" ||
    typeof update.id !== "string" ||
    typeof update.title !== "string"
  ) {
    throw new Error("Invalid conversation update");
  }
  return { projectId: update.projectId, id: update.id, title: update.title };
}

function parseConversationTarget(value: unknown): DesktopConversationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation target");
  }
  const target = value as Record<string, unknown>;
  if (typeof target.projectId !== "string" || typeof target.id !== "string") {
    throw new Error("Invalid conversation target");
  }
  return { projectId: target.projectId, id: target.id };
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
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath);

  const threadlightHome =
    process.env.THREADLIGHT_HOME ?? join(app.getPath("home"), ".threadlight");
  settingsStore = new SettingsStore(
    join(threadlightHome, "settings.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  projectStore = new ProjectStore(join(threadlightHome, "project-map.json"));
  const initialWorkspace = process.env.THREADLIGHT_WORKSPACE;
  if (initialWorkspace) projectStore.register(initialWorkspace);
  ipcMain.on(DESKTOP_REQUEST_CHANNEL, handleRequest);
  ipcMain.handle(DESKTOP_SETTINGS_GET_CHANNEL, handleSettingsGet);
  ipcMain.handle(DESKTOP_SETTINGS_UPDATE_CHANNEL, handleSettingsUpdate);
  ipcMain.handle(DESKTOP_PROJECTS_GET_CHANNEL, handleProjectsGet);
  ipcMain.handle(DESKTOP_PROJECT_OPEN_CHANNEL, handleProjectOpen);
  ipcMain.handle(DESKTOP_PROJECT_ACTIVATE_CHANNEL, handleProjectActivate);
  ipcMain.handle(
    DESKTOP_CONVERSATION_UPSERT_CHANNEL,
    handleConversationUpsert,
  );
  ipcMain.handle(
    DESKTOP_CONVERSATION_DELETE_CHANNEL,
    handleConversationDelete,
  );
  ipcMain.handle(DESKTOP_PROJECT_MEMORY_GET_CHANNEL, handleProjectMemoryGet);
  ipcMain.handle(DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL, handleProjectMemoryOpen);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => appServer?.stop());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
