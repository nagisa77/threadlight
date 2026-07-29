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
  Notification,
  protocol,
  systemPreferences,
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

import {
  AppServerProcess,
  resolveAppServerEntry,
} from "./app-server-process.js";
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
  ComputerPermissionService,
} from "./computer-permissions.js";
import { requestMacOSScreenCaptureAccess } from "./computer-input.js";
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
  TaskWorkspaceManager,
  type TaskWorkspace,
} from "./task-workspace.js";
import {
  ConnectionStore,
  DesktopConnectionService,
} from "./connection-store.js";
import {
  DEFAULT_CUSTOM_BASE_URL,
  DEFAULT_DOUBAO_BASE_URL,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GROK_BASE_URL,
  DEFAULT_KIMI_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_QWEN_BASE_URL,
  runtimeEnvironment,
  SettingsStore,
} from "./settings-store.js";
import { ProjectStore } from "./project-store.js";
import { projectDiagnostics } from "./diagnostics.js";
import { testProviderConnection } from "./provider-diagnostics.js";
import {
  openProjectWith,
  projectOpeners,
} from "./project-opener.js";
import {
  TerminalSessionManager,
  type TerminalSessionEvent,
} from "./terminal-session.js";
import {
  completedTaskTarget,
  handleTaskCompletion,
  type TaskCompletionNotification,
} from "./task-completion.js";
import {
  readSystemFile,
  resolveSystemFilePath,
} from "./system-files.js";
import {
  DESKTOP_AUDIO_TRANSCRIBE_CHANNEL,
  DESKTOP_ATTACHMENT_REFERENCE_CHANNEL,
  DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_SHARE_GET_CHANNEL,
  DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL,
  DESKTOP_COMPUTER_SHARE_STOP_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL,
  DESKTOP_CLIPBOARD_WRITE_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL,
  DESKTOP_CONVERSATION_DELETE_CHANNEL,
  DESKTOP_CONVERSATION_READ_CHANNEL,
  DESKTOP_CONVERSATION_UPDATE_CHANNEL,
  DESKTOP_CONVERSATION_UPSERT_CHANNEL,
  DESKTOP_DIAGNOSTICS_GET_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_PROJECT_ACTIVATE_CHANNEL,
  DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
  DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
  DESKTOP_PROJECT_OPEN_CHANNEL,
  DESKTOP_PROJECT_OPENERS_GET_CHANNEL,
  DESKTOP_PROJECT_OPEN_WITH_CHANNEL,
  DESKTOP_PROJECTS_GET_CHANNEL,
  DESKTOP_PROVIDER_TEST_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL,
  DESKTOP_SYSTEM_FILE_GET_CHANNEL,
  DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL,
  type DesktopProviderTestRequest,
  DESKTOP_TERMINAL_CLOSE_CHANNEL,
  DESKTOP_TERMINAL_CREATE_CHANNEL,
  DESKTOP_TERMINAL_EVENT_CHANNEL,
  DESKTOP_TERMINAL_RESIZE_CHANNEL,
  DESKTOP_TERMINAL_WRITE_CHANNEL,
  DESKTOP_WORKSPACE_FILE_GET_CHANNEL,
  DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL,
  DESKTOP_WORKSPACE_LIST_CHANNEL,
  type DesktopAttachmentReferenceRequest,
  type DesktopConversationTarget,
  type DesktopConversationMetadataUpdate,
  type DesktopConversationUpdate,
  type DesktopConversationChangesRequest,
  type DesktopConversationChangesRestoreRequest,
  type DesktopComputerPermissionCapability,
  type DesktopProjectOpenWithRequest,
  type DesktopProjectOpener,
  type DesktopSettingsUpdate,
  type DesktopSystemFileRequest,
  type DesktopTaskWorkspace,
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
interface AppServerRuntime {
  process: AppServerProcess;
  projectId: string;
  projectRoot: string;
  workspace: DesktopTaskWorkspace;
}
const appServers = new Map<string, AppServerRuntime>();
const threadProjects = new Map<string, string>();
const pendingThreadStarts = new Map<
  string | number | null,
  { projectId: string; workspace: DesktopTaskWorkspace }
>();
const processWorkspaces = new Map<string, string>();
let settingsStore: SettingsStore | null = null;
let projectStore: ProjectStore | null = null;
let computerService: DesktopComputerService | null = null;
let computerPermissionService: ComputerPermissionService | null = null;
let terminalService: TerminalSessionManager | null = null;
let conversationChangeTracker: ConversationChangeTracker | null = null;
let taskWorkspaceManager: TaskWorkspaceManager | null = null;
let connectionStore: ConnectionStore | null = null;
let connectionService: DesktopConnectionService | null = null;
const pendingOAuthCallbacks: string[] = [];
let rendererMessageQueue = Promise.resolve();
const appIconPath = resolve(
  import.meta.dirname,
  "../../resources/app-icon.png",
);

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient("threadlight", process.execPath, [
    resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient("threadlight");
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  acceptOAuthCallback(url);
});

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
  window.on("focus", () => {
    if (computerPermissionService?.snapshot().required) {
      computerPermissionService.refresh();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    stopAppServers();
    computerService?.dispose();
    terminalService?.dispose();
  });

  const activeProject = projectStore?.activeProject();
  if (activeProject) {
    ensureAppServer(
      window,
      activeProject.id,
      activeProject.basePath,
      folderWorkspace(activeProject.basePath),
    );
  }

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
  projectRoot: string,
  workspace: DesktopTaskWorkspace,
): AppServerProcess {
  const existing = appServers.get(workspace.path);
  if (existing) {
    existing.process.start();
    return existing.process;
  }
  const appServer = new AppServerProcess({
    entry: resolveAppServerEntry({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      override: process.env.THREADLIGHT_APP_SERVER_PATH,
    }),
    cwd: workspace.path,
    environment: appServerEnvironment(
      projectRoot,
      settingsStore?.runtimeSettings() ?? {
        provider: "openai",
        qwenBaseUrl: DEFAULT_QWEN_BASE_URL,
        kimiBaseUrl: DEFAULT_KIMI_BASE_URL,
        doubaoBaseUrl: DEFAULT_DOUBAO_BASE_URL,
        geminiBaseUrl: DEFAULT_GEMINI_BASE_URL,
        grokBaseUrl: DEFAULT_GROK_BASE_URL,
        customBaseUrl: DEFAULT_CUSTOM_BASE_URL,
        model: DEFAULT_MODEL,
      },
    ),
    send: (message) => {
      rendererMessageQueue = rendererMessageQueue
        .then(async () => {
          await recordProjectMessage(projectId, workspace, message);
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
    handleConnectionRequest: (request) => {
      if (!connectionService) {
        throw new Error("Desktop connection service is not available");
      }
      return connectionService.handle(request);
    },
  });
  appServers.set(workspace.path, {
    process: appServer,
    projectId,
    projectRoot,
    workspace,
  });
  appServer.start();
  return appServer;
}

function stopAppServers(): void {
  for (const runtime of appServers.values()) runtime.process.stop();
  appServers.clear();
  threadProjects.clear();
  pendingThreadStarts.clear();
  processWorkspaces.clear();
}

async function recordProjectMessage(
  projectId: string,
  workspace: DesktopTaskWorkspace,
  message: JsonRpcOutgoing,
): Promise<void> {
  if ("method" in message) {
    const threadId = (message.params as { threadId?: unknown } | undefined)
      ?.threadId;
    if (typeof threadId === "string") threadProjects.set(threadId, projectId);
    const processSessionId = processSessionIdFromMessage(message);
    if (processSessionId) {
      processWorkspaces.set(processSessionId, workspace.path);
    }
    if (message.method === "thread/title") {
      const params = message.params as {
        threadId?: unknown;
        title?: unknown;
      };
      if (
        projectStore &&
        typeof params.threadId === "string" &&
        typeof params.title === "string"
      ) {
        try {
          projectStore.setGeneratedConversationTitle(
            { projectId, id: params.threadId },
            params.title,
          );
        } catch {
          // A task can be removed while a late title notification is queued.
        }
      }
    }
    const completedTarget = completedTaskTarget(projectId, message);
    if (completedTarget) {
      try {
        projectStore?.markConversationCompleted(completedTarget);
      } catch {
        // A task can be removed while a late runtime notification is queued.
      }
    }
    if (projectStore && settingsStore) {
      handleTaskCompletion(projectId, message, {
        language: settingsStore.snapshot().language,
        markUnread: (target) => projectStore!.markConversationUnread(target),
        notify: showTaskCompletionNotification,
      });
    }
    return;
  }
  const pending = pendingThreadStarts.get(message.id);
  if (
    pending?.projectId !== projectId ||
    pending.workspace.path !== workspace.path
  ) {
    return;
  }
  pendingThreadStarts.delete(message.id);
  const threadId = (message.result as { threadId?: unknown } | undefined)
    ?.threadId;
  if (typeof threadId === "string") {
    threadProjects.set(threadId, projectId);
    projectStore?.setConversationWorkspace(
      { projectId, id: threadId },
      workspace,
    );
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
    await disposeTaskWorkspace(workspace);
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

function workspaceForRequest(
  request: JsonRpcRequest,
  project: NonNullable<ReturnType<ProjectStore["project"]>>,
): DesktopTaskWorkspace {
  const params =
    request.params && typeof request.params === "object"
      ? (request.params as Record<string, unknown>)
      : undefined;
  const threadId = params?.threadId;
  if (typeof threadId === "string") {
    return workspaceForThread(project, threadId);
  }
  const sessionId = params?.sessionId;
  if (typeof sessionId === "string") {
    const workspacePath = processWorkspaces.get(sessionId);
    const runtime = workspacePath ? appServers.get(workspacePath) : undefined;
    if (runtime) return runtime.workspace;
  }
  return folderWorkspace(project.basePath);
}

function workspaceForThread(
  project: NonNullable<ReturnType<ProjectStore["project"]>>,
  threadId: string,
): DesktopTaskWorkspace {
  return (
    project.conversations.find((conversation) => conversation.id === threadId)
      ?.workspace ?? folderWorkspace(project.basePath)
  );
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
    let workspace: TaskWorkspace | undefined;
    try {
      if (!taskWorkspaceManager) {
        throw new Error("Task workspace management is not available");
      }
      workspace = await taskWorkspaceManager.prepare(
        project.id,
        project.basePath,
      );
      await conversationChangeTracker?.beginPendingSnapshot(
        project.id,
        requestKey(value.id),
        workspace.path,
      );
    } catch (error) {
      if (workspace) await disposeTaskWorkspace(workspace);
      if (value.id !== undefined) {
        sendToRenderer(mainWindow, {
          jsonrpc: "2.0",
          id: value.id,
          error: {
            code: -32011,
            message: `Unable to prepare the task workspace: ${errorMessage(error)}`,
          },
        });
      }
      return;
    }
    if (!workspace) return;
    const runtime = ensureAppServer(
      mainWindow,
      project.id,
      project.basePath,
      workspace,
    );
    try {
      await runtime.initialize();
    } catch (error) {
      await conversationChangeTracker?.discardPendingSnapshot(
        project.id,
        requestKey(value.id),
      );
      await disposeTaskWorkspace(workspace);
      sendToRenderer(mainWindow, {
        jsonrpc: "2.0",
        id: value.id,
        error: {
          code: -32010,
          message: `Unable to initialize the task runtime: ${errorMessage(error)}`,
        },
      });
      return;
    }
    pendingThreadStarts.set(value.id, {
      projectId: project.id,
      workspace,
    });
    runtime.send(value);
    return;
  }
  const workspace = workspaceForRequest(value, project);
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
          workspace.path,
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
      if (value.method === "turn/start") {
        try {
          projectStore?.markConversationPending({
            projectId: project.id,
            id: threadId,
          });
        } catch {
          // The runtime will report an unknown thread if the task disappeared.
        }
      }
    }
  }
  const runtime = ensureAppServer(
    mainWindow,
    project.id,
    project.basePath,
    workspace,
  );
  if (value.method !== "initialize") {
    try {
      await runtime.initialize();
    } catch (error) {
      if (value.id !== undefined) {
        sendToRenderer(mainWindow, {
          jsonrpc: "2.0",
          id: value.id,
          error: {
            code: -32010,
            message: `Unable to initialize the task runtime: ${errorMessage(error)}`,
          },
        });
      }
      return;
    }
  }
  runtime.send(value);
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
    for (const runtime of appServers.values()) {
      runtime.process.restart({
        ...environment,
        THREADLIGHT_PROJECT_ROOT: runtime.projectRoot,
      });
    }
  }
  return snapshot;
}

function handleDiagnosticsGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  return projectDiagnostics(requireProject(value));
}

function handleProviderTest(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");
  return testProviderConnection(
    parseProviderTestRequest(value),
    settingsStore.runtimeSettings(),
  );
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
    ensureAppServer(
      mainWindow,
      activeProject.id,
      activeProject.basePath,
      folderWorkspace(activeProject.basePath),
    );
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
    ensureAppServer(
      mainWindow,
      activeProject.id,
      activeProject.basePath,
      folderWorkspace(activeProject.basePath),
    );
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
  const workspace = request.threadId
    ? workspaceForThread(project, request.threadId)
    : folderWorkspace(project.basePath);
  const availableOpeners = await projectOpeners(workspace.path);
  if (!availableOpeners.some((opener) => opener.id === request.opener)) {
    throw new Error("The selected project app is no longer available");
  }
  await openProjectWith(workspace.path, request.opener, {
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

function handleConversationRead(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  return projectStore.markConversationRead(parseConversationTarget(value));
}

function handleConversationUpdate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  return projectStore.updateConversation(
    parseConversationMetadataUpdate(value),
  );
}

async function handleConversationDelete(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const target = parseConversationTarget(value);
  const project = projectStore.project(target.projectId);
  const workspace = project
    ? workspaceForThread(project, target.id)
    : undefined;
  threadProjects.delete(target.id);
  await conversationChangeTracker
    ?.deleteSnapshot(target.projectId, target.id)
    .catch(() => undefined);
  const snapshot = projectStore.deleteConversation(target);
  if (workspace) {
    await disposeTaskWorkspace(workspace).catch(() => undefined);
  }
  return snapshot;
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
  const workspace = workspaceForThread(project, request.threadId);
  return conversationChangeTracker.changes(
    project.id,
    request.threadId,
    workspace.path,
  );
}

async function handleConversationChangesRestore(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!conversationChangeTracker) {
    throw new Error("Conversation change tracking is not available");
  }
  const request = parseConversationChangesRestoreRequest(value);
  const project = requireProject(request.projectId);
  const workspace = workspaceForThread(project, request.threadId);
  return conversationChangeTracker.restore(
    project.id,
    request.threadId,
    workspace.path,
    request.revision,
    request.paths,
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
  const workspace = request.threadId
    ? workspaceForThread(project, request.threadId)
    : folderWorkspace(project.basePath);
  return conversationChangeTracker.listWorkspace(
    workspace.path,
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
  const workspace = request.threadId
    ? workspaceForThread(project, request.threadId)
    : folderWorkspace(project.basePath);
  return conversationChangeTracker.readWorkspaceFile(
    workspace.path,
    request.path,
  );
}

async function handleWorkspaceFileReveal(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<void> {
  requireTrustedSender(event);
  if (!conversationChangeTracker) {
    throw new Error("Workspace browsing is not available");
  }
  const request = parseWorkspaceFileRequest(value);
  const project = requireProject(request.projectId);
  const workspace = request.threadId
    ? workspaceForThread(project, request.threadId)
    : folderWorkspace(project.basePath);
  const absolutePath = await conversationChangeTracker.workspaceFilePath(
    workspace.path,
    request.path,
  );
  shell.showItemInFolder(absolutePath);
}

async function handleSystemFileChoose(
  event: IpcMainInvokeEvent,
): Promise<string | undefined> {
  requireTrustedSender(event);
  if (!mainWindow) throw new Error("File browsing is not available");
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
  });
  const path = result.filePaths[0];
  if (result.canceled || !path) return undefined;
  return resolveSystemFilePath(path);
}

async function handleSystemFileGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  return readSystemFile(parseSystemFileRequest(value).path);
}

async function handleSystemFileReveal(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<void> {
  requireTrustedSender(event);
  const absolutePath = await resolveSystemFilePath(
    parseSystemFileRequest(value).path,
  );
  shell.showItemInFolder(absolutePath);
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

function handleComputerPermissionGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!computerPermissionService) {
    throw new Error("Computer permissions are not available");
  }
  return computerPermissionService.snapshot().required
    ? computerPermissionService.refresh()
    : computerPermissionService.snapshot();
}

function handleComputerPermissionRequest(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!computerPermissionService) {
    throw new Error("Computer permissions are not available");
  }
  return computerPermissionService.request(parseComputerPermission(value));
}

function handleComputerPermissionRelaunch(event: IpcMainInvokeEvent): void {
  requireTrustedSender(event);
  app.relaunch();
  setImmediate(() => app.exit(0));
}

function parseComputerPermission(
  value: unknown,
): DesktopComputerPermissionCapability {
  if (value !== "screen_recording" && value !== "accessibility") {
    throw new Error("Invalid computer permission");
  }
  return value;
}

function handleTerminalCreate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!terminalService) throw new Error("Terminal is not available");
  const request = parseTerminalCreateRequest(value);
  const project = requireProject(request.projectId);
  const workspace = request.threadId
    ? workspaceForThread(project, request.threadId)
    : folderWorkspace(project.basePath);
  return terminalService.create(workspace.path, request.cols, request.rows);
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
    throw new Error(
      "provider must be openai, deepseek, qwen, kimi, doubao, gemini, grok, or custom",
    );
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
  if (!isOptionalSecret(update.kimiApiKey)) {
    throw new Error("kimiApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.doubaoApiKey)) {
    throw new Error("doubaoApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.geminiApiKey)) {
    throw new Error("geminiApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.grokApiKey)) {
    throw new Error("grokApiKey must be a string or null");
  }
  if (!isOptionalSecret(update.customApiKey)) {
    throw new Error("customApiKey must be a string or null");
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
  if (typeof update.kimiBaseUrl !== "string" || !update.kimiBaseUrl.trim()) {
    throw new Error("kimiBaseUrl must be a non-empty string");
  }
  if (
    typeof update.doubaoBaseUrl !== "string" ||
    !update.doubaoBaseUrl.trim()
  ) {
    throw new Error("doubaoBaseUrl must be a non-empty string");
  }
  if (
    typeof update.geminiBaseUrl !== "string" ||
    !update.geminiBaseUrl.trim()
  ) {
    throw new Error("geminiBaseUrl must be a non-empty string");
  }
  if (typeof update.grokBaseUrl !== "string" || !update.grokBaseUrl.trim()) {
    throw new Error("grokBaseUrl must be a non-empty string");
  }
  if (
    typeof update.customBaseUrl !== "string" ||
    !update.customBaseUrl.trim()
  ) {
    throw new Error("customBaseUrl must be a non-empty string");
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
    kimiBaseUrl: update.kimiBaseUrl.trim(),
    doubaoBaseUrl: update.doubaoBaseUrl.trim(),
    geminiBaseUrl: update.geminiBaseUrl.trim(),
    grokBaseUrl: update.grokBaseUrl.trim(),
    customBaseUrl: update.customBaseUrl.trim(),
    ...(update.openAIApiKey !== undefined
      ? { openAIApiKey: update.openAIApiKey }
      : {}),
    ...(update.deepSeekApiKey !== undefined
      ? { deepSeekApiKey: update.deepSeekApiKey }
      : {}),
    ...(update.qwenApiKey !== undefined
      ? { qwenApiKey: update.qwenApiKey }
      : {}),
    ...(update.kimiApiKey !== undefined
      ? { kimiApiKey: update.kimiApiKey }
      : {}),
    ...(update.doubaoApiKey !== undefined
      ? { doubaoApiKey: update.doubaoApiKey }
      : {}),
    ...(update.geminiApiKey !== undefined
      ? { geminiApiKey: update.geminiApiKey }
      : {}),
    ...(update.grokApiKey !== undefined
      ? { grokApiKey: update.grokApiKey }
      : {}),
    ...(update.customApiKey !== undefined
      ? { customApiKey: update.customApiKey }
      : {}),
    ...(update.searchApiKey !== undefined
      ? { searchApiKey: update.searchApiKey }
      : {}),
  } as DesktopSettingsUpdate;
}

function parseProviderTestRequest(
  value: unknown,
): DesktopProviderTestRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid provider test request");
  }
  const request = value as Record<string, unknown>;
  if (!isModelProvider(request.provider)) {
    throw new Error("Invalid provider");
  }
  if (typeof request.model !== "string" || !request.model.trim()) {
    throw new Error("Model must be a non-empty string");
  }
  if (
    request.baseUrl !== undefined &&
    (typeof request.baseUrl !== "string" || !request.baseUrl.trim())
  ) {
    throw new Error("Base URL must be a non-empty string");
  }
  if (
    request.apiKey !== undefined &&
    request.apiKey !== null &&
    typeof request.apiKey !== "string"
  ) {
    throw new Error("API key must be a string or null");
  }
  return {
    provider: request.provider,
    model: request.model.trim(),
    ...(typeof request.baseUrl === "string"
      ? { baseUrl: request.baseUrl.trim() }
      : {}),
    ...(request.apiKey === undefined
      ? {}
      : { apiKey: request.apiKey as string | null }),
  };
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
  return (
    value === "openai" ||
    value === "deepseek" ||
    value === "qwen" ||
    value === "kimi" ||
    value === "doubao" ||
    value === "gemini" ||
    value === "grok" ||
    value === "custom"
  );
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

function parseConversationMetadataUpdate(
  value: unknown,
): DesktopConversationMetadataUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation metadata update");
  }
  const update = value as Record<string, unknown>;
  if (
    typeof update.projectId !== "string" ||
    !update.projectId ||
    typeof update.id !== "string" ||
    !update.id ||
    (update.title !== undefined && typeof update.title !== "string") ||
    (update.pinned !== undefined && typeof update.pinned !== "boolean") ||
    (update.archived !== undefined && typeof update.archived !== "boolean") ||
    (update.title === undefined &&
      update.pinned === undefined &&
      update.archived === undefined)
  ) {
    throw new Error("Invalid conversation metadata update");
  }
  return {
    projectId: update.projectId,
    id: update.id,
    ...(typeof update.title === "string" ? { title: update.title } : {}),
    ...(typeof update.pinned === "boolean"
      ? { pinned: update.pinned }
      : {}),
    ...(typeof update.archived === "boolean"
      ? { archived: update.archived }
      : {}),
  };
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
    (request.threadId !== undefined &&
      typeof request.threadId !== "string") ||
    !isProjectOpener(request.opener)
  ) {
    throw new Error("Invalid project opener request");
  }
  return {
    projectId: request.projectId,
    opener: request.opener,
    ...(typeof request.threadId === "string"
      ? { threadId: request.threadId }
      : {}),
  };
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

