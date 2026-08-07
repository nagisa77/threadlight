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
  type HostProjectsSnapshot,
  type HostDeliverySource,
  type AttachmentData,
  type JsonRpcId,
  type JsonRpcOutgoing,
  type JsonRpcRequest,
  type TaskDevelopmentMode,
  type TerminalSessionEvent,
  type ThreadlightMethod,
} from "@threadlight/protocol";
import { ProjectMemoryStore } from "@threadlight/project-memory";
import { TerminalSessionManager } from "@threadlight/terminal-core";

import {
  AppServerProcess,
  resolveAppServerEntry,
} from "./app-server-process.js";
import { RemoteRuntimeConnection } from "./remote-runtime-connection.js";
import { runtimeConnectionKey } from "./runtime-connection-key.js";
import { RemoteHostConnection } from "./remote-host-connection.js";
import { RemoteTerminalClient } from "./remote-terminal-client.js";
import { HostCredentialStore } from "./host-credential-store.js";
import { HostStore, LOCAL_HOST_ID } from "./host-store.js";
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
  uploadAttachmentReference,
} from "./attachment-upload.js";
import {
  parseAudioTranscriptionRequest,
  transcribeAudio,
} from "./audio-transcription.js";
import { createExternalWindowHandler } from "./external-links.js";
import { ConversationChangeTracker } from "./conversation-changes.js";
import {
  resolveTerminalWorkspace,
  TaskWorkspaceManager,
  type TaskWorkspace,
} from "./task-workspace.js";
import {
  applyAutomaticWorktreeDelivery,
  WorktreeDeliveryManager,
  type AutomaticWorktreeDeliveryState,
} from "./worktree-delivery.js";
import { CodeHostDeliveryManager } from "./code-host-delivery.js";
import { GitHubCliProvider } from "./github-cli-provider.js";
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
import { ProjectSearchService } from "./project-search.js";
import { AutomationStore } from "./automation-store.js";
import { ExecutionPolicyStore } from "./execution-policy-store.js";
import {
  AutomationScheduler,
  type AutomationAlert,
  type AutomationExecutionResult,
} from "./automation-scheduler.js";
import {
  projectDiagnosticBundle,
  projectDiagnostics,
} from "./diagnostics.js";
import { testProviderConnection } from "./provider-diagnostics.js";
import {
  openProjectWith,
  projectOpeners,
} from "./project-opener.js";
import {
  completedTaskTarget,
  deliveryAttentionBody,
  deliveryAttentionTitle,
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
  DESKTOP_AUTOMATIONS_CHANGED_CHANNEL,
  DESKTOP_AUTOMATIONS_CREATE_CHANNEL,
  DESKTOP_AUTOMATIONS_DELETE_CHANNEL,
  DESKTOP_AUTOMATIONS_GET_CHANNEL,
  DESKTOP_AUTOMATIONS_RUN_CHANNEL,
  DESKTOP_AUTOMATIONS_UPDATE_CHANNEL,
  DESKTOP_AUTOMATION_OPEN_CHANNEL,
  DESKTOP_COMPUTER_SHARE_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_SHARE_GET_CHANNEL,
  DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL,
  DESKTOP_COMPUTER_SHARE_STOP_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_CHANGED_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL,
  DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL,
  DESKTOP_CLIPBOARD_WRITE_CHANNEL,
  DESKTOP_EXTERNAL_OPEN_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
  DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_APPLY_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_COMMIT_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_PREFLIGHT_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_HISTORY_CHANNEL,
  DESKTOP_CODE_HOST_DELIVERY_STATUS_CHANNEL,
  DESKTOP_CODE_HOST_DELIVERY_COMMIT_PUSH_CHANNEL,
  DESKTOP_CODE_HOST_DELIVERY_CREATE_PR_CHANNEL,
  DESKTOP_CONVERSATION_DELETE_CHANNEL,
  DESKTOP_CONVERSATION_RECOVER_CHANNEL,
  DESKTOP_CONVERSATION_READ_CHANNEL,
  DESKTOP_CONVERSATION_UPDATE_CHANNEL,
  DESKTOP_CONVERSATION_UPSERT_CHANNEL,
  DESKTOP_DIAGNOSTICS_GET_CHANNEL,
  DESKTOP_DIAGNOSTICS_EXPORT_CHANNEL,
  DESKTOP_HOST_ACTIVATE_CHANNEL,
  DESKTOP_HOST_DELETE_CHANNEL,
  DESKTOP_HOST_DIRECTORIES_CHANNEL,
  DESKTOP_HOST_UPDATE_CHANNEL,
  DESKTOP_HOSTS_GET_CHANNEL,
  DESKTOP_MESSAGE_CHANNEL,
  DESKTOP_PROJECT_ACTIVATE_CHANNEL,
  DESKTOP_PROJECT_UPDATE_CHANNEL,
  DESKTOP_PROJECT_DELETE_CHANNEL,
  DESKTOP_REMOTE_RUNTIME_CONNECT_CHANNEL,
  DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
  DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
  DESKTOP_SEARCH_CHANNEL,
  DESKTOP_PROJECT_OPEN_CHANNEL,
  DESKTOP_STANDALONE_CREATE_CHANNEL,
  DESKTOP_PROJECT_OPENERS_GET_CHANNEL,
  DESKTOP_PROJECT_OPEN_WITH_CHANNEL,
  DESKTOP_PROJECTS_GET_CHANNEL,
  DESKTOP_PROVIDER_TEST_CHANNEL,
  DESKTOP_REQUEST_CHANNEL,
  DESKTOP_SETTINGS_GET_CHANNEL,
  DESKTOP_SETTINGS_UPDATE_CHANNEL,
  DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL,
  DESKTOP_SYSTEM_FILE_LIST_CHANNEL,
  DESKTOP_SYSTEM_FILE_GET_CHANNEL,
  DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL,
  DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL,
  DESKTOP_EXECUTION_APPROVAL_RESOLVED_CHANNEL,
  DESKTOP_EXECUTION_APPROVAL_RESPOND_CHANNEL,
  DESKTOP_EXECUTION_POLICY_GET_CHANNEL,
  DESKTOP_EXECUTION_POLICY_REVOKE_CHANNEL,
  type DesktopProviderTestRequest,
  DESKTOP_TERMINAL_CLOSE_CHANNEL,
  DESKTOP_TERMINAL_CREATE_CHANNEL,
  DESKTOP_TERMINAL_EVENT_CHANNEL,
  DESKTOP_TERMINAL_RESIZE_CHANNEL,
  DESKTOP_TERMINAL_WRITE_CHANNEL,
  DESKTOP_WORKSPACE_FILE_GET_CHANNEL,
  DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL,
  DESKTOP_WORKSPACE_LIST_CHANNEL,
  DESKTOP_WORKTREE_DELIVERY_UNDO_CHANNEL,
  type DesktopAttachmentReferenceRequest,
  type DesktopAutomation,
  type DesktopAutomationCreateRequest,
  type DesktopAutomationTarget,
  type DesktopAutomationUpdateRequest,
  type DesktopConversationTarget,
  type DesktopConversationRecoveryRequest,
  type DesktopConversationMetadataUpdate,
  type DesktopConversationUpdate,
  type DesktopConversationChangesRequest,
  type DesktopConversationChangesRestoreRequest,
  type DesktopWorktreeDeliveryCommitRequest,
  type DesktopWorktreeDeliveryRequest,
  type DesktopCodeHostCommitPushRequest,
  type DesktopCodeHostCreatePullRequest,
  type DesktopComputerPermissionCapability,
  type DesktopProjectOpenWithRequest,
  type DesktopHostUpdateRequest,
  type DesktopProjectMetadataUpdate,
  type DesktopProjectsSnapshot,
  type DesktopRemoteRuntimeConnectRequest,
  type DesktopProjectOpener,
  type DesktopSettingsUpdate,
  type DesktopSearchRequest,
  type DesktopSystemFileRequest,
  type DesktopTaskWorkspace,
  type DesktopTerminalCreateRequest,
  type DesktopTerminalResizeRequest,
  type DesktopTerminalWriteRequest,
  type DesktopWorkspaceFileRequest,
  type DesktopWorkspaceListRequest,
  type DesktopExecutionApprovalRequest,
  type DesktopExecutionApprovalResponse,
  type DesktopExecutionPolicyRevokeRequest,
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
type RuntimeProcess = AppServerProcess | RemoteRuntimeConnection;
interface AppServerRuntime {
  process: RuntimeProcess;
  projectId: string;
  projectRoot: string;
  workspace: DesktopTaskWorkspace;
}
const appServers = new Map<string, AppServerRuntime>();
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
  return projectStore.snapshotForHost(activeHostId());
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
  return projectStore.replaceRemoteHostProjects(
    {
      hostId: activeHostId(),
      endpoint: remoteHost.endpoint,
      activeProjectId:
        preferredProjectId ?? currentProjectsSnapshot().activeProjectId,
    },
    snapshot,
  ) as DesktopProjectsSnapshot;
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
    void window.loadFile(resolve(import.meta.dirname, "../renderer/index.html"));
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
          handleExecutionApprovalNotification(
            projectId,
            messageWorkspace,
            message,
          )
        ) {
          return;
        }
        const rendererWindow = mainWindow ?? window;
        await recordProjectMessage(
          projectId,
          messageWorkspace,
          message,
        );
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
      project?.scope,
    ),
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
  }
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
    const threadId = (
      message.params as { threadId?: unknown } | undefined
    )?.threadId;
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
    const incomingDelivery = deliveryStateFromNotification(message);
    if (typeof threadId === "string" && incomingDelivery) {
      recordDeliveryConversationState(
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
        deliveryConversationKey(completedTarget.projectId, completedTarget.id),
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
          deliveryConversationKey(projectId, threadId),
        ),
    );
    const automationId =
      typeof threadId === "string"
        ? automationThreads.get(threadId)
        : undefined;
    if (
      automationId &&
      typeof threadId === "string" &&
      (message.method === "turn/completed" ||
        message.method === "turn/failed")
    ) {
      try {
        projectStore?.markConversationUnread({ projectId, id: threadId });
      } catch {
        // A task can be removed while a late automation result is queued.
      }
      const params = message.params as Record<string, unknown>;
      const diagnostics = params.diagnostics as
        | { toolCalls?: readonly { isError?: boolean }[] }
        | undefined;
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
              output:
                typeof params.output === "string" ? params.output : "",
              toolError: diagnostics?.toolCalls?.some(
                (tool) => tool.isError,
              ),
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
    settleAutomationRpc(message);
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
        requestKey(message.id),
        threadId,
      );
    }
  } else {
    if (currentProject(projectId)?.runtime?.kind !== "remote") {
      await conversationChangeTracker?.discardPendingSnapshot(
        projectId,
        requestKey(message.id),
      );
    }
    await disposeTaskWorkspace(workspace);
  }
  settleAutomationRpc(message);
}

