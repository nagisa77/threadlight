import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  nativeImage,
  protocol,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  safeStorage,
  shell,
} from "electron";
import {
  THREADLIGHT_METHODS,
  type AttachmentData,
  type JsonRpcId,
  type JsonRpcOutgoing,
  type JsonRpcRequest,
  type ThreadlightMethod,
} from "@threadlight/protocol";
import { ProjectMemoryStore } from "@threadlight/project-memory";

import { AppServerProcess } from "./app-server-process.js";
import {
  COMPUTER_CAPTURE_URL,
  computerCaptureHtml,
} from "./computer-capture.js";
import {
  COMPUTER_PREVIEW_URL,
  computerPreviewHtml,
} from "./computer-preview.js";
import { DesktopComputerService } from "./computer-service.js";
import {
  createAttachmentReference,
  resolveAttachmentUrlPath,
} from "./attachment-upload.js";
import {
  parseAudioTranscriptionRequest,
  transcribeAudio,
} from "./audio-transcription.js";
import { createExternalWindowHandler } from "./external-links.js";
import { ConversationChangeTracker } from "./conversation-changes.js";
import {
  DEFAULT_MODEL,
  DEFAULT_QWEN_BASE_URL,
  runtimeEnvironment,
  SettingsStore,
} from "./settings-store.js";
import { ProjectStore } from "./project-store.js";
import {
  openProjectWith,
  projectOpeners,
} from "./project-opener.js";
import {
  TerminalSessionManager,
  type TerminalSessionEvent,
} from "./terminal-session.js";
import {
  DESKTOP_AUDIO_TRANSCRIBE_CHANNEL,
  DESKTOP_ATTACHMENT_REFERENCE_CHANNEL,
  DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_SHARE_GET_CHANNEL,
  DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL,
  DESKTOP_COMPUTER_SHARE_STOP_CHANNEL,
  DESKTOP_CLIPBOARD_WRITE_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
  DESKTOP_CONVERSATION_DELETE_CHANNEL,
  DESKTOP_CONVERSATION_UPSERT_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_PROJECT_ACTIVATE_CHANNEL,
  DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
  DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
  DESKTOP_PROJECT_OPEN_CHANNEL,
  DESKTOP_PROJECT_OPENERS_GET_CHANNEL,
  DESKTOP_PROJECT_OPEN_WITH_CHANNEL,
  DESKTOP_PROJECTS_GET_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  DESKTOP_TERMINAL_CLOSE_CHANNEL,
  DESKTOP_TERMINAL_CREATE_CHANNEL,
  DESKTOP_TERMINAL_EVENT_CHANNEL,
  DESKTOP_TERMINAL_RESIZE_CHANNEL,
  DESKTOP_TERMINAL_WRITE_CHANNEL,
  DESKTOP_WORKSPACE_FILE_GET_CHANNEL,
  DESKTOP_WORKSPACE_LIST_CHANNEL,
  type DesktopAttachmentReferenceRequest,
  type DesktopConversationTarget,
  type DesktopConversationUpdate,
  type DesktopConversationChangesRequest,
  type DesktopProjectOpenWithRequest,
  type DesktopProjectOpener,
  type DesktopSettingsUpdate,
  type DesktopTerminalCreateRequest,
  type DesktopTerminalResizeRequest,
  type DesktopTerminalWriteRequest,
  type DesktopWorkspaceFileRequest,
  type DesktopWorkspaceListRequest,
} from "../shared/desktop-api.js";
import {
  DESKTOP_COMPUTER_PREVIEW_CLOSE_CHANNEL,
  DESKTOP_COMPUTER_PREVIEW_DRAG_CHANNEL,
  DESKTOP_COMPUTER_PREVIEW_RESIZE_CHANNEL,
} from "../shared/computer-preview-api.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "threadlight-attachment",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: "threadlight-computer",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
const appServers = new Map<string, AppServerProcess>();
const threadProjects = new Map<string, string>();
const pendingThreadStarts = new Map<
  string | number | null,
  string
