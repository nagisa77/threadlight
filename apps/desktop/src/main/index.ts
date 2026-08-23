import { join, resolve } from "node:path";

import {
  app,
  BrowserWindow,
  protocol,
  systemPreferences,
  safeStorage,
  shell,
} from "electron";
import type {
  HostProjectsSnapshot,
  JsonRpcOutgoing,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import {
  ProductTelemetry,
  RunningThreadRegistry,
  productTelemetryEnabled,
} from "@threadlight/host-core";
import { TerminalSessionManager } from "@threadlight/terminal-core";

import {
  AppServerProcess,
  resolveAppServerEntry,
} from "./app-server-process.js";
import { RemoteRuntimeConnection } from "./remote-runtime-connection.js";
import { DesktopWorkspaceController } from "./workspace-controller.js";
import { DesktopProjectController } from "./project-controller.js";
import { DesktopNotificationController } from "./notification-controller.js";
import { DesktopIpcController } from "./ipc-controller.js";
import { DesktopRuntimeController } from "./runtime-controller.js";
import { DesktopSecurity } from "./desktop-security.js";
import { jsonRpcRequestKey } from "./json-rpc-model.js";
import { registerDesktopIpc } from "./desktop-ipc-registration.js";
import { registerDesktopProtocols } from "./desktop-protocols.js";
import {
  appServerEnvironment,
  defaultAppServerSettings,
  processSessionIdFromMessage,
  reconcileLegacyNoChangesAttention,
} from "./desktop-runtime-model.js";
import { runtimeConnectionKey } from "./runtime-connection-key.js";
import { RemoteHostConnection } from "./remote-host-connection.js";
import { RemoteTerminalClient } from "./remote-terminal-client.js";
import { HostCredentialStore } from "./host-credential-store.js";
import { HostStore, LOCAL_HOST_ID } from "./host-store.js";
import { DesktopComputerService } from "./computer-service.js";
import { ComputerPermissionService } from "./computer-permissions.js";
import { requestMacOSScreenCaptureAccess } from "./computer-input.js";
import { createExternalWindowHandler } from "./external-links.js";
import { ConversationChangeTracker } from "./conversation-changes.js";
import { TaskWorkspaceManager } from "./task-workspace.js";
import { WorktreeDeliveryManager } from "./worktree-delivery.js";
import { CodeHostDeliveryManager } from "./code-host-delivery.js";
import { GitHubCliProvider } from "./github-cli-provider.js";
import {
  ConnectionStore,
  DesktopConnectionService,
} from "./connection-store.js";
import { SettingsStore } from "./settings-store.js";
import { ProjectStore } from "./project-store.js";
import { ProjectSearchService } from "./project-search.js";
import { AutomationStore } from "./automation-store.js";
import { ExecutionPolicyStore } from "./execution-policy-store.js";
import {
  AutomationScheduler,
  type AutomationExecutionResult,
} from "./automation-scheduler.js";
import {
  completedTaskTarget,
  handleTaskCompletion,
} from "./task-completion.js";
import {
  DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_TERMINAL_EVENT_CHANNEL,
  type DesktopExecutionApprovalRequest,
  type DesktopProjectsSnapshot,
  type DesktopTaskWorkspace,
} from "../shared/desktop-api.js";

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
type RuntimeProcess = AppServerProcess | RemoteRuntimeConnection;
interface AppServerRuntime {
  process: RuntimeProcess;
  projectId: string;
  projectRoot: string;
  workspace: DesktopTaskWorkspace;
}
const appServers = new Map<string, AppServerRuntime>();
const runningThreads = new RunningThreadRegistry();
const threadProjects = new Map<string, string>();
const deliveryAttentionCompletions = new Set<string>();
const pendingThreadStarts = new Map<
  string | number | null,
  { projectId: string; workspace: DesktopTaskWorkspace }
>();
const processWorkspaces = new Map<string, string>();
let settingsStore: SettingsStore | null = null;
let projectStore: ProjectStore | null = null;
let localProjectStore: ProjectStore | null = null;
let remoteProjectStore: ProjectStore | null = null;
let hostStore: HostStore | null = null;
let remoteHost: RemoteHostConnection | null = null;
let computerService: DesktopComputerService | null = null;
let computerPermissionService: ComputerPermissionService | null = null;
let terminalService: TerminalSessionManager | null = null;
let remoteTerminalClient: RemoteTerminalClient | null = null;
let conversationChangeTracker: ConversationChangeTracker | null = null;
let taskWorkspaceManager: TaskWorkspaceManager | null = null;
let worktreeDeliveryManager: WorktreeDeliveryManager | null = null;
let codeHostDeliveryManager: CodeHostDeliveryManager | null = null;
let projectSearchService: ProjectSearchService | null = null;
let automationStore: AutomationStore | null = null;
let automationScheduler: AutomationScheduler | null = null;
let connectionStore: ConnectionStore | null = null;
let connectionService: DesktopConnectionService | null = null;
let hostCredentials: HostCredentialStore | null = null;
let executionPolicyStore: ExecutionPolicyStore | null = null;
const taskExecutionGrants = new Set<string>();
const pendingExecutionApprovals = new Map<
  string,
  {
    request: DesktopExecutionApprovalRequest;
    runtimeKey: string;
  }
>();
const pendingOAuthCallbacks: string[] = [];
let rendererMessageQueue = Promise.resolve();
let automationRequestId = 0;
const automationRpcWaiters = new Map<
  string,
  {
    resolve(result: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const automationTurnWaiters = new Map<
  string,
  {
    resolve(result: AutomationExecutionResult): void;
  }
>();
const automationThreads = new Map<string, string>();
const appIconPath = resolve(
  import.meta.dirname,
  "../../resources/app-icon.png",
);

function activeHostId(): string {
  return hostStore?.snapshot().activeHostId ?? LOCAL_HOST_ID;
}

function isRemoteHost(): boolean {
  return activeHostId() !== LOCAL_HOST_ID;
}

function currentProjectsSnapshot(): DesktopProjectsSnapshot {
  if (!projectStore) throw new Error("Projects are not available");
  return withRunningThreads(projectStore.snapshotForHost(activeHostId()));
}

function withRunningThreads(
  snapshot: DesktopProjectsSnapshot,
): DesktopProjectsSnapshot {
  return {
    ...snapshot,
    runningThreadIds: runningThreads.threadIds(
      snapshot.projects.map(({ id }) => id),
    ),
  };
}

function currentProject(projectId: string) {
  return currentProjectsSnapshot().projects.find(
    (project) => project.id === projectId,
  );
}

function currentActiveProject() {
  const snapshot = currentProjectsSnapshot();
  return snapshot.projects.find(
    (project) => project.id === snapshot.activeProjectId,
  );
}

function syncRemoteProjects(
  snapshot: HostProjectsSnapshot,
  preferredProjectId?: string,
): DesktopProjectsSnapshot {
  if (!projectStore || !remoteHost) {
    throw new Error("Remote Host is not connected.");
  }
  const next = projectStore.replaceRemoteHostProjects(
    {
      hostId: activeHostId(),
      endpoint: remoteHost.endpoint,
      activeProjectId:
        preferredProjectId ?? currentProjectsSnapshot().activeProjectId,
    },
    snapshot,
  ) as DesktopProjectsSnapshot;
  runningThreads.replaceProjects(
    snapshot.projects,
    snapshot.runningThreadIds ?? [],
    `remote-host:${activeHostId()}`,
  );
  return withRunningThreads(next);
}

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
    backgroundColor: "#f7f7f8",
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
    stopTerminalSessions();
  });

  const activeProject = projectStore ? currentActiveProject() : undefined;
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
    void window.loadFile(
      resolve(import.meta.dirname, "../renderer/index.html"),
    );
  }
}