function projectIdForThread(threadId: string): string | undefined {
  const known = threadProjects.get(threadId);
  if (known) return known;
  const project = projectStore
    ? currentProjectsSnapshot().projects.find((candidate) =>
        candidate.conversations.some(
          (conversation) => conversation.id === threadId,
        ),
      )
    : undefined;
  if (project) threadProjects.set(threadId, project.id);
  return project?.id;
}

function handleExecutionApprovalNotification(
  projectId: string,
  workspace: DesktopTaskWorkspace,
  message: JsonRpcOutgoing,
): boolean {
  if (
    "method" in message &&
    message.method === "execution/approval-resolved"
  ) {
    const requestId = (message.params as { requestId?: unknown } | undefined)
      ?.requestId;
    if (typeof requestId === "string") {
      pendingExecutionApprovals.delete(requestId);
      const window = mainWindow;
      if (window && !window.isDestroyed()) {
        window.webContents.send(
          DESKTOP_EXECUTION_APPROVAL_RESOLVED_CHANNEL,
          requestId,
        );
      }
    }
    return true;
  }
  if (
    !("method" in message) ||
    message.method !== "execution/approval-required"
  ) {
    return false;
  }
  const request = parseExecutionApprovalRequest(
    projectId,
    message.params,
  );
  if (!request) return true;
  const key = taskExecutionGrantKey(request);
  const granted =
    taskExecutionGrants.has(key) ||
    executionPolicyStore?.allows(projectId, request.permissionKey) === true;
  const runtimeId = runtimeKeyForProject(projectId, workspace.path);
  if (granted) {
    appServers.get(runtimeId)?.process.send({
      jsonrpc: "2.0",
      method: "execution/approval/respond",
      params: { requestId: request.requestId, decision: "allow" },
    });
    return true;
  }
  pendingExecutionApprovals.set(request.requestId, {
    request,
    runtimeKey: runtimeId,
  });
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    window.webContents.send(
      DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL,
      request,
    );
    window.show();
  }
  return true;
}

function parseExecutionApprovalRequest(
  projectId: string,
  value: unknown,
): DesktopExecutionApprovalRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  const required = [
    "requestId",
    "threadId",
    "runId",
    "toolName",
    "permissionKey",
    "summary",
  ] as const;
  if (required.some((key) => typeof input[key] !== "string")) return;
  const project = projectStore ? currentProject(projectId) : undefined;
  return {
    requestId: input.requestId as string,
    projectId,
    projectName: project?.name ?? "Project",
    threadId: input.threadId as string,
    runId: input.runId as string,
    toolName: input.toolName as string,
    permissionKey: input.permissionKey as string,
    risk: "write",
    summary: input.summary as string,
    ...(typeof input.detail === "string" ? { detail: input.detail } : {}),
    external: input.external === true,
    projectScopeAvailable: project?.scope !== "standalone",
  };
}

function taskExecutionGrantKey(
  request: Pick<
    DesktopExecutionApprovalRequest,
    "projectId" | "threadId" | "permissionKey"
  >,
): string {
  return `${request.projectId}\0${request.threadId}\0${request.permissionKey}`;
}

function handleExecutionApprovalRespond(
  event: IpcMainInvokeEvent,
  value: unknown,
): void {
  requireTrustedSender(event);
  const response = parseExecutionApprovalResponse(value);
  const pending = pendingExecutionApprovals.get(response.requestId);
  if (!pending) throw new Error("This approval request is no longer pending.");
  if (
    response.scope === "project" &&
    !pending.request.projectScopeAvailable
  ) {
    throw new Error(
      "Permanent project approval is unavailable outside a project.",
    );
  }
  pendingExecutionApprovals.delete(response.requestId);
  if (response.decision === "allow") {
    if (response.scope === "task") {
      taskExecutionGrants.add(taskExecutionGrantKey(pending.request));
    } else if (response.scope === "project") {
      executionPolicyStore?.grant(pending.request.projectId, {
        permissionKey: pending.request.permissionKey,
        label: pending.request.summary,
        external: pending.request.external,
      });
    }
  }
  appServers.get(pending.runtimeKey)?.process.send({
    jsonrpc: "2.0",
    method: "execution/approval/respond",
    params: {
      requestId: response.requestId,
      decision: response.decision,
    },
  });
}

function parseExecutionApprovalResponse(
  value: unknown,
): DesktopExecutionApprovalResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid execution approval response");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.requestId !== "string" ||
    (input.decision !== "allow" && input.decision !== "deny") ||
    !["once", "task", "project"].includes(String(input.scope))
  ) {
    throw new TypeError("Invalid execution approval response");
  }
  return {
    requestId: input.requestId,
    decision: input.decision,
    scope: input.scope as DesktopExecutionApprovalResponse["scope"],
  };
}

function handleExecutionPolicyGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (typeof value !== "string") throw new TypeError("projectId is required");
  requireProject(value);
  if (!executionPolicyStore) throw new Error("Execution policy is unavailable");
  return executionPolicyStore.snapshot(value);
}

function handleExecutionPolicyRevoke(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid execution policy revoke request");
  }
  const request = value as Partial<DesktopExecutionPolicyRevokeRequest>;
  if (
    typeof request.projectId !== "string" ||
    typeof request.permissionKey !== "string"
  ) {
    throw new TypeError("Invalid execution policy revoke request");
  }
  requireProject(request.projectId);
  if (!executionPolicyStore) throw new Error("Execution policy is unavailable");
  return executionPolicyStore.revoke(
    request.projectId,
    request.permissionKey,
  );
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
      : currentProjectsSnapshot().activeProjectId;
  return projectId ? currentProject(projectId) : undefined;
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
    if (workspacePath) {
      return (
        project.conversations.find(
          (conversation) =>
            conversation.workspace?.path === workspacePath,
        )?.workspace ?? folderWorkspace(workspacePath)
      );
    }
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