>();
let settingsStore: SettingsStore | null = null;
let projectStore: ProjectStore | null = null;
let computerService: DesktopComputerService | null = null;
let terminalService: TerminalSessionManager | null = null;
let conversationChangeTracker: ConversationChangeTracker | null = null;
let rendererMessageQueue = Promise.resolve();
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

  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission, _requestingOrigin, details) => {
      if (
        computerService?.ownsCaptureWebContents(webContents) &&
        permission === "media"
      ) {
        return true;
      }
      return (
        webContents === window.webContents &&
        permission === "media" &&
        details.isMainFrame &&
        details.mediaType === "audio"
      );
    },
  );
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes =
        "mediaTypes" in details ? details.mediaTypes : undefined;
      if (
        computerService?.ownsCaptureWebContents(webContents) &&
        permission === "media"
      ) {
        callback(true);
        return;
      }
      callback(
        webContents === window.webContents &&
          permission === "media" &&
          details.isMainFrame &&
          !!mediaTypes?.length &&
          mediaTypes.every((type) => type === "audio"),
      );
    },
  );

  window.webContents.setWindowOpenHandler(
    createExternalWindowHandler((url) => shell.openExternal(url)),
  );
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    stopAppServers();
    computerService?.dispose();
    terminalService?.dispose();
  });

  const activeProject = projectStore?.activeProject();
  if (activeProject) ensureAppServer(window, activeProject.id, activeProject.basePath);

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(resolve(import.meta.dirname, "../renderer/index.html"));
  }
}

function ensureAppServer(
  window: BrowserWindow,
  projectId: string,
  cwd: string,
): AppServerProcess {
  const existing = appServers.get(projectId);
  if (existing) {
    existing.start();
    return existing;
  }
  const appServer = new AppServerProcess({
    entry:
      process.env.THREADLIGHT_APP_SERVER_PATH ??
      resolve(app.getAppPath(), "../../packages/app-server/dist/bin.js"),
    cwd,
    environment: runtimeEnvironment(
      settingsStore?.runtimeSettings() ?? {
        provider: "openai",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        model: DEFAULT_MODEL,
      },
    ),
    send: (message) => {
      rendererMessageQueue = rendererMessageQueue
        .then(async () => {
          await recordProjectMessage(projectId, message);
          sendToRenderer(window, message);
        })
        .catch(() => {
          sendToRenderer(window, message);
        });
    },
    handleComputerRequest: (request) => {
      if (!computerService) {
        throw new Error("Desktop computer service is not available");
      }
      return computerService.handle(request);
    },
  });
  appServers.set(projectId, appServer);
  appServer.start();
  return appServer;
}

function stopAppServers(): void {
  for (const appServer of appServers.values()) appServer.stop();
  appServers.clear();
  threadProjects.clear();
  pendingThreadStarts.clear();
}

async function recordProjectMessage(
  projectId: string,
  message: JsonRpcOutgoing,
): Promise<void> {
  if ("method" in message) {
    const threadId = (message.params as { threadId?: unknown } | undefined)
      ?.threadId;
    if (typeof threadId === "string") threadProjects.set(threadId, projectId);
    return;
  }
  const pendingProjectId = pendingThreadStarts.get(message.id);
  if (pendingProjectId !== projectId) return;
  pendingThreadStarts.delete(message.id);
  const threadId = (message.result as { threadId?: unknown } | undefined)
    ?.threadId;
  if (typeof threadId === "string") {
    threadProjects.set(threadId, projectId);
    await conversationChangeTracker?.commitPendingSnapshot(
      projectId,
      requestKey(message.id),
      threadId,
    );
  } else {
    await conversationChangeTracker?.discardPendingSnapshot(
      projectId,
      requestKey(message.id),
    );
  }
}