function ensureAppServer(
  window: BrowserWindow | null,
  projectId: string,
  projectRoot: string,
  workspace: DesktopTaskWorkspace,
): RuntimeProcess {
  const project = projectStore ? currentProject(projectId) : undefined;
  const key = runtimeKeyForProject(projectId, workspace.path);
  const existing = appServers.get(key);
  if (existing) {
    existing.process.start();
    return existing.process;
  }
  const send = (message: JsonRpcOutgoing) => {
    const messageWorkspace = workspaceForRuntimeMessage(
      projectId,
      workspace,
      message,
    );
    rendererMessageQueue = rendererMessageQueue
      .then(async () => {
        if (
          ipcController.handleExecutionApprovalNotification.bind(ipcController)(
            projectId,
            messageWorkspace,
            message,
          )
        ) {
          return;
        }
        const rendererWindow = mainWindow ?? window;
        await recordProjectMessage(projectId, messageWorkspace, message);
        if (rendererWindow && !rendererWindow.isDestroyed()) {
          sendToRenderer(rendererWindow, message);
        }
      })
      .catch(() => {
        const rendererWindow = mainWindow ?? window;
        if (rendererWindow && !rendererWindow.isDestroyed()) {
          sendToRenderer(rendererWindow, message);
        }
      });
  };
  const appServer: RuntimeProcess =
    project?.runtime?.kind === "remote"
      ? new RemoteRuntimeConnection({
          endpoint: project.runtime.endpoint,
          projectId: project.id,
          token:
            hostCredentials?.get(project.runtime.hostId) ??
            missingRemoteRuntimeToken(project.runtime.hostId),
          send,
        })
      : new AppServerProcess({
          entry: resolveAppServerEntry({
            appPath: app.getAppPath(),
            isPackaged: app.isPackaged,
            override: process.env.THREADLIGHT_APP_SERVER_PATH,
          }),
          cwd: workspace.path,
          environment: {
            ...appServerEnvironment(
              projectRoot,
              settingsStore?.runtimeSettings() ?? defaultAppServerSettings(),
              project?.scope,
            ),
            THREADLIGHT_APP_VERSION: app.getVersion(),
            THREADLIGHT_TELEMETRY_SOURCE: "desktop",
          },
          send,
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
  appServers.set(key, {
    process: appServer,
    projectId,
    projectRoot,
    workspace,
  });
  appServer.start();
  return appServer;
}

function missingRemoteRuntimeToken(hostId: string): never {
  throw new Error(`Threadlight Host credentials are missing for ${hostId}.`);
}

function stopAppServers(): void {
  for (const pending of pendingExecutionApprovals.values()) {
    appServers.get(pending.runtimeKey)?.process.send({
      jsonrpc: "2.0",
      method: "execution/approval/respond",
      params: {
        requestId: pending.request.requestId,
        decision: "deny",
      },
    });
  }
  pendingExecutionApprovals.clear();
  taskExecutionGrants.clear();
  for (const runtime of appServers.values()) runtime.process.stop();
  appServers.clear();
  runningThreads.clear();
  for (const [threadId, waiter] of automationTurnWaiters) {
    waiter.resolve({
      threadId,
      error: "The automation runtime stopped before the task finished.",
    });
  }
  automationTurnWaiters.clear();
  automationThreads.clear();
  for (const [id, waiter] of automationRpcWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("The automation runtime stopped"));
    automationRpcWaiters.delete(id);
  }
  threadProjects.clear();
  pendingThreadStarts.clear();
  processWorkspaces.clear();
}

function stopProjectRuntimes(projectId: string): void {
  const runtimes = [...appServers.entries()].filter(
    ([, runtime]) => runtime.projectId === projectId,
  );
  const workspacePaths = new Set(
    runtimes.map(([, runtime]) => runtime.workspace.path),
  );
  for (const [key, runtime] of runtimes) {
    runtime.process.stop();
    appServers.delete(key);
    runningThreads.clearRuntime(key);
  }
  runningThreads.clearProject(projectId);
  for (const [threadId, ownerProjectId] of threadProjects) {
    if (ownerProjectId === projectId) threadProjects.delete(threadId);
  }
  for (const [sessionId, workspacePath] of processWorkspaces) {
    if (workspacePaths.has(workspacePath)) processWorkspaces.delete(sessionId);
  }
}

function sendTerminalEvent(terminalEvent: TerminalSessionEvent): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  window.webContents.send(DESKTOP_TERMINAL_EVENT_CHANNEL, terminalEvent);
}