function developmentModeForThreadStart(
  request: JsonRpcRequest,
): TaskDevelopmentMode {
  const params =
    request.params && typeof request.params === "object"
      ? (request.params as Record<string, unknown>)
      : undefined;
  const mode = params?.developmentMode;
  if (mode === undefined) return "local";
  if (mode === "local" || mode === "worktree") return mode;
  throw new Error("Invalid task development mode");
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
      if (project.runtime?.kind === "remote") {
        workspace = folderWorkspace(project.runtime.workspacePath);
      } else if (!taskWorkspaceManager) {
        throw new Error("Task workspace management is not available");
      } else {
        workspace =
          project.scope === "standalone"
            ? await taskWorkspaceManager.prepareStandalone()
            : await taskWorkspaceManager.prepare(
                project.id,
                project.basePath,
                developmentModeForThreadStart(value),
              );
        await conversationChangeTracker?.beginPendingSnapshot(
          project.id,
          requestKey(value.id),
          workspace.path,
        );
      }
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
      if (project.runtime?.kind !== "remote") {
        await conversationChangeTracker?.discardPendingSnapshot(
          project.id,
          requestKey(value.id),
        );
      }
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
        if (project.runtime?.kind !== "remote") {
          await conversationChangeTracker?.ensureSnapshot(
            project.id,
            threadId,
            workspace.path,
          );
        }
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

async function handleSettingsGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.settings();
  }
  return settingsStore.snapshot();
}

async function handleSettingsUpdate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");

  const update = parseSettingsUpdate(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    stopAppServers();
    return remoteHost.updateSettings(update);
  }
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
      if (runtime.process instanceof AppServerProcess) {
        runtime.process.restart({
          ...environment,
          THREADLIGHT_PROJECT_ROOT: runtime.projectRoot,
          ...(currentProject(runtime.projectId)?.scope === "standalone"
            ? { THREADLIGHT_TASK_SCOPE: "standalone" }
            : {}),
        });
      }
    }
  }
  return snapshot;
}

function handleDiagnosticsGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const project = requireProject(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.diagnostics(project.id);
  }
  return projectDiagnostics(project);
}

async function handleDiagnosticsExport(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseDiagnosticExportRequest(value);
  const project = requireProject(request.projectId);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.diagnosticBundle(project.id, request.conversationIds);
  }
  if (!conversationChangeTracker) {
    throw new Error("Conversation changes are not available.");
  }
  return projectDiagnosticBundle(project, {
    changes: conversationChangeTracker,
    ...(request.conversationIds
      ? { conversationIds: request.conversationIds }
      : {}),
    environment: {
      runtime: "desktop",
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
    },
  });
}

function handleProviderTest(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");
  const request = parseProviderTestRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.testProvider(request);
  }
  return testProviderConnection(
    request,
    settingsStore.runtimeSettings(),
  );
}

async function handleProjectsGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return syncRemoteProjects(await remoteHost.projects());
  }
  return currentProjectsSnapshot();
}

function handleAutomationsGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const project = requireProject(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.automations(project.id);
  }
  if (!automationStore) throw new Error("Automations are not available");
  return automationStore.snapshot(project.id);
}

function handleAutomationCreate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseAutomationRequest(value);
  requireProject(request.projectId);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.createAutomation(request);
  }
  if (!automationStore) throw new Error("Automations are not available");
  const snapshot = automationStore.create(request);
  sendAutomationSnapshot(request.projectId);
  return snapshot;
}

function handleAutomationUpdate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseAutomationRequest(value, true);
  requireProject(request.projectId);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.updateAutomation(request);
  }
  if (!automationStore) throw new Error("Automations are not available");
  const snapshot = automationStore.update(request);
  sendAutomationSnapshot(request.projectId);
  return snapshot;
}

function handleAutomationDelete(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const target = parseAutomationTarget(value);
  requireProject(target.projectId);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.deleteAutomation(target.projectId, target.id);
  }
  if (!automationStore) throw new Error("Automations are not available");
  const snapshot = automationStore.delete(target.projectId, target.id);
  sendAutomationSnapshot(target.projectId);
  return snapshot;
}

function handleAutomationRun(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const target = parseAutomationTarget(value);
  requireProject(target.projectId);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.runAutomation(target.projectId, target.id);
  }
  if (!automationStore || !automationScheduler) {
    throw new Error("Automations are not available");
  }
  const automation = automationStore.get(target.id);
  if (!automation || automation.projectId !== target.projectId) {
    throw new Error("Unknown automation");
  }
  automationScheduler.runNow(target.id);
  return automationStore.snapshot(target.projectId);
}

async function handleProjectOpen(
  event: IpcMainInvokeEvent,
  value?: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore || !mainWindow) {
    throw new Error("Projects are not available");
  }
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("Enter an absolute project path on the remote host.");
    }
    const remoteSnapshot = await remoteHost.client.registerProject(
      value.trim(),
    );
    const snapshot = syncRemoteProjects(
      remoteSnapshot,
      remoteSnapshot.activeProjectId,
    );
    const activeProject = currentActiveProject();
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
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开项目文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return currentProjectsSnapshot();
  }

  const snapshot = projectStore.register(result.filePaths[0]);
  const activeProject = currentActiveProject();
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

async function handleStandaloneCreate(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!projectStore || !mainWindow) {
    throw new Error("Projects are not available");
  }
  let snapshot: DesktopProjectsSnapshot;
  if (isRemoteHost()) {
    const remoteSnapshot = await remoteHost!.client.createStandaloneTask();
    snapshot = syncRemoteProjects(
      remoteSnapshot,
      remoteSnapshot.activeProjectId,
    );
  } else {
    snapshot = projectStore.activateStandalone();
  }
  const activeProject = currentActiveProject();
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

async function handleRemoteRuntimeConnect(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (
    !projectStore ||
    !hostStore ||
    !hostCredentials ||
    !mainWindow
  ) {
    throw new Error("Threadlight Host is not available.");
  }
  const request = parseRemoteRuntimeConnectRequest(value);
  const endpoint = normalizeRemoteRuntimeEndpoint(request.endpoint);
  const connection = new RemoteHostConnection(endpoint, request.token);
  const health = await connection.health();
  if (health.protocolVersion !== 2) {
    throw new Error(
      `Unsupported Threadlight Host protocol: ${health.protocolVersion}`,
    );
  }
  stopAppServers();
  stopTerminalSessions();
  hostStore.upsert({
    id: health.hostId,
    name: request.name?.trim() || health.name,
    endpoint,
  });
  hostCredentials.set(health.hostId, request.token);
  remoteHost = connection;
  projectStore = remoteProjectStore;
  syncRemoteProjects(await connection.projects());
  return hostStore.snapshot();
}

function handleHostsGet(event: IpcMainInvokeEvent) {
  requireTrustedSender(event);
  if (!hostStore) throw new Error("Hosts are not available.");
  return hostStore.snapshot();
}

async function handleHostActivate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!hostStore || !projectStore || !hostCredentials) {
    throw new Error("Hosts are not available.");
  }
  if (typeof value !== "string" || !value) throw new Error("Invalid host id.");
  stopAppServers();
  stopTerminalSessions();
  if (value === LOCAL_HOST_ID) {
    hostStore.activate(value);
    remoteHost = null;
    projectStore = localProjectStore;
    return hostStore.snapshot();
  }
  const profile = hostStore.remote(value);
  const token = hostCredentials.get(value);
  if (!profile || !token) {
    throw new Error("Saved Host credentials are unavailable. Connect again.");
  }
  const connection = new RemoteHostConnection(profile.endpoint, token);
  const health = await connection.health();
  if (health.hostId !== value) {
    throw new Error("The endpoint now identifies a different Host.");
  }
  hostStore.activate(value);
  remoteHost = connection;
  projectStore = remoteProjectStore;
  syncRemoteProjects(await connection.projects());
  return hostStore.snapshot();
}

async function handleHostUpdate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (
    !hostStore ||
    !hostCredentials ||
    !remoteProjectStore
  ) {
    throw new Error("Hosts are not available.");
  }
  const request = parseHostUpdateRequest(value);
  const profile = hostStore.remote(request.hostId);
  if (!profile) {
    throw new Error("Only a saved remote Host can be updated.");
  }
  const endpoint = normalizeRemoteRuntimeEndpoint(request.endpoint);
  const replacementToken = request.token?.trim();
  const token = replacementToken || hostCredentials.get(request.hostId);
  if (!token) {
    throw new Error("Saved Host credentials are unavailable. Enter a token.");
  }
  const connection = new RemoteHostConnection(endpoint, token);
  const health = await connection.health();
  if (health.protocolVersion !== 2) {
    throw new Error(
      `Unsupported Threadlight Host protocol: ${health.protocolVersion}`,
    );
  }
  if (health.hostId !== request.hostId) {
    throw new Error("The endpoint identifies a different Threadlight Host.");
  }

  const updatingActiveHost = activeHostId() === request.hostId;
  const reconnectActiveHost =
    updatingActiveHost &&
    (endpoint !== profile.endpoint || Boolean(replacementToken));
  const remoteProjects = reconnectActiveHost
    ? await connection.projects()
    : undefined;

  if (reconnectActiveHost) {
    stopAppServers();
    stopTerminalSessions();
  }
  const snapshot = hostStore.update({
    id: request.hostId,
    name: request.name?.trim() || health.name,
    endpoint,
  });
  if (replacementToken) {
    hostCredentials.set(request.hostId, replacementToken);
  }
  if (remoteProjects) {
    remoteHost = connection;
    projectStore = remoteProjectStore;
    syncRemoteProjects(remoteProjects);
  }
  return snapshot;
}