function parseConversationChangesRestoreRequest(
  value: unknown,
): DesktopConversationChangesRestoreRequest {
  const request = parseConversationChangesRequest(value);
  const restore = value as Record<string, unknown>;
  if (
    typeof restore.revision !== "string" ||
    !restore.revision ||
    (restore.paths !== undefined &&
      (!Array.isArray(restore.paths) ||
        restore.paths.some((path) => typeof path !== "string")))
  ) {
    throw new Error("Invalid conversation changes restore request");
  }
  return {
    ...request,
    revision: restore.revision,
    ...(Array.isArray(restore.paths)
      ? { paths: restore.paths as string[] }
      : {}),
  };
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
    (request.threadId !== undefined &&
      typeof request.threadId !== "string") ||
    (request.path !== undefined && typeof request.path !== "string")
  ) {
    throw new Error("Invalid workspace list request");
  }
  return {
    projectId: request.projectId,
    ...(typeof request.threadId === "string"
      ? { threadId: request.threadId }
      : {}),
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
    (request.threadId !== undefined &&
      typeof request.threadId !== "string") ||
    typeof request.path !== "string"
  ) {
    throw new Error("Invalid workspace file request");
  }
  return {
    projectId: request.projectId,
    ...(typeof request.threadId === "string"
      ? { threadId: request.threadId }
      : {}),
    path: request.path,
  };
}