function requireRemoteTerminalClient(): RemoteTerminalClient {
  if (remoteTerminalClient) return remoteTerminalClient;
  if (!remoteHost) throw new Error("Remote Host is not connected.");
  remoteTerminalClient = new RemoteTerminalClient({
    endpoint: remoteHost.endpoint,
    token: remoteHost.token,
    send: sendTerminalEvent,
  });
  return remoteTerminalClient;
}

function stopTerminalSessions(): void {
  terminalService?.dispose();
  remoteTerminalClient?.dispose();
  remoteTerminalClient = null;
}

function workspaceForRuntimeMessage(
  projectId: string,
  fallback: DesktopTaskWorkspace,
  message: JsonRpcOutgoing,
): DesktopTaskWorkspace {
  if ("id" in message) {
    const pending = pendingThreadStarts.get(message.id);
    if (pending?.projectId === projectId) return pending.workspace;
  }
  if ("method" in message) {
    const threadId = (message.params as { threadId?: unknown } | undefined)
      ?.threadId;
    if (typeof threadId === "string") {
      const workspace = currentProject(projectId)?.conversations.find(
        (conversation) => conversation.id === threadId,
      )?.workspace;
      if (workspace) return workspace;
    }
  }
  return fallback;
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
    runningThreads.record(
      projectId,
      runtimeKeyForProject(projectId, workspace.path),
      message,
    );
    const incomingDelivery =
      notificationController.deliveryStateFromNotification.bind(
        notificationController,
      )(message);
    if (typeof threadId === "string" && incomingDelivery) {
      notificationController.recordDeliveryConversationState.bind(
        notificationController,
      )(
        projectId,
        threadId,
        incomingDelivery.status,
        incomingDelivery.source,
        incomingDelivery.error,
      );
    }
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
    if (
      completedTarget &&
      !deliveryAttentionCompletions.has(
        notificationController.deliveryConversationKey.bind(
          notificationController,
        )(completedTarget.projectId, completedTarget.id),
      )
    ) {
      try {
        projectStore?.markConversationCompleted(completedTarget);
      } catch {
        // A task can be removed while a late runtime notification is queued.
      }
    }
    const suppressCompletionNotification = Boolean(
      message.method === "turn/completed" &&
      typeof threadId === "string" &&
      deliveryAttentionCompletions.delete(
        notificationController.deliveryConversationKey.bind(
          notificationController,
        )(projectId, threadId),
      ),
    );
    const automationId =
      typeof threadId === "string"
        ? automationThreads.get(threadId)
        : undefined;
    if (
      automationId &&
      typeof threadId === "string" &&
      (message.method === "turn/completed" || message.method === "turn/failed")
    ) {
      try {
        projectStore?.markConversationUnread({ projectId, id: threadId });
      } catch {
        // A task can be removed while a late automation result is queued.
      }
      const params = message.params as Record<string, unknown>;
      const diagnostics = params.diagnostics as
        { toolCalls?: readonly { isError?: boolean }[] } | undefined;
      automationTurnWaiters.get(threadId)?.resolve(
        message.method === "turn/failed"
          ? {
              threadId,
              error:
                typeof params.error === "string"
                  ? params.error
                  : "Automation failed",
            }
          : {
              threadId,
              output: typeof params.output === "string" ? params.output : "",
              toolError: diagnostics?.toolCalls?.some((tool) => tool.isError),
            },
      );
      automationTurnWaiters.delete(threadId);
      automationThreads.delete(threadId);
    } else if (
      projectStore &&
      settingsStore &&
      !suppressCompletionNotification
    ) {
      handleTaskCompletion(projectId, message, {
        language: settingsStore.snapshot().language,
        markUnread: (target) => projectStore!.markConversationUnread(target),
        notify: notificationController.showTaskCompletionNotification.bind(
          notificationController,
        ),
      });
    }
    return;
  }
  const pending = pendingThreadStarts.get(message.id);
  if (
    pending?.projectId !== projectId ||
    pending.workspace.path !== workspace.path
  ) {
    notificationController.settleAutomationRpc.bind(notificationController)(
      message,
    );
    return;
  }
  pendingThreadStarts.delete(message.id);
  const threadId = (message.result as { threadId?: unknown } | undefined)
    ?.threadId;
  if (typeof threadId === "string") {
    threadProjects.set(threadId, projectId);
    if (currentProject(projectId)?.runtime?.kind === "remote") {
      if (remoteHost) {
        syncRemoteProjects(await remoteHost.client.projects());
      }
    } else {
      projectStore?.setConversationWorkspace(
        { projectId, id: threadId },
        workspace,
      );
      await conversationChangeTracker?.commitPendingSnapshot(
        projectId,
        jsonRpcRequestKey(message.id),
        threadId,
      );
    }
  } else {
    if (currentProject(projectId)?.runtime?.kind !== "remote") {
      await conversationChangeTracker?.discardPendingSnapshot(
        projectId,
        jsonRpcRequestKey(message.id),
      );
    }
    await disposeTaskWorkspace(workspace);
  }
  notificationController.settleAutomationRpc.bind(notificationController)(
    message,
  );
}