function handleHostDelete(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!hostStore || !hostCredentials || !remoteProjectStore) {
    throw new Error("Hosts are not available.");
  }
  if (typeof value !== "string" || !value) throw new Error("Invalid host id.");
  if (value === LOCAL_HOST_ID || !hostStore.remote(value)) {
    throw new Error("Only a saved remote Host can be removed.");
  }
  const deletingActiveHost = activeHostId() === value;
  if (deletingActiveHost) {
    stopAppServers();
    stopTerminalSessions();
  }
  remoteProjectStore.removeRemoteHost(value);
  hostCredentials.delete(value);
  const snapshot = hostStore.delete(value);
  if (deletingActiveHost) {
    remoteHost = null;
    projectStore = localProjectStore;
  }
  return snapshot;
}

async function handleHostDirectories(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!isRemoteHost() || !remoteHost) {
    throw new Error("Remote Host is not connected.");
  }
  if (typeof value !== "string") {
    throw new Error("A remote directory path is required.");
  }
  return remoteHost.client.directories(value);
}

async function handleProjectActivate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore || !mainWindow) {
    throw new Error("Projects are not available");
  }
  if (typeof value !== "string" || !value) throw new Error("Invalid project id");

  const snapshot = isRemoteHost()
    ? syncRemoteProjects(await remoteHost!.client.projects(), value)
    : (projectStore.activate(value) as DesktopProjectsSnapshot);
  const activeProject = currentActiveProject();
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

async function handleProjectUpdate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const update = parseProjectMetadataUpdate(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return syncRemoteProjects(
      await remoteHost.client.updateProject(update),
    );
  }
  return projectStore.updateProject(update);
}

async function handleProjectDelete(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  if (typeof value !== "string" || !value) throw new Error("Invalid project id");
  const deletingActive = currentActiveProject()?.id === value;
  const project = currentProject(value);
  const deletedThreadIds = new Set(
    project?.conversations.map((conversation) => conversation.id) ?? [],
  );
  if (project?.runtime?.kind !== "remote" && project) {
    for (const threadId of deletedThreadIds) {
      await conversationChangeTracker
        ?.deleteSnapshot(value, threadId)
        .catch(() => undefined);
      await worktreeDeliveryManager
        ?.deleteJournal({
          projectId: value,
          threadId,
          projectPath: project.basePath,
        })
        .catch(() => undefined);
    }
  }
  const snapshot = isRemoteHost()
    ? syncRemoteProjects(await remoteHost!.client.deleteProject(value))
    : projectStore.deleteProject(value);
  stopProjectRuntimes(value);
  if (deletingActive && mainWindow) {
    const nextProject = currentActiveProject();
    if (nextProject) {
      ensureAppServer(
        mainWindow,
        nextProject.id,
        nextProject.basePath,
        folderWorkspace(nextProject.basePath),
      );
    }
  }
  return snapshot;
}

async function handleProjectOpenersGet(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const selectedProject =
    typeof value === "string" && value
      ? requireProject(value)
      : projectStore
        ? currentActiveProject()
        : undefined;
  if (selectedProject?.runtime?.kind === "remote") return [];
  const basePath =
    typeof value === "string" && value
      ? requireProject(value).basePath
      : (currentActiveProject()?.basePath ?? app.getPath("home"));
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
  if (project.runtime?.kind === "remote") {
    throw new Error("Remote workspaces cannot be opened by a local app.");
  }
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

async function handleConversationUpsert(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const update = parseConversationUpdate(value);
  threadProjects.set(update.id, update.projectId);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return syncRemoteProjects(
      await remoteHost.client.upsertConversation(update),
    );
  }
  return projectStore.upsertConversation(update);
}

async function handleConversationRead(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const target = parseConversationTarget(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return syncRemoteProjects(
      await remoteHost.client.markConversationRead(target),
    );
  }
  return projectStore.markConversationRead(target);
}

async function handleConversationUpdate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const update = parseConversationMetadataUpdate(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return syncRemoteProjects(
      await remoteHost.client.updateConversation(update),
    );
  }
  return projectStore.updateConversation(update);
}

async function handleConversationRecover(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const request = parseConversationRecoveryRequest(value);
  let snapshot;
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    snapshot = syncRemoteProjects(
      await remoteHost.client.recoverConversation(request),
    );
  } else {
    snapshot = projectStore.recoverConversation(request);
  }
  threadProjects.delete(request.id);
  if (request.replacementId) {
    threadProjects.set(request.replacementId, request.projectId);
  }
  return snapshot;
}

async function handleConversationDelete(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!projectStore) throw new Error("Projects are not available");
  const target = parseConversationTarget(value);
  const project = currentProject(target.projectId);
  const workspace = project
    ? workspaceForThread(project, target.id)
    : undefined;
  threadProjects.delete(target.id);
  await conversationChangeTracker
    ?.deleteSnapshot(target.projectId, target.id)
    .catch(() => undefined);
  if (!isRemoteHost() && project && worktreeDeliveryManager) {
    await worktreeDeliveryManager
      .deleteJournal({
        projectId: target.projectId,
        threadId: target.id,
        projectPath: project.basePath,
      })
      .catch(() => undefined);
  }
  const snapshot = isRemoteHost()
    ? syncRemoteProjects(
        await remoteHost!.client.deleteConversation(target),
      )
    : projectStore.deleteConversation(target);
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
  if (project.runtime?.kind === "remote") {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.conversationChanges(
      project.id,
      request.threadId,
    );
  }
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
  if (project.runtime?.kind === "remote") {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.restoreConversationChanges(
      project.id,
      request.threadId,
      {
        revision: request.revision,
        ...(request.paths ? { paths: request.paths } : {}),
      },
    );
  }
  const workspace = workspaceForThread(project, request.threadId);
  return conversationChangeTracker.restore(
    project.id,
    request.threadId,
    workspace.path,
    request.revision,
    request.paths,
  );
}

async function handleWorktreeDeliveryPreflight(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseWorktreeDeliveryRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.preflightWorktreeDelivery(
      request.projectId,
      request.threadId,
      request.revision,
    );
  }
  const delivery = requireWorktreeDelivery(request);
  return delivery.manager.preflight(delivery.request);
}

async function handleWorktreeDeliveryHistory(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseConversationChangesRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.worktreeDeliveryHistory(
      request.projectId,
      request.threadId,
    );
  }
  if (!worktreeDeliveryManager) {
    throw new Error("Worktree delivery is not available");
  }
  const project = requireProject(request.projectId);
  const workspace = workspaceForThread(project, request.threadId);
  if (workspace.mode !== "worktree") {
    throw new Error("Only isolated worktree tasks have delivery history");
  }
  return worktreeDeliveryManager.history({
    ...request,
    projectPath: project.basePath,
  });
}

async function handleWorktreeDeliveryApply(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseWorktreeDeliveryRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.applyWorktreeDelivery(
      request.projectId,
      request.threadId,
      request.revision,
    );
  }
  const delivery = requireWorktreeDelivery(request);
  return applyAutomaticWorktreeDelivery(
    delivery.manager,
    delivery.request,
    (state) => {
      recordDeliveryConversationState(
        request.projectId,
        request.threadId,
        state.status,
        "retry",
        state.error,
      );
      event.sender.send(
        DESKTOP_MESSAGE_CHANNEL,
        automaticDeliveryNotification(
          request.projectId,
          request.threadId,
          state,
          "retry",
        ),
      );
    },
  );
}

async function handleWorktreeDeliveryUndo(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseWorktreeDeliveryRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.undoWorktreeDelivery(
      request.projectId,
      request.threadId,
      request.revision,
    );
  }
  const delivery = requireWorktreeDelivery(request);
  return delivery.manager.undo(delivery.request);
}

async function handleWorktreeDeliveryCommit(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseWorktreeDeliveryCommitRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.commitWorktreeDelivery(
      request.projectId,
      request.threadId,
      request.revision,
      request.message,
    );
  }
  const delivery = requireWorktreeDelivery(request);
  return delivery.manager.commit(delivery.request, request.message);
}

async function handleCodeHostDeliveryStatus(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseWorktreeDeliveryRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.codeHostDeliveryStatus(
      request.projectId,
      request.threadId,
      request.revision,
    );
  }
  const delivery = requireCodeHostDelivery(request);
  return delivery.manager.status(delivery.request);
}