function projectIdForThread(threadId: string): string | undefined {
  const known = threadProjects.get(threadId);
  if (known) return known;
  const project = projectStore
    ?.snapshot()
    .projects.find((candidate) =>
      candidate.conversations.some((conversation) => conversation.id === threadId),
    );
  if (project) threadProjects.set(threadId, project.id);
  return project?.id;
}

function projectForRequest(request: JsonRpcRequest) {
  const params =
    request.params && typeof request.params === "object"
      ? (request.params as Record<string, unknown>)
      : undefined;
  const threadId = params?.threadId;
  const projectId =
    typeof threadId === "string"
      ? projectIdForThread(threadId)
      : projectStore?.snapshot().activeProjectId;
  return projectId ? projectStore?.project(projectId) : undefined;
}

async function handleRequest(event: IpcMainEvent, value: unknown): Promise<void> {
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
  const project = projectForRequest(value);
  if (!project) {
    if (value.id !== undefined) {
      sendToRenderer(mainWindow, {
        jsonrpc: "2.0",
        id: value.id,
        error: { code: -32010, message: "No project runtime is available" },
      });
    }
    return;
  }
  if (value.method === "thread/start" && value.id !== undefined) {
    try {
      await conversationChangeTracker?.beginPendingSnapshot(
        project.id,
        requestKey(value.id),
        project.basePath,
      );
    } catch (error) {
      if (value.id !== undefined) {
        sendToRenderer(mainWindow, {
          jsonrpc: "2.0",
          id: value.id,
          error: {
            code: -32011,
            message: `Unable to record the task workspace baseline: ${errorMessage(error)}`,
          },
        });
      }
      return;
    }
    pendingThreadStarts.set(value.id, project.id);
  }
  if (
    (value.method === "thread/resume" || value.method === "turn/start") &&
    value.params &&
    typeof value.params === "object"
  ) {
    const threadId = (value.params as Record<string, unknown>).threadId;
    if (typeof threadId === "string") {
      try {
        await conversationChangeTracker?.ensureSnapshot(
          project.id,
          threadId,
          project.basePath,
        );
      } catch (error) {
        if (value.id !== undefined) {
          sendToRenderer(mainWindow, {
            jsonrpc: "2.0",
            id: value.id,
            error: {
              code: -32011,
              message: `Unable to record the task workspace baseline: ${errorMessage(error)}`,
            },
          });
        }
        return;
      }
    }
  }
  ensureAppServer(mainWindow, project.id, project.basePath).send(value);
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
  const previousRuntimeSettings = settingsStore.runtimeSettings();
  const snapshot = settingsStore.update(update);
  const nextRuntimeSettings = settingsStore.runtimeSettings();
  if (
    mainWindow &&
    JSON.stringify(previousRuntimeSettings) !==
      JSON.stringify(nextRuntimeSettings)
  ) {
    const environment = runtimeEnvironment(nextRuntimeSettings);
    for (const appServer of appServers.values()) {
      appServer.restart(environment);
    }
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
  if (activeProject) {
    ensureAppServer(mainWindow, activeProject.id, activeProject.basePath);
  }
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
  if (activeProject) {
    ensureAppServer(mainWindow, activeProject.id, activeProject.basePath);
  }
  return snapshot;
}

async function handleProjectOpenersGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const basePath =
    typeof value === "string" && value
      ? requireProject(value).basePath
      : (projectStore?.activeProject()?.basePath ?? app.getPath("home"));
  const openers = await projectOpeners(basePath);
  return Promise.all(
    openers.map(async (opener) => {
      let iconDataUrl: string | undefined;
      if (opener.iconPath) {
        try {
          const icon = await nativeImage.createThumbnailFromPath(
            opener.iconPath,
            {
              width: 32,
              height: 32,
            },
          );
          if (!icon.isEmpty()) iconDataUrl = icon.toDataURL();
        } catch {
          // Fall through to the system file icon below.
        }
      }
      if (!iconDataUrl && opener.applicationPath) {
        try {
          const icon = await app.getFileIcon(opener.applicationPath, {
            size: "normal",
          });
          if (!icon.isEmpty()) iconDataUrl = icon.toDataURL();
        } catch {
          // The menu has a vector fallback if macOS cannot resolve an icon.
        }
      }
      return {
        id: opener.id,
        label: opener.label,
        available: opener.available,
        default: opener.default,
        ...(iconDataUrl ? { iconDataUrl } : {}),
      };
    }),
  );
}