function parseSystemFileRequest(
  value: unknown,
): DesktopSystemFileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid system file request");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.path !== "string" || !request.path) {
    throw new Error("Invalid system file request");
  }
  return { path: request.path };
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
    (request.threadId !== undefined &&
      typeof request.threadId !== "string") ||
    typeof request.cols !== "number" ||
    typeof request.rows !== "number"
  ) {
    throw new Error("Invalid terminal create request");
  }
  return {
    projectId: request.projectId,
    ...(typeof request.threadId === "string"
      ? { threadId: request.threadId }
      : {}),
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

function showTaskCompletionNotification(
  completion: TaskCompletionNotification,
): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: completion.title,
    body: completion.body,
    icon: appIconPath,
  });
  notification.on("click", () => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.show();
    window.focus();
  });
  notification.show();
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

function folderWorkspace(path: string): DesktopTaskWorkspace {
  return { mode: "folder", path };
}

function appServerEnvironment(
  projectRoot: string,
  settings: Parameters<typeof runtimeEnvironment>[0],
): NodeJS.ProcessEnv {
  return {
    ...runtimeEnvironment(settings),
    THREADLIGHT_PROJECT_ROOT: projectRoot,
  };
}

function processSessionIdFromMessage(
  message: JsonRpcOutgoing,
): string | undefined {
  if (!("method" in message) || message.method !== "agent/event") return;
  const event = (
    message.params as
      | {
          event?: {
            type?: unknown;
            result?: { output?: unknown };
          };
        }
      | undefined
  )?.event;
  if (
    event?.type !== "tool.completed" ||
    typeof event.result?.output !== "string"
  ) {
    return;
  }
  try {
    const output = JSON.parse(event.result.output) as {
      sessionId?: unknown;
    };
    return typeof output.sessionId === "string"
      ? output.sessionId
      : undefined;
  } catch {
    return;
  }
}