async function handleCodeHostDeliveryCommitPush(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseCodeHostCommitPushRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.commitAndPushCodeHostDelivery(
      request.projectId,
      request.threadId,
      request.revision,
      request.message,
    );
  }
  const delivery = requireCodeHostDelivery(request);
  return delivery.manager.commitAndPush(delivery.request, request.message);
}

async function handleCodeHostDeliveryCreatePr(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  const request = parseCodeHostCreatePullRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.createPullRequest(
      request.projectId,
      request.threadId,
      request.revision,
      request.title,
      request.body,
      request.draft,
    );
  }
  const delivery = requireCodeHostDelivery(request);
  return delivery.manager.createPullRequest(delivery.request, {
    title: request.title,
    draft: request.draft,
    ...(request.body ? { body: request.body } : {}),
  });
}

function requireWorktreeDelivery(request: DesktopWorktreeDeliveryRequest) {
  if (!worktreeDeliveryManager) {
    throw new Error("Worktree delivery is not available");
  }
  const project = requireProject(request.projectId);
  if (project.runtime?.kind === "remote") {
    throw new Error("Remote Runtime tasks do not use local worktree delivery.");
  }
  const workspace = workspaceForThread(project, request.threadId);
  if (workspace.mode !== "worktree") {
    throw new Error("Only isolated worktree tasks can be delivered");
  }
  return {
    manager: worktreeDeliveryManager,
    request: {
      ...request,
      projectPath: project.basePath,
      workspace,
    },
  };
}

function requireCodeHostDelivery(request: DesktopWorktreeDeliveryRequest) {
  if (!codeHostDeliveryManager) {
    throw new Error("GitHub delivery is not available");
  }
  const delivery = requireWorktreeDelivery(request);
  return {
    manager: codeHostDeliveryManager,
    request: {
      projectId: request.projectId,
      threadId: request.threadId,
      revision: request.revision,
      workspace: delivery.request.workspace,
    },
  };
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
  if (project.runtime?.kind === "remote") {
    if (request.threadId && remoteHost) {
      return remoteHost.client.conversationWorkspaceList(
        project.id,
        request.threadId,
        request.path,
      );
    }
    const entries = await requireRemoteRuntime(project.id).listWorkspace(
      request.path,
    );
    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.kind,
    }));
  }
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
  if (project.runtime?.kind === "remote") {
    if (request.threadId && remoteHost) {
      return remoteHost.client.conversationWorkspaceFile(
        project.id,
        request.threadId,
        request.path,
      );
    }
    const file = await requireRemoteRuntime(project.id).getWorkspaceFile(
      request.path,
    );
    return {
      path: file.path,
      name: file.path.split("/").at(-1) ?? file.path,
      ...(file.binary ? {} : { content: file.content }),
      binary: file.binary,
      size: file.size,
    };
  }
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
  if (project.runtime?.kind === "remote") {
    throw new Error("Remote files cannot be revealed in the local file manager.");
  }
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
  if (isRemoteHost()) {
    throw new Error("Local files are hidden while a remote Host is active.");
  }
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
  const request = parseSystemFileRequest(value);
  if (isRemoteHost()) {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.client.file(request.path);
  }
  return readSystemFile(request.path);
}

async function handleSystemFileList(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!isRemoteHost() || !remoteHost) {
    throw new Error("Remote Host file browsing is not active.");
  }
  return remoteHost.client.files(parseSystemFileRequest(value).path);
}

async function handleSystemFileReveal(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<void> {
  requireTrustedSender(event);
  if (isRemoteHost()) {
    throw new Error("Local files are hidden while a remote Host is active.");
  }
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
  if (project.runtime?.kind === "remote") {
    const file = await requireRemoteRuntime(project.id)
      .getWorkspaceFile(".threadlight/MEMORY.md")
      .catch(() => ({
        path: ".threadlight/MEMORY.md",
        content: "",
        binary: false,
        size: 0,
      }));
    return {
      path: file.path,
      content: file.content,
      revision: `remote:${file.size}:${file.content.length}`,
    };
  }
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
  if (project.runtime?.kind === "remote") {
    throw new Error("Remote project memory cannot be opened by a local app.");
  }
  const snapshot = await new ProjectMemoryStore(project.basePath).read();
  const error = await shell.openPath(snapshot.absolutePath);
  if (error) throw new Error(error);
}

async function handleSearch(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedSender(event);
  if (!projectSearchService) throw new Error("Search is not available");
  const request = parseSearchRequest(value);
  const project = requireProject(request.projectId);
  if (project.runtime?.kind === "remote") {
    if (!remoteHost) throw new Error("Remote Host is not connected.");
    return remoteHost.search(request);
  }
  if (
    request.threadId &&
    !project.conversations.some(
      (conversation) => conversation.id === request.threadId,
    )
  ) {
    throw new Error("Unknown conversation");
  }
  const workspace = request.threadId
    ? workspaceForThread(project, request.threadId)
    : folderWorkspace(project.basePath);
  return projectSearchService.search({
    project,
    workspacePath: workspace.path,
    query: request.query,
    mode: request.mode,
    limit: request.limit ?? 80,
  });
}

async function handleAudioTranscription(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<string> {
  requireTrustedSender(event);
  if (!settingsStore) throw new Error("Settings are not available");
  const request = parseAudioTranscriptionRequest(value);
  if (isRemoteHost()) {
    const connection = remoteHost;
    if (!connection) throw new Error("Remote Host is not connected.");
    return connection.transcribeAudio(request);
  }
  const apiKey = settingsStore.runtimeSettings().openAIApiKey;
  if (!apiKey) {
    throw new Error("请先在设置中配置 OpenAI API Key，再使用语音输入。");
  }
  return transcribeAudio(request, { apiKey });
}

async function handleAttachmentReference(
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<AttachmentData> {
  requireTrustedSender(event);
  const activeProject = projectStore ? currentActiveProject() : undefined;
  if (!activeProject) {
    throw new Error("请先打开项目，再添加附件。");
  }
  const request = parseAttachmentReferenceRequest(value);
  if (isRemoteHost()) {
    const connection = remoteHost;
    if (!connection) throw new Error("Remote Host is not connected.");
    return uploadAttachmentReference(
      request,
      activeProject.id,
      (upload) => connection.uploadAttachment(upload),
    );
  }
  return createAttachmentReference(request);
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

function parseRemoteRuntimeConnectRequest(
  value: unknown,
): DesktopRemoteRuntimeConnectRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Remote Runtime connection.");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.endpoint !== "string" ||
    !request.endpoint.trim() ||
    typeof request.token !== "string" ||
    !request.token.trim() ||
    (request.name !== undefined && typeof request.name !== "string")
  ) {
    throw new Error("Remote Runtime endpoint and token are required.");
  }
  return {
    endpoint: request.endpoint,
    token: request.token,
    ...(typeof request.name === "string" ? { name: request.name } : {}),
  };
}

function parseHostUpdateRequest(value: unknown): DesktopHostUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Host update.");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.hostId !== "string" ||
    !request.hostId.trim() ||
    request.hostId === LOCAL_HOST_ID ||
    typeof request.endpoint !== "string" ||
    !request.endpoint.trim() ||
    (request.token !== undefined && typeof request.token !== "string") ||
    (request.name !== undefined && typeof request.name !== "string")
  ) {
    throw new Error("A saved remote Host and endpoint are required.");
  }
  return {
    hostId: request.hostId,
    endpoint: request.endpoint,
    ...(typeof request.token === "string" && request.token.trim()
      ? { token: request.token }
      : {}),
    ...(typeof request.name === "string" ? { name: request.name } : {}),
  };
}

function normalizeRemoteRuntimeEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote Runtime endpoint must use http or https.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function handleTerminalCreate(
  event: IpcMainInvokeEvent,
  value: unknown,
) {
  requireTrustedSender(event);
  if (!terminalService) throw new Error("Terminal is not available");
  const request = parseTerminalCreateRequest(value);
  const project = requireProject(request.projectId);
  if (project.runtime?.kind === "remote") {
    return requireRemoteTerminalClient().create(request);
  }
  const workspace = resolveTerminalWorkspace(
    project,
    request.threadId,
    request.workspace,
  );
  const session = terminalService.create(
    workspace.cwd,
    request.cols,
    request.rows,
  );
  return { ...session, ...workspace };
}