async function handleProjectOpenWith(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<void> {
  requireTrustedSender(event);
  const request = parseProjectOpenWithRequest(value);
  const project = requireProject(request.projectId);
  const availableOpeners = await projectOpeners(project.basePath);
  if (!availableOpeners.some((opener) => opener.id === request.opener)) {
    throw new Error("The selected project app is no longer available");
  }
  await openProjectWith(project.basePath, request.opener, {
    openPath: (path) => shell.openPath(path),
  });
}

function handleConversationUpsert(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const update = parseConversationUpdate(value);
  threadProjects.set(update.id, update.projectId);
  return projectStore.upsertConversation(update);
}

function handleConversationDelete(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const target = parseConversationTarget(value);
  threadProjects.delete(target.id);
  void conversationChangeTracker
    ?.deleteSnapshot(target.projectId, target.id)
    .catch(() => undefined);
  return projectStore.deleteConversation(target);
}

async function handleConversationChangesGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!conversationChangeTracker) {
    throw new Error("Conversation change tracking is not available");
  }
  const request = parseConversationChangesRequest(value);
  const project = requireProject(request.projectId);
  return conversationChangeTracker.changes(
    project.id,
    request.threadId,
    project.basePath,
  );
}

async function handleWorkspaceList(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!conversationChangeTracker) {
    throw new Error("Workspace browsing is not available");
  }
  const request = parseWorkspaceListRequest(value);
  const project = requireProject(request.projectId);
  return conversationChangeTracker.listWorkspace(
    project.basePath,
    request.path,
  );
}

async function handleWorkspaceFileGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!conversationChangeTracker) {
    throw new Error("Workspace browsing is not available");
  }
  const request = parseWorkspaceFileRequest(value);
  const project = requireProject(request.projectId);
  return conversationChangeTracker.readWorkspaceFile(
    project.basePath,
    request.path,
  );
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

async function handleAudioTranscription(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<string> {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");
  const apiKey = settingsStore.runtimeSettings().openAIApiKey;
  if (!apiKey) {
    throw new Error("请先在设置中配置 OpenAI API Key，再使用语音输入。");
  }
  return transcribeAudio(parseAudioTranscriptionRequest(value), { apiKey });
}

function handleAttachmentReference(
  event: IpcMainInvokeEvent,
  value: unknown,
): AttachmentData {
  requireTrustedSender(event);
  if (!projectStore?.activeProject()) {
    throw new Error("请先打开项目，再添加附件。");
  }
  return createAttachmentReference(parseAttachmentReferenceRequest(value));
}

function handleComputerShareGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!computerService) throw new Error("Computer sharing is not available");
  return computerService.shareSnapshot();
}

function handleComputerShareShow(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!computerService) throw new Error("Computer sharing is not available");
  return computerService.showPictureInPicture();
}

function handleComputerShareStop(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!computerService) throw new Error("Computer sharing is not available");
  return computerService.stopSharing();
}

function handleTerminalCreate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!terminalService) throw new Error("Terminal is not available");
  const request = parseTerminalCreateRequest(value);
  const project = requireProject(request.projectId);
  return terminalService.create(project.basePath, request.cols, request.rows);
}