async function disposeTaskWorkspace(
  workspace: DesktopTaskWorkspace,
): Promise<void> {
  const runtime = appServers.get(workspace.path);
  runtime?.process.stop();
  appServers.delete(workspace.path);
  for (const [sessionId, workspacePath] of processWorkspaces) {
    if (workspacePath === workspace.path) processWorkspaces.delete(sessionId);
  }
  await taskWorkspaceManager?.remove(workspace);
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
  taskWorkspaceManager = new TaskWorkspaceManager(
    join(threadlightHome, "worktrees"),
  );
  settingsStore = new SettingsStore(
    join(threadlightHome, "settings.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  connectionStore = new ConnectionStore(
    join(threadlightHome, "connection-store.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  connectionService = new DesktopConnectionService(
    connectionStore,
    (url) => shell.openExternal(url),
    () => {
      const window = mainWindow;
      if (!window || window.isDestroyed()) return;
      window.show();
      window.focus();
    },
  );
  for (const callback of pendingOAuthCallbacks.splice(0)) {
    acceptOAuthCallback(callback);
  }
  projectStore = new ProjectStore(join(threadlightHome, "project-map.json"));
  computerPermissionService = new ComputerPermissionService(
    {
      screenRecordingStatus: () =>
        systemPreferences.getMediaAccessStatus("screen"),
      accessibilityTrusted: (prompt) =>
        systemPreferences.isTrustedAccessibilityClient(prompt),
      requestScreenRecording: () => requestMacOSScreenCaptureAccess(),
      openSettings: async (capability) => {
        const pane =
          capability === "screen_recording"
            ? "Privacy_ScreenCapture"
            : "Privacy_Accessibility";
        await shell.openExternal(
          `x-apple.systempreferences:com.apple.preference.security?${pane}`,
        );
      },
    },
    (snapshot) => {
      const window = mainWindow;
      if (!window || window.isDestroyed()) return;
      window.webContents.send(
        DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL,
        snapshot,
      );
    },
  );
  computerService = new DesktopComputerService((snapshot) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL, snapshot);
  }, computerPermissionService);
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
  ipcMain.handle(DESKTOP_DIAGNOSTICS_GET_CHANNEL, handleDiagnosticsGet);
  ipcMain.handle(DESKTOP_PROVIDER_TEST_CHANNEL, handleProviderTest);
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
    DESKTOP_CONVERSATION_UPDATE_CHANNEL,
    handleConversationUpdate,
  );
  ipcMain.handle(DESKTOP_CONVERSATION_READ_CHANNEL, handleConversationRead);
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
  ipcMain.handle(
    DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL,
    handleComputerPermissionGet,
  );
  ipcMain.handle(
    DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL,
    handleComputerPermissionRequest,
  );
  ipcMain.handle(
    DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL,
    handleComputerPermissionRelaunch,
  );
  ipcMain.handle(DESKTOP_TERMINAL_CREATE_CHANNEL, handleTerminalCreate);
  ipcMain.on(DESKTOP_TERMINAL_WRITE_CHANNEL, handleTerminalWrite);
  ipcMain.on(DESKTOP_TERMINAL_RESIZE_CHANNEL, handleTerminalResize);
  ipcMain.handle(DESKTOP_TERMINAL_CLOSE_CHANNEL, handleTerminalClose);
  ipcMain.handle(
    DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
    handleConversationChangesGet,
  );
  ipcMain.handle(
    DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL,
    handleConversationChangesRestore,
  );
  ipcMain.handle(DESKTOP_WORKSPACE_LIST_CHANNEL, handleWorkspaceList);
  ipcMain.handle(DESKTOP_WORKSPACE_FILE_GET_CHANNEL, handleWorkspaceFileGet);
  ipcMain.handle(
    DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL,
    handleWorkspaceFileReveal,
  );
  ipcMain.handle(DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL, handleSystemFileChoose);
  ipcMain.handle(DESKTOP_SYSTEM_FILE_GET_CHANNEL, handleSystemFileGet);
  ipcMain.handle(DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL, handleSystemFileReveal);
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

  for (const argument of process.argv) {
    if (argument.startsWith("threadlight://")) {
      acceptOAuthCallback(argument);
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function acceptOAuthCallback(value: string): void {
  if (!connectionStore) {
    pendingOAuthCallbacks.push(value);
    return;
  }
  try {
    if (!connectionStore.acceptAuthorizationCallback(new URL(value))) return;
    const window = mainWindow;
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
  } catch {
    // Invalid callbacks are ignored and never logged because they may contain codes.
  }
}

app.on("before-quit", () => {
  stopAppServers();
  void connectionService?.dispose();
  computerService?.dispose();
  terminalService?.dispose();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