const desktopSecurity = new DesktopSecurity({
  get mainWindow() {
    return mainWindow;
  },
  get projectStore() {
    return projectStore;
  },
  currentProject,
});

const ipcController = new DesktopIpcController({
  get mainWindow() {
    return mainWindow;
  },
  get threadProjects() {
    return threadProjects;
  },
  get pendingThreadStarts() {
    return pendingThreadStarts;
  },
  get processWorkspaces() {
    return processWorkspaces;
  },
  get projectStore() {
    return projectStore;
  },
  get conversationChangeTracker() {
    return conversationChangeTracker;
  },
  get taskWorkspaceManager() {
    return taskWorkspaceManager;
  },
  get executionPolicyStore() {
    return executionPolicyStore;
  },
  get taskExecutionGrants() {
    return taskExecutionGrants;
  },
  get pendingExecutionApprovals() {
    return pendingExecutionApprovals;
  },
  requireProject: desktopSecurity.requireProject.bind(desktopSecurity),
  requireTrustedSender:
    desktopSecurity.requireTrustedSender.bind(desktopSecurity),
  currentProject,
  currentProjectsSnapshot,
  disposeTaskWorkspace,
  ensureAppServer,
  folderWorkspace,
  runtimeKeyForProject,
  sendRuntime: (runtimeKey, message) => {
    appServers.get(runtimeKey)?.process.send(message);
  },
  sendToRenderer,
});