function handleTerminalWrite(event: IpcMainEvent, value: unknown): void {
  if (!isTrustedSender(event) || !terminalService) return;
  try {
    const request = parseTerminalWriteRequest(value);
    terminalService.write(request.sessionId, request.data);
  } catch {
    // Input can race with a shell exiting. A fire-and-forget IPC event has
    // nowhere useful to surface that stale write, so safely ignore it.
  }
}

function handleTerminalResize(event: IpcMainEvent, value: unknown): void {
  if (!isTrustedSender(event) || !terminalService) return;
  try {
    const request = parseTerminalResizeRequest(value);
    terminalService.resize(request.sessionId, request.cols, request.rows);
  } catch {
    // ResizeObserver can emit once more while an exited terminal is unmounting.
  }
}

function handleTerminalClose(
  event: IpcMainInvokeEvent,
  value: unknown,
): void {
  requireTrustedSender(event);
  if (!terminalService) return;
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid terminal session id");
  }
  terminalService.close(value);
}

function handleComputerPreviewClose(event: IpcMainEvent): void {
  if (!computerService?.ownsPreviewWebContents(event.sender)) return;
  computerService.closePictureInPicture();
}

function handleComputerPreviewResize(
  event: IpcMainEvent,
  value: unknown,
): void {
  if (
    !computerService?.ownsPreviewWebContents(event.sender) ||
    typeof value !== "number"
  ) {
    return;
  }
  computerService.resizePictureInPicture(value);
}

function handleComputerPreviewDrag(
  event: IpcMainEvent,
  value: unknown,
): void {
  if (
    !computerService?.ownsPreviewWebContents(event.sender) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return;
  }
  const drag = value as Record<string, unknown>;
  if (
    (drag.phase !== "start" &&
      drag.phase !== "move" &&
      drag.phase !== "end") ||
    typeof drag.x !== "number" ||
    typeof drag.y !== "number"
  ) {
    return;
  }
  computerService.dragPictureInPicture(drag.phase, drag.x, drag.y);
}

function requireProject(value: unknown) {
  if (!projectStore) throw new Error("Projects are not available");
  if (typeof value !== "string" || !value) throw new Error("Invalid project id");
  const project = projectStore.project(value);
  if (!project) throw new Error(`Unknown project: ${value}`);
  return project;
}

function requireTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Desktop request came from an untrusted frame");
  }
}

function isTrustedSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
): boolean {
  return (
    !!mainWindow &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}

function parseSettingsUpdate(value: unknown): DesktopSettingsUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings update");
  }
  const update = value as Record<string, unknown>;
  if (!isModelProvider(update.provider)) {
    throw new Error("provider must be openai, deepseek, or qwen");
  }
  if (update.language !== undefined && !isLanguage(update.language)) {
    throw new Error("language must be zh-CN, zh-TW, en, ja, or ko");
  }
  if (update.theme !== undefined && !isTheme(update.theme)) {
    throw new Error("theme must be system, light, or dark");
  }
  if (
    update.preferredProjectOpener !== undefined &&
    !isProjectOpenerPreference(update.preferredProjectOpener)
  ) {
    throw new Error("preferredProjectOpener is invalid");
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
    ...(update.language !== undefined ? { language: update.language } : {}),
    ...(update.theme !== undefined ? { theme: update.theme } : {}),
    ...(update.preferredProjectOpener !== undefined
      ? { preferredProjectOpener: update.preferredProjectOpener }
      : {}),
    provider: update.provider,
    model: update.model.trim(),
    qwenBaseUrl: update.qwenBaseUrl.trim(),
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

function isLanguage(
  value: unknown,
): value is NonNullable<DesktopSettingsUpdate["language"]> {
  return (
    value === "zh-CN" ||
    value === "zh-TW" ||
    value === "en" ||
    value === "ja" ||
    value === "ko"
  );
}

function isTheme(
  value: unknown,
): value is NonNullable<DesktopSettingsUpdate["theme"]> {
  return value === "system" || value === "light" || value === "dark";
}

function isProjectOpener(value: unknown): value is DesktopProjectOpener {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 255
  );
}