function handleTerminalWrite(event: IpcMainEvent, value: unknown): void {
  if (!isTrustedSender(event) || !terminalService) return;
  try {
    const request = parseTerminalWriteRequest(value);
    if (remoteTerminalClient?.owns(request.sessionId)) {
      remoteTerminalClient.write(request.sessionId, request.data);
    } else {
      terminalService.write(request.sessionId, request.data);
    }
  } catch {
    // Input can race with a shell exiting. A fire-and-forget IPC event has
    // nowhere useful to surface that stale write, so safely ignore it.
  }
}

function handleTerminalResize(event: IpcMainEvent, value: unknown): void {
  if (!isTrustedSender(event) || !terminalService) return;
  try {
    const request = parseTerminalResizeRequest(value);
    if (remoteTerminalClient?.owns(request.sessionId)) {
      remoteTerminalClient.resize(
        request.sessionId,
        request.cols,
        request.rows,
      );
    } else {
      terminalService.resize(request.sessionId, request.cols, request.rows);
    }
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
  if (remoteTerminalClient?.owns(value)) {
    remoteTerminalClient.close(value);
  } else {
    terminalService.close(value);
  }
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
  const project = currentProject(value);
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
  if (typeof update.customModel !== "string" || !update.customModel.trim()) {
    throw new Error("customModel must be a non-empty string");
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
    customModel: update.customModel.trim(),
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
    (update.accessMode !== undefined &&
      update.accessMode !== "approval" &&
      update.accessMode !== "full") ||
    (update.title === undefined &&
      update.pinned === undefined &&
      update.archived === undefined &&
      update.accessMode === undefined)
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
    ...(update.accessMode === "approval" || update.accessMode === "full"
      ? { accessMode: update.accessMode }
      : {}),
  };
}

function parseProjectMetadataUpdate(
  value: unknown,
): DesktopProjectMetadataUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid project metadata update");
  }
  const update = value as Record<string, unknown>;
  if (
    typeof update.id !== "string" ||
    !update.id ||
    typeof update.pinned !== "boolean"
  ) {
    throw new Error("Invalid project metadata update");
  }
  return { id: update.id, pinned: update.pinned };
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

function parseConversationRecoveryRequest(
  value: unknown,
): DesktopConversationRecoveryRequest {
  const target = parseConversationTarget(value);
  const request = value as Record<string, unknown>;
  const replacementId =
    typeof request.replacementId === "string"
      ? request.replacementId.trim()
      : undefined;
  if (
    request.replacementId !== undefined &&
    (!replacementId || typeof request.replacementId !== "string")
  ) {
    throw new Error("Invalid conversation recovery request");
  }
  return {
    ...target,
    ...(replacementId ? { replacementId } : {}),
  };
}

function parseDiagnosticExportRequest(value: unknown): {
  projectId: string;
  conversationIds?: readonly string[];
} {
  if (typeof value === "string" && value) return { projectId: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid diagnostic export request");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.projectId !== "string" || !request.projectId) {
    throw new Error("Invalid diagnostic project id");
  }
  if (request.conversationIds === undefined) {
    return { projectId: request.projectId };
  }
  if (
    !Array.isArray(request.conversationIds) ||
    request.conversationIds.length === 0 ||
    request.conversationIds.length > 500 ||
    request.conversationIds.some(
      (id) => typeof id !== "string" || !/^[\w-]+$/.test(id),
    )
  ) {
    throw new Error("Invalid diagnostic conversation selection");
  }
  return {
    projectId: request.projectId,
    conversationIds: [...new Set(request.conversationIds as string[])],
  };
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

function parseWorktreeDeliveryRequest(
  value: unknown,
): DesktopWorktreeDeliveryRequest {
  const request = parseConversationChangesRequest(value);
  const delivery = value as Record<string, unknown>;
  if (typeof delivery.revision !== "string" || !delivery.revision) {
    throw new Error("Invalid worktree delivery request");
  }
  return { ...request, revision: delivery.revision };
}

function parseWorktreeDeliveryCommitRequest(
  value: unknown,
): DesktopWorktreeDeliveryCommitRequest {
  const request = parseWorktreeDeliveryRequest(value);
  const commit = value as Record<string, unknown>;
  if (
    typeof commit.message !== "string" ||
    !commit.message.trim() ||
    commit.message.length > 1_000
  ) {
    throw new Error("Invalid worktree delivery commit message");
  }
  return { ...request, message: commit.message.trim() };
}

function parseCodeHostCommitPushRequest(
  value: unknown,
): DesktopCodeHostCommitPushRequest {
  const request = parseWorktreeDeliveryRequest(value);
  const input = value as Record<string, unknown>;
  if (
    typeof input.message !== "string" ||
    !input.message.trim() ||
    input.message.length > 1_000
  ) {
    throw new Error("Invalid GitHub delivery commit message");
  }
  return { ...request, message: input.message.trim() };
}

function parseCodeHostCreatePullRequest(
  value: unknown,
): DesktopCodeHostCreatePullRequest {
  const request = parseWorktreeDeliveryRequest(value);
  const input = value as Record<string, unknown>;
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 256 ||
    (input.draft !== undefined && typeof input.draft !== "boolean") ||
    (input.body !== undefined &&
      (typeof input.body !== "string" || input.body.length > 20_000))
  ) {
    throw new Error("Invalid PR details");
  }
  return {
    ...request,
    title: input.title.trim(),
    draft: input.draft !== false,
    ...(typeof input.body === "string" && input.body.trim()
      ? { body: input.body.trim() }
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

function parseSearchRequest(value: unknown): DesktopSearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid search request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    !request.projectId ||
    (request.threadId !== undefined &&
      (typeof request.threadId !== "string" || !request.threadId)) ||
    typeof request.query !== "string" ||
    request.query.length > 2_000 ||
    (request.mode !== "all" && request.mode !== "files") ||
    (request.limit !== undefined &&
      (!Number.isInteger(request.limit) ||
        Number(request.limit) < 1 ||
        Number(request.limit) > 200))
  ) {
    throw new Error("Invalid search request");
  }
  return {
    projectId: request.projectId,
    ...(typeof request.threadId === "string"
      ? { threadId: request.threadId }
      : {}),
    query: request.query,
    mode: request.mode,
    ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
  };
}

function parseAutomationRequest(
  value: unknown,
): DesktopAutomationCreateRequest;
function parseAutomationRequest(
  value: unknown,
  update: true,
): DesktopAutomationUpdateRequest;
function parseAutomationRequest(
  value: unknown,
  update = false,
): DesktopAutomationCreateRequest | DesktopAutomationUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid automation request");
  }
  const request = value as Record<string, unknown>;
  const schedule =
    request.schedule &&
    typeof request.schedule === "object" &&
    !Array.isArray(request.schedule)
      ? (request.schedule as Record<string, unknown>)
      : undefined;
  if (
    typeof request.projectId !== "string" ||
    !request.projectId ||
    (update && (typeof request.id !== "string" || !request.id)) ||
    typeof request.name !== "string" ||
    request.name.length > 120 ||
    (request.kind !== "custom" &&
      request.kind !== "tests" &&
      request.kind !== "dependencies" &&
      request.kind !== "issue-triage") ||
    typeof request.prompt !== "string" ||
    request.prompt.length > 12_000 ||
    typeof request.enabled !== "boolean" ||
    !schedule ||
    (schedule.cadence !== "daily" &&
      schedule.cadence !== "weekdays" &&
      schedule.cadence !== "weekly") ||
    typeof schedule.time !== "string" ||
    (schedule.weekday !== undefined &&
      (!Number.isInteger(schedule.weekday) ||
        Number(schedule.weekday) < 0 ||
        Number(schedule.weekday) > 6))
  ) {
    throw new Error("Invalid automation request");
  }
  const parsed: DesktopAutomationCreateRequest = {
    projectId: request.projectId,
    name: request.name,
    kind: request.kind,
    prompt: request.prompt,
    enabled: request.enabled,
    schedule: {
      cadence: schedule.cadence,
      time: schedule.time,
      ...(typeof schedule.weekday === "number"
        ? { weekday: schedule.weekday }
        : {}),
    },
  };
  return update
    ? { ...parsed, id: request.id as string }
    : parsed;
}