const projectController = new DesktopProjectController({
  get mainWindow() {
    return mainWindow;
  },
  get threadProjects() {
    return threadProjects;
  },
  get settingsStore() {
    return settingsStore;
  },
  get projectStore() {
    return projectStore;
  },
  get localProjectStore() {
    return localProjectStore;
  },
  get remoteProjectStore() {
    return remoteProjectStore;
  },
  get hostStore() {
    return hostStore;
  },
  get remoteHost() {
    return remoteHost;
  },
  get conversationChangeTracker() {
    return conversationChangeTracker;
  },
  get worktreeDeliveryManager() {
    return worktreeDeliveryManager;
  },
  get automationStore() {
    return automationStore;
  },
  get automationScheduler() {
    return automationScheduler;
  },
  get hostCredentials() {
    return hostCredentials;
  },
  requireProject: desktopSecurity.requireProject.bind(desktopSecurity),
  requireTrustedSender:
    desktopSecurity.requireTrustedSender.bind(desktopSecurity),
  setRemoteHost: (value) => {
    remoteHost = value;
  },
  setProjectStore: (value) => {
    projectStore = value;
  },
  activeHostId,
  currentActiveProject,
  currentProject,
  currentProjectsSnapshot,
  ensureAppServer,
  folderWorkspace,
  isRemoteHost,
  restartLocalRuntimes: (environment) => {
    for (const [runtimeId, runtime] of appServers) {
      if (runtime.process instanceof AppServerProcess) {
        runningThreads.clearRuntime(runtimeId);
        runtime.process.restart({
          ...environment,
          THREADLIGHT_PROJECT_ROOT: runtime.projectRoot,
          ...(currentProject(runtime.projectId)?.scope === "standalone"
            ? { THREADLIGHT_TASK_SCOPE: "standalone" }
            : {}),
        });
      }
    }
  },
  withRunningThreads,
  sendAutomationSnapshot: (projectId) => {
    notificationController.sendAutomationSnapshot(projectId);
  },
  stopTerminalSessions,
  disposeTaskWorkspace,
  stopAppServers,
  stopProjectRuntimes,
  syncRemoteProjects,
  workspaceForThread: ipcController.workspaceForThread.bind(ipcController),
});