function isProjectOpenerPreference(
  value: unknown,
): value is DesktopProjectOpener {
  return typeof value === "string" && value.length <= 255;
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

function parseProjectOpenWithRequest(
  value: unknown,
): DesktopProjectOpenWithRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid project opener request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    !request.projectId ||
    !isProjectOpener(request.opener)
  ) {
    throw new Error("Invalid project opener request");
  }
  return { projectId: request.projectId, opener: request.opener };
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

function parseConversationChangesRequest(
  value: unknown,
): DesktopConversationChangesRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation changes request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    typeof request.threadId !== "string"
  ) {
    throw new Error("Invalid conversation changes request");
  }
  return { projectId: request.projectId, threadId: request.threadId };
}

function parseWorkspaceListRequest(
  value: unknown,
): DesktopWorkspaceListRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace list request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    (request.path !== undefined && typeof request.path !== "string")
  ) {
    throw new Error("Invalid workspace list request");
  }
  return {
    projectId: request.projectId,
    ...(typeof request.path === "string" ? { path: request.path } : {}),
  };
}

function parseWorkspaceFileRequest(
  value: unknown,
): DesktopWorkspaceFileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace file request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    typeof request.path !== "string"
  ) {
    throw new Error("Invalid workspace file request");
  }
  return { projectId: request.projectId, path: request.path };
}

function parseAttachmentReferenceRequest(
  value: unknown,
): DesktopAttachmentReferenceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid attachment reference");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.name !== "string" ||
    typeof request.mimeType !== "string" ||
    typeof request.size !== "number" ||
    typeof request.path !== "string"
  ) {
    throw new Error("Invalid attachment reference");
  }
  return {
    name: request.name,
    mimeType: request.mimeType,
    size: request.size,
    path: request.path,
  };
}

function parseTerminalCreateRequest(
  value: unknown,
): DesktopTerminalCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal create request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    typeof request.cols !== "number" ||
    typeof request.rows !== "number"
  ) {
    throw new Error("Invalid terminal create request");
  }
  return {
    projectId: request.projectId,
    cols: request.cols,
    rows: request.rows,
  };
}

function parseTerminalWriteRequest(
  value: unknown,
): DesktopTerminalWriteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal input");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.sessionId !== "string" ||
    typeof request.data !== "string"
  ) {
    throw new Error("Invalid terminal input");
  }
  return { sessionId: request.sessionId, data: request.data };
}

function parseTerminalResizeRequest(
  value: unknown,
): DesktopTerminalResizeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal resize");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.sessionId !== "string" ||
    typeof request.cols !== "number" ||
    typeof request.rows !== "number"
  ) {
    throw new Error("Invalid terminal resize");
  }
  return {
    sessionId: request.sessionId,
    cols: request.cols,
    rows: request.rows,
  };
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