function parseAutomationTarget(value: unknown): DesktopAutomationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid automation target");
  }
  const target = value as Record<string, unknown>;
  if (
    typeof target.projectId !== "string" ||
    !target.projectId ||
    typeof target.id !== "string" ||
    !target.id
  ) {
    throw new Error("Invalid automation target");
  }
  return { projectId: target.projectId, id: target.id };
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
    (request.workspace !== undefined &&
      request.workspace !== "task" &&
      request.workspace !== "original") ||
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
    ...(request.workspace === "task" || request.workspace === "original"
      ? { workspace: request.workspace }
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

function automaticDeliveryNotification(
  projectId: string,
  threadId: string,
  state: AutomaticWorktreeDeliveryState,
  source: HostDeliverySource,
): JsonRpcOutgoing {
  const base = { projectId, threadId, revision: state.revision, source };
  if (state.status === "syncing") {
    return { jsonrpc: "2.0", method: "delivery/syncing", params: base };
  }
  if (state.status === "synced") {
    return {
      jsonrpc: "2.0",
      method: "delivery/synced",
      params: { ...base, result: state.result! },
    };
  }
  if (state.status === "conflict") {
    return {
      jsonrpc: "2.0",
      method: "delivery/conflict",
      params: {
        ...base,
        preflight: state.preflight!,
        error: state.error!,
      },
    };
  }
  return deliveryFailedNotification(
    projectId,
    threadId,
    source,
    state.error!,
    state.revision,
    state.preflight,
  );
}

function deliveryFailedNotification(
  projectId: string,
  threadId: string,
  source: HostDeliverySource,
  error: string,
  revision?: string,
  preflight?: AutomaticWorktreeDeliveryState["preflight"],
): JsonRpcOutgoing {
  return {
    jsonrpc: "2.0",
    method: "delivery/failed",
    params: {
      projectId,
      threadId,
      source,
      ...(revision ? { revision } : {}),
      ...(preflight ? { preflight } : {}),
      error,
    },
  };
}

function deliveryStateFromNotification(
  message: JsonRpcOutgoing,
):
  | {
      status: "syncing" | "synced" | "conflict" | "failed";
      source: HostDeliverySource;
      error?: string;
    }
  | undefined {
  if (!("method" in message)) return;
  if (
    message.method !== "delivery/syncing" &&
    message.method !== "delivery/synced" &&
    message.method !== "delivery/conflict" &&
    message.method !== "delivery/failed"
  ) {
    return;
  }
  const params = message.params as Record<string, unknown> | undefined;
  if (params?.source !== "lifecycle" && params?.source !== "retry") return;
  return {
    status: message.method.slice("delivery/".length) as
      | "syncing"
      | "synced"
      | "conflict"
      | "failed",
    source: params.source,
    ...(typeof params.error === "string" ? { error: params.error } : {}),
  };
}

function recordDeliveryConversationState(
  projectId: string,
  threadId: string,
  status: "syncing" | "synced" | "conflict" | "failed",
  source: HostDeliverySource,
  error?: string,
): void {
  const project = currentProject(projectId);
  const conversation = project?.conversations.find(({ id }) => id === threadId);
  const target = { projectId, id: threadId };
  try {
    if (status === "syncing") {
      projectStore?.markConversationPending(target);
    } else if (status === "synced") {
      projectStore?.markConversationCompleted(target);
      deliveryAttentionCompletions.delete(
        deliveryConversationKey(projectId, threadId),
      );
    } else {
      projectStore?.markConversationAttention(target);
      projectStore?.markConversationUnread(target);
      if (source === "lifecycle") {
        deliveryAttentionCompletions.add(
          deliveryConversationKey(projectId, threadId),
        );
      }
    }
  } catch {
    // A task can be removed while a late delivery result is queued.
  }
  if (
    source === "lifecycle" &&
    (status === "conflict" || status === "failed")
  ) {
    showDeliveryAttentionNotification({
      status,
      task: conversation?.title ?? threadId,
      error,
    });
  }
}

function deliveryConversationKey(projectId: string, threadId: string): string {
  return `${projectId}\u0000${threadId}`;
}

function showDeliveryAttentionNotification(input: {
  status: "conflict" | "failed";
  task: string;
  error?: string;
}): void {
  if (!Notification.isSupported()) return;
  const language = settingsStore?.snapshot().language ?? "en";
  const notification = new Notification({
    title: deliveryAttentionTitle(language, input.status),
    body: deliveryAttentionBody(input.task, input.error),
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

function sendAutomationSnapshot(projectId: string): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || !automationStore) return;
  window.webContents.send(
    DESKTOP_AUTOMATIONS_CHANGED_CHANNEL,
    automationStore.snapshot(projectId),
  );
}

function showAutomationAlert(alert: AutomationAlert): void {
  if (!Notification.isSupported()) return;
  const language = settingsStore?.snapshot().language ?? "en";
  const title =
    alert.status === "failed"
      ? automationNotificationCopy(language).failed
      : automationNotificationCopy(language).attention;
  const notification = new Notification({
    title,
    body: `${alert.automation.name} · ${alert.summary}`,
    icon: appIconPath,
  });
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.show();
    window.focus();
    if (alert.threadId) {
      const open = () =>
        window.webContents.send(DESKTOP_AUTOMATION_OPEN_CHANNEL, {
          projectId: alert.automation.projectId,
          id: alert.threadId,
        });
      if (window.webContents.isLoadingMainFrame()) {
        window.webContents.once("did-finish-load", () => {
          setTimeout(open, 100);
        });
      } else {
        open();
      }
    }
  });
  notification.show();
}

function automationNotificationCopy(language: string): {
  attention: string;
  failed: string;
} {
  switch (language) {
    case "zh-CN":
      return { attention: "自动化需要关注", failed: "自动化运行失败" };
    case "zh-TW":
      return { attention: "自動化需要關注", failed: "自動化執行失敗" };
    case "ja":
      return {
        attention: "自動化の確認が必要です",
        failed: "自動化の実行に失敗しました",
      };
    case "ko":
      return {
        attention: "자동화를 확인해야 합니다",
        failed: "자동화 실행 실패",
      };
    default:
      return {
        attention: "Automation needs attention",
        failed: "Automation run failed",
      };
  }
}

async function executeAutomation(
  automation: DesktopAutomation,
): Promise<AutomationExecutionResult> {
  const project = requireProject(automation.projectId);
  const workspace = folderWorkspace(project.basePath);
  const runtime = ensureAppServer(
    mainWindow,
    project.id,
    project.basePath,
    workspace,
  );
  await runtime.initialize();
  const started = await requestAutomationRuntime(runtime, "thread/start");
  const threadId =
    started &&
    typeof started === "object" &&
    !Array.isArray(started) &&
    typeof (started as Record<string, unknown>).threadId === "string"
      ? (started as Record<string, string>).threadId
      : undefined;
  if (!threadId) throw new Error("Automation task did not return a thread id");

  threadProjects.set(threadId, project.id);
  projectStore?.setConversationWorkspace(
    { projectId: project.id, id: threadId },
    workspace,
  );
  projectStore?.updateConversation({
    projectId: project.id,
    id: threadId,
    title: `⏱ ${automation.name}`,
  });
  if (project.runtime?.kind !== "remote") {
    await conversationChangeTracker?.ensureSnapshot(
      project.id,
      threadId,
      workspace.path,
    );
  }
  automationThreads.set(threadId, automation.id);
  const completed = new Promise<AutomationExecutionResult>((resolve) => {
    automationTurnWaiters.set(threadId, { resolve });
  });

  try {
    await requestAutomationRuntime(runtime, "turn/start", {
      threadId,
      input: [
        `Scheduled automation: ${automation.name}`,
        automation.prompt,
        "Run read-only checks only. Do not modify files, create commits, or change external state.",
        "End the final response with exactly one status marker: AUTOMATION_STATUS: ok when no action is needed, or AUTOMATION_STATUS: attention when the user should investigate.",
      ].join("\n\n"),
    });
    return await completed;
  } catch (error) {
    automationTurnWaiters.delete(threadId);
    automationThreads.delete(threadId);
    throw error;
  }
}