const workspaceController = new DesktopWorkspaceController({
  get mainWindow() {
    return mainWindow;
  },
  get settingsStore() {
    return settingsStore;
  },
  get projectStore() {
    return projectStore;
  },
  get remoteHost() {
    return remoteHost;
  },
  get computerService() {
    return computerService;
  },
  get computerPermissionService() {
    return computerPermissionService;
  },
  get conversationChangeTracker() {
    return conversationChangeTracker;
  },
  get worktreeDeliveryManager() {
    return worktreeDeliveryManager;
  },
  get codeHostDeliveryManager() {
    return codeHostDeliveryManager;
  },
  get projectSearchService() {
    return projectSearchService;
  },
  currentActiveProject,
  isRemoteHost,
  requireRemoteRuntime,
  workspaceForThread: ipcController.workspaceForThread.bind(ipcController),
  folderWorkspace,
  requireProject: desktopSecurity.requireProject.bind(desktopSecurity),
  requireTrustedSender:
    desktopSecurity.requireTrustedSender.bind(desktopSecurity),
  recordDeliveryConversationState: (...args) => {
    notificationController.recordDeliveryConversationState(...args);
  },
  automaticDeliveryNotification: (...args) =>
    notificationController.automaticDeliveryNotification(...args),
});

const notificationController = new DesktopNotificationController({
  get mainWindow() {
    return mainWindow;
  },
  get threadProjects() {
    return threadProjects;
  },
  get deliveryAttentionCompletions() {
    return deliveryAttentionCompletions;
  },
  get settingsStore() {
    return settingsStore;
  },
  get projectStore() {
    return projectStore;
  },
  get conversationChangeTracker() {
    return conversationChangeTracker;
  },
  get automationStore() {
    return automationStore;
  },
  get automationRpcWaiters() {
    return automationRpcWaiters;
  },
  get automationTurnWaiters() {
    return automationTurnWaiters;
  },
  get automationThreads() {
    return automationThreads;
  },
  get appIconPath() {
    return appIconPath;
  },
  nextAutomationRequestId: () => ++automationRequestId,
  createWindow,
  requireProject: desktopSecurity.requireProject.bind(desktopSecurity),
  currentProject,
  ensureAppServer,
  folderWorkspace,
  sendToRenderer,
});

const runtimeController = new DesktopRuntimeController({
  get terminalService() {
    return terminalService;
  },
  get remoteTerminalClient() {
    return remoteTerminalClient;
  },
  get computerService() {
    return computerService;
  },
  get mainWindow() {
    return mainWindow;
  },
  requireProject: desktopSecurity.requireProject.bind(desktopSecurity),
  requireRemoteTerminalClient,
  requireTrustedSender:
    desktopSecurity.requireTrustedSender.bind(desktopSecurity),
  isTrustedSender: desktopSecurity.isTrustedSender.bind(desktopSecurity),
});

function sendToRenderer(window: BrowserWindow, message: JsonRpcOutgoing): void {
  if (!window.isDestroyed()) {
    window.webContents.send(DESKTOP_MESSAGE_CHANNEL, message);
  }
}

function folderWorkspace(path: string): DesktopTaskWorkspace {
  return { mode: "folder", path };
}

function runtimeKeyForProject(
  projectId: string,
  workspacePath: string,
): string {
  return runtimeConnectionKey(
    projectId,
    workspacePath,
    currentProject(projectId)?.runtime?.kind === "remote",
  );
}

function requireRemoteRuntime(projectId: string): RemoteRuntimeConnection {
  const project = desktopSecurity.requireProject(projectId);
  if (project.runtime?.kind !== "remote") {
    throw new Error("Project is not connected to a Remote Runtime.");
  }
  const runtime = ensureAppServer(
    mainWindow,
    project.id,
    project.basePath,
    folderWorkspace(project.runtime.workspacePath),
  );
  if (!(runtime instanceof RemoteRuntimeConnection)) {
    throw new Error("Remote Runtime connection is not available.");
  }
  return runtime;
}