function requestKey(id: JsonRpcId): string {
  return `${id === null ? "null" : typeof id}:${String(id)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath);

  const threadlightHome =
    process.env.THREADLIGHT_HOME ?? join(app.getPath("home"), ".threadlight");
  conversationChangeTracker = new ConversationChangeTracker(
    join(threadlightHome, "review-snapshots"),
  );
  settingsStore = new SettingsStore(
    join(threadlightHome, "settings.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  projectStore = new ProjectStore(join(threadlightHome, "project-map.json"));
  computerService = new DesktopComputerService((snapshot) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL, snapshot);
  });
  terminalService = new TerminalSessionManager(
    (terminalEvent: TerminalSessionEvent) => {
      const window = mainWindow;
      if (!window || window.isDestroyed()) return;
      window.webContents.send(DESKTOP_TERMINAL_EVENT_CHANNEL, terminalEvent);
    },
  );
  protocol.handle("threadlight-computer", (request) => {
    if (request.url === COMPUTER_CAPTURE_URL) {
      return new Response(computerCaptureHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (request.url === COMPUTER_PREVIEW_URL) {
      return new Response(computerPreviewHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  });
  protocol.handle("threadlight-attachment", (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      const encodedPath = parts.length === 1 ? parts[0] : parts[1];
      if (url.hostname !== "local" || !encodedPath || parts.length > 2) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(
        pathToFileURL(resolveAttachmentUrlPath(encodedPath)).href,
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  const initialWorkspace = process.env.THREADLIGHT_WORKSPACE;
  if (initialWorkspace) projectStore.register(initialWorkspace);
  ipcMain.on(DESKTOP_REQUEST_CHANNEL, (event, value) => {
    void handleRequest(event, value);
  });
  ipcMain.handle(DESKTOP_SETTINGS_GET_CHANNEL, handleSettingsGet);
  ipcMain.handle(
    DESKTOP_CLIPBOARD_WRITE_CHANNEL,
    (_event, value: unknown) => {
      if (typeof value !== "string") {
        throw new TypeError("Clipboard text must be a string");
      }
      clipboard.writeText(value);
    },
  );
  ipcMain.handle(DESKTOP_SETTINGS_UPDATE_CHANNEL, handleSettingsUpdate);
  ipcMain.handle(DESKTOP_PROJECTS_GET_CHANNEL, handleProjectsGet);
  ipcMain.handle(DESKTOP_PROJECT_OPEN_CHANNEL, handleProjectOpen);
  ipcMain.handle(DESKTOP_PROJECT_ACTIVATE_CHANNEL, handleProjectActivate);
  ipcMain.handle(DESKTOP_PROJECT_OPENERS_GET_CHANNEL, handleProjectOpenersGet);
  ipcMain.handle(DESKTOP_PROJECT_OPEN_WITH_CHANNEL, handleProjectOpenWith);
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
  ipcMain.handle(DESKTOP_AUDIO_TRANSCRIBE_CHANNEL, handleAudioTranscription);
  ipcMain.handle(
    DESKTOP_ATTACHMENT_REFERENCE_CHANNEL,
    handleAttachmentReference,
  );
  ipcMain.handle(DESKTOP_COMPUTER_SHARE_GET_CHANNEL, handleComputerShareGet);
  ipcMain.handle(DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL, handleComputerShareShow);
  ipcMain.handle(DESKTOP_COMPUTER_SHARE_STOP_CHANNEL, handleComputerShareStop);
  ipcMain.handle(DESKTOP_TERMINAL_CREATE_CHANNEL, handleTerminalCreate);
  ipcMain.on(DESKTOP_TERMINAL_WRITE_CHANNEL, handleTerminalWrite);
  ipcMain.on(DESKTOP_TERMINAL_RESIZE_CHANNEL, handleTerminalResize);
  ipcMain.handle(DESKTOP_TERMINAL_CLOSE_CHANNEL, handleTerminalClose);
  ipcMain.handle(
    DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
    handleConversationChangesGet,
  );
  ipcMain.handle(DESKTOP_WORKSPACE_LIST_CHANNEL, handleWorkspaceList);
  ipcMain.handle(DESKTOP_WORKSPACE_FILE_GET_CHANNEL, handleWorkspaceFileGet);
  ipcMain.on(
    DESKTOP_COMPUTER_PREVIEW_CLOSE_CHANNEL,
    handleComputerPreviewClose,
  );
  ipcMain.on(
    DESKTOP_COMPUTER_PREVIEW_RESIZE_CHANNEL,
    handleComputerPreviewResize,
  );
  ipcMain.on(
    DESKTOP_COMPUTER_PREVIEW_DRAG_CHANNEL,
    handleComputerPreviewDrag,
  );
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopAppServers();
  computerService?.dispose();
  terminalService?.dispose();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