function requestAutomationRuntime(
  runtime: RuntimeProcess,
  method: ThreadlightMethod,
  params?: unknown,
): Promise<unknown> {
  const id = `threadlight:automation:${++automationRequestId}`;
  const promise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      automationRpcWaiters.delete(id);
      reject(new Error(`Automation runtime request timed out: ${method}`));
    }, 15_000);
    automationRpcWaiters.set(id, { resolve, reject, timer });
  });
  runtime.send({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
  return promise;
}

function settleAutomationRpc(message: JsonRpcOutgoing): void {
  if (
    !("id" in message) ||
    typeof message.id !== "string" ||
    !message.id.startsWith("threadlight:automation:")
  ) {
    return;
  }
  const waiter = automationRpcWaiters.get(message.id);
  if (!waiter) return;
  automationRpcWaiters.delete(message.id);
  clearTimeout(waiter.timer);
  if ("error" in message && message.error) {
    waiter.reject(new Error(message.error.message));
  } else {
    waiter.resolve(message.result);
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
  const project = requireProject(projectId);
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

function appServerEnvironment(
  projectRoot: string,
  settings: Parameters<typeof runtimeEnvironment>[0],
  scope?: "project" | "standalone",
): NodeJS.ProcessEnv {
  return {
    ...runtimeEnvironment(settings),
    THREADLIGHT_PROJECT_ROOT: projectRoot,
    ...(scope === "standalone"
      ? { THREADLIGHT_TASK_SCOPE: "standalone" }
      : {}),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function reconcileLegacyNoChangesAttention(
  projects: ProjectStore,
  delivery: WorktreeDeliveryManager,
): Promise<void> {
  for (const project of projects.snapshot().projects) {
    for (const conversation of project.conversations) {
      if (
        conversation.status !== "attention" ||
        conversation.workspace?.mode !== "worktree"
      ) {
        continue;
      }
      try {
        if (
          await delivery.hasLegacyNoChangesFailure({
            projectId: project.id,
            threadId: conversation.id,
            projectPath: project.basePath,
          })
        ) {
          projects.markConversationCompleted({
            projectId: project.id,
            id: conversation.id,
          });
        }
      } catch {
        // A malformed legacy journal must not delay Desktop startup.
      }
    }
  }
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
      remoteHost = new RemoteHostConnection(
        savedHost.endpoint,
        savedToken,
      );
      projectStore = remoteProjectStore;
    } else {
      hostStore.activate(LOCAL_HOST_ID);
    }
  }
  automationStore = new AutomationStore(
    join(threadlightHome, "automations.json"),
  );
  automationScheduler = new AutomationScheduler(automationStore, {
    execute: executeAutomation,
    notify: showAutomationAlert,
    onChange: sendAutomationSnapshot,
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
  terminalService = new TerminalSessionManager(
    sendTerminalEvent,
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
  protocol.handle("threadlight-attachment", async (request) => {
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
      if (isRemoteHost()) {
        const attachmentId = parts.length === 2 ? parts[0] : undefined;
        const project = projectStore ? currentActiveProject() : undefined;
        const connection = remoteHost;
        if (!attachmentId || !project || !connection) {
          return new Response("Not found", { status: 404 });
        }
        const mimeType = url.searchParams.get("mimeType");
        return new Response(
          await connection.downloadAttachment(project.id, attachmentId),
          {
            headers: {
              "Content-Type":
                mimeType && !/[\r\n]/.test(mimeType)
                  ? mimeType
                  : "application/octet-stream",
              "Cache-Control": "private, max-age=3600",
            },
          },
        );
      }
      return net.fetch(
        pathToFileURL(resolveAttachmentUrlPath(encodedPath)).href,
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  const initialWorkspace = process.env.THREADLIGHT_WORKSPACE;
  if (initialWorkspace) localProjectStore.register(initialWorkspace);
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
  ipcMain.handle(
    DESKTOP_EXTERNAL_OPEN_CHANNEL,
    async (event, value: unknown) => {
      requireTrustedSender(event);
      if (typeof value !== "string") {
        throw new TypeError("External URL must be a string");
      }
      const url = new URL(value);
      if (url.protocol !== "https:") {
        throw new Error("OAuth authorization URL must use HTTPS.");
      }
      await shell.openExternal(url.toString());
    },
  );
  ipcMain.handle(DESKTOP_SETTINGS_UPDATE_CHANNEL, handleSettingsUpdate);
  ipcMain.handle(DESKTOP_DIAGNOSTICS_GET_CHANNEL, handleDiagnosticsGet);
  ipcMain.handle(
    DESKTOP_DIAGNOSTICS_EXPORT_CHANNEL,
    handleDiagnosticsExport,
  );
  ipcMain.handle(DESKTOP_PROVIDER_TEST_CHANNEL, handleProviderTest);
  ipcMain.handle(DESKTOP_PROJECTS_GET_CHANNEL, handleProjectsGet);
  ipcMain.handle(DESKTOP_HOSTS_GET_CHANNEL, handleHostsGet);
  ipcMain.handle(DESKTOP_HOST_ACTIVATE_CHANNEL, handleHostActivate);
  ipcMain.handle(DESKTOP_HOST_UPDATE_CHANNEL, handleHostUpdate);
  ipcMain.handle(DESKTOP_HOST_DELETE_CHANNEL, handleHostDelete);
  ipcMain.handle(DESKTOP_HOST_DIRECTORIES_CHANNEL, handleHostDirectories);
  ipcMain.handle(DESKTOP_PROJECT_OPEN_CHANNEL, handleProjectOpen);
  ipcMain.handle(
    DESKTOP_STANDALONE_CREATE_CHANNEL,
    handleStandaloneCreate,
  );
  ipcMain.handle(
    DESKTOP_REMOTE_RUNTIME_CONNECT_CHANNEL,
    handleRemoteRuntimeConnect,
  );
  ipcMain.handle(DESKTOP_PROJECT_ACTIVATE_CHANNEL, handleProjectActivate);
  ipcMain.handle(DESKTOP_PROJECT_UPDATE_CHANNEL, handleProjectUpdate);
  ipcMain.handle(DESKTOP_PROJECT_DELETE_CHANNEL, handleProjectDelete);
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
    DESKTOP_CONVERSATION_RECOVER_CHANNEL,
    handleConversationRecover,
  );
  ipcMain.handle(
    DESKTOP_CONVERSATION_DELETE_CHANNEL,
    handleConversationDelete,
  );
  ipcMain.handle(DESKTOP_PROJECT_MEMORY_GET_CHANNEL, handleProjectMemoryGet);
  ipcMain.handle(DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL, handleProjectMemoryOpen);
  ipcMain.handle(DESKTOP_SEARCH_CHANNEL, handleSearch);
  ipcMain.handle(DESKTOP_AUTOMATIONS_GET_CHANNEL, handleAutomationsGet);
  ipcMain.handle(
    DESKTOP_AUTOMATIONS_CREATE_CHANNEL,
    handleAutomationCreate,
  );
  ipcMain.handle(
    DESKTOP_AUTOMATIONS_UPDATE_CHANNEL,
    handleAutomationUpdate,
  );
  ipcMain.handle(
    DESKTOP_AUTOMATIONS_DELETE_CHANNEL,
    handleAutomationDelete,
  );
  ipcMain.handle(DESKTOP_AUTOMATIONS_RUN_CHANNEL, handleAutomationRun);
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
  ipcMain.handle(
    DESKTOP_WORKTREE_DELIVERY_PREFLIGHT_CHANNEL,
    handleWorktreeDeliveryPreflight,
  );
  ipcMain.handle(
    DESKTOP_WORKTREE_DELIVERY_HISTORY_CHANNEL,
    handleWorktreeDeliveryHistory,
  );
  ipcMain.handle(
    DESKTOP_WORKTREE_DELIVERY_APPLY_CHANNEL,
    handleWorktreeDeliveryApply,
  );
  ipcMain.handle(
    DESKTOP_WORKTREE_DELIVERY_UNDO_CHANNEL,
    handleWorktreeDeliveryUndo,
  );
  ipcMain.handle(
    DESKTOP_WORKTREE_DELIVERY_COMMIT_CHANNEL,
    handleWorktreeDeliveryCommit,
  );
  ipcMain.handle(
    DESKTOP_CODE_HOST_DELIVERY_STATUS_CHANNEL,
    handleCodeHostDeliveryStatus,
  );
  ipcMain.handle(
    DESKTOP_CODE_HOST_DELIVERY_COMMIT_PUSH_CHANNEL,
    handleCodeHostDeliveryCommitPush,
  );
  ipcMain.handle(
    DESKTOP_CODE_HOST_DELIVERY_CREATE_PR_CHANNEL,
    handleCodeHostDeliveryCreatePr,
  );
  ipcMain.handle(DESKTOP_WORKSPACE_LIST_CHANNEL, handleWorkspaceList);
  ipcMain.handle(DESKTOP_WORKSPACE_FILE_GET_CHANNEL, handleWorkspaceFileGet);
  ipcMain.handle(
    DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL,
    handleWorkspaceFileReveal,
  );
  ipcMain.handle(DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL, handleSystemFileChoose);
  ipcMain.handle(DESKTOP_SYSTEM_FILE_LIST_CHANNEL, handleSystemFileList);
  ipcMain.handle(DESKTOP_SYSTEM_FILE_GET_CHANNEL, handleSystemFileGet);
  ipcMain.handle(DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL, handleSystemFileReveal);
  ipcMain.handle(
    DESKTOP_EXECUTION_APPROVAL_RESPOND_CHANNEL,
    handleExecutionApprovalRespond,
  );
  ipcMain.handle(
    DESKTOP_EXECUTION_POLICY_GET_CHANNEL,
    handleExecutionPolicyGet,
  );
  ipcMain.handle(
    DESKTOP_EXECUTION_POLICY_REVOKE_CHANNEL,
    handleExecutionPolicyRevoke,
  );
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