async function disposeTaskWorkspace(
  workspace: DesktopTaskWorkspace,
): Promise<void> {
  for (const [key, runtime] of appServers) {
    if (runtime.workspace.path !== workspace.path) continue;
    runtime.process.stop();
    appServers.delete(key);
  }
  for (const [sessionId, workspacePath] of processWorkspaces) {
    if (workspacePath === workspace.path) processWorkspaces.delete(sessionId);
  }
  await taskWorkspaceManager?.remove(workspace);
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath);

  const threadlightHome =
    process.env.THREADLIGHT_HOME ?? join(app.getPath("home"), ".threadlight");
  conversationChangeTracker = new ConversationChangeTracker(
    join(threadlightHome, "review-snapshots"),
  );
  worktreeDeliveryManager = new WorktreeDeliveryManager(
    conversationChangeTracker,
  );
  codeHostDeliveryManager = new CodeHostDeliveryManager(
    conversationChangeTracker,
    new GitHubCliProvider(),
  );
  projectSearchService = new ProjectSearchService();
  taskWorkspaceManager = new TaskWorkspaceManager(
    join(threadlightHome, "worktrees"),
    { standaloneRoot: join(threadlightHome, "standalone", "workspaces") },
  );
  settingsStore = new SettingsStore(join(threadlightHome, "settings.json"), {
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
  });
  connectionStore = new ConnectionStore(
    join(threadlightHome, "connection-store.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  hostCredentials = new HostCredentialStore(
    join(threadlightHome, "host-credentials.json"),
    {
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  );
  hostStore = new HostStore(join(threadlightHome, "hosts.json"));
  executionPolicyStore = new ExecutionPolicyStore(
    join(threadlightHome, "execution-policies.json"),
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
  localProjectStore = new ProjectStore(
    join(threadlightHome, "project-map.json"),
    { standaloneRoot: join(threadlightHome, "standalone") },
  );
  remoteProjectStore = new ProjectStore(
    join(threadlightHome, "remote-host-cache.json"),
  );
  projectStore = localProjectStore;
  await reconcileLegacyNoChangesAttention(
    localProjectStore,
    worktreeDeliveryManager,
  );
  const savedHostId = hostStore.snapshot().activeHostId;
  if (savedHostId !== LOCAL_HOST_ID) {
    const savedHost = hostStore.remote(savedHostId);
    const savedToken = hostCredentials.get(savedHostId);
    if (savedHost && savedToken) {
      remoteHost = new RemoteHostConnection(savedHost.endpoint, savedToken);
      projectStore = remoteProjectStore;
    } else {
      hostStore.activate(LOCAL_HOST_ID);
    }
  }
  automationStore = new AutomationStore(
    join(threadlightHome, "automations.json"),
  );
  automationScheduler = new AutomationScheduler(automationStore, {
    execute: notificationController.executeAutomation.bind(
      notificationController,
    ),
    notify: notificationController.showAutomationAlert.bind(
      notificationController,
    ),
    onChange: notificationController.sendAutomationSnapshot.bind(
      notificationController,
    ),
  });
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
  terminalService = new TerminalSessionManager(sendTerminalEvent);
  registerDesktopProtocols({
    isRemoteHost,
    currentActiveProject,
    remoteHost: () => remoteHost,
    language: () => settingsStore?.snapshot().language ?? "zh-CN",
  });
  const initialWorkspace = process.env.THREADLIGHT_WORKSPACE;
  if (initialWorkspace) localProjectStore.register(initialWorkspace);
  registerDesktopIpc({
    ipc: ipcController,
    project: projectController,
    workspace: workspaceController,
    runtime: runtimeController,
    security: desktopSecurity,
  });
  createWindow();
  const productTelemetry = new ProductTelemetry({
    homePath: threadlightHome,
    source: "desktop",
    appVersion: app.getVersion(),
    enabled: productTelemetryEnabled(),
    endpoint: process.env.THREADLIGHT_TELEMETRY_ENDPOINT,
  });
  void productTelemetry.reportOnce("install_succeeded");
  automationScheduler.start();

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
  automationScheduler?.stop();
  stopAppServers();
  void connectionService?.dispose();
  computerService?.dispose();
  stopTerminalSessions();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
