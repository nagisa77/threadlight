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
  ATTACHMENT_ERROR_CODES,
  THREADLIGHT_HOST_PROTOCOL_VERSION,
  THREADLIGHT_METHODS,
  VOICE_INPUT_ERROR_CODES,
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
import { RunningThreadRegistry } from "@threadlight/host-core";
import { ProjectMemoryStore } from "@threadlight/project-memory";
import { TerminalSessionManager } from "@threadlight/terminal-core";

import {
  AppServerProcess,
  resolveAppServerEntry,
} from "./app-server-process.js";
import { RemoteRuntimeConnection } from "./remote-runtime-connection.js";
import { DesktopWorkspaceController } from "./workspace-controller.js";
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
import { ComputerPermissionService } from "./computer-permissions.js";
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
import { projectDiagnosticBundle, projectDiagnostics } from "./diagnostics.js";
import { testProviderConnection } from "./provider-diagnostics.js";
import { openProjectWith, projectOpeners } from "./project-opener.js";
import {
  completedTaskTarget,
  deliveryAttentionBody,
  deliveryAttentionTitle,
  handleTaskCompletion,
  type TaskCompletionNotification,
} from "./task-completion.js";
import { readSystemFile, resolveSystemFilePath } from "./system-files.js";
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
  DESKTOP_SYSTEM_FILE_DOWNLOAD_CHANNEL,
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
  DESKTOP_WORKSPACE_FILE_DOWNLOAD_CHANNEL,
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

import {
  parseRemoteRuntimeConnectRequest,
  normalizeRemoteRuntimeEndpoint,
  parseHostUpdateRequest,
  parseSettingsUpdate,
  parseProviderTestRequest,
  parseConversationUpdate,
  parseConversationMetadataUpdate,
  parseProjectMetadataUpdate,
  parseProjectOpenWithRequest,
  parseConversationTarget,
  parseConversationRecoveryRequest,
  parseDiagnosticExportRequest,
} from "./ipc-settings-parsers.js";
import {
  parseAutomationRequest,
  parseAutomationTarget,
} from "./ipc-workspace-parsers.js";
import { desktopCopy } from "./desktop-copy.js";

export interface DesktopProjectControllerHost {
  readonly mainWindow: BrowserWindow | null;
  readonly threadProjects: Map<string, string>;
  readonly settingsStore: SettingsStore | null;
  readonly projectStore: ProjectStore | null;
  readonly localProjectStore: ProjectStore | null;
  readonly remoteProjectStore: ProjectStore | null;
  readonly hostStore: HostStore | null;
  readonly remoteHost: RemoteHostConnection | null;
  readonly conversationChangeTracker: ConversationChangeTracker | null;
  readonly worktreeDeliveryManager: WorktreeDeliveryManager | null;
  readonly automationStore: AutomationStore | null;
  readonly automationScheduler: AutomationScheduler | null;
  readonly hostCredentials: HostCredentialStore | null;
  requireProject(
    value: unknown,
  ): NonNullable<ReturnType<ProjectStore["project"]>>;
  requireTrustedSender(event: IpcMainInvokeEvent): void;
  setRemoteHost(value: RemoteHostConnection | null): void;
  setProjectStore(value: ProjectStore | null): void;
  activeHostId(): string;
  currentActiveProject():
    DesktopProjectsSnapshot["projects"][number] | undefined;
  currentProject(
    projectId: string,
  ): DesktopProjectsSnapshot["projects"][number] | undefined;
  currentProjectsSnapshot(): DesktopProjectsSnapshot;
  ensureAppServer(
    window: BrowserWindow | null,
    projectId: string,
    projectRoot: string,
    workspace: DesktopTaskWorkspace,
  ): void;
  folderWorkspace(path: string): DesktopTaskWorkspace;
  isRemoteHost(): boolean;
  restartLocalRuntimes(environment: NodeJS.ProcessEnv): void;
  withRunningThreads(
    snapshot: DesktopProjectsSnapshot,
  ): DesktopProjectsSnapshot;
  sendAutomationSnapshot(projectId: string): void;
  stopTerminalSessions(): void;
  disposeTaskWorkspace(workspace: DesktopTaskWorkspace): Promise<void>;
  stopAppServers(): void;
  stopProjectRuntimes(projectId: string): void;
  syncRemoteProjects(
    snapshot: HostProjectsSnapshot,
    preferredProjectId?: string,
  ): DesktopProjectsSnapshot;
  workspaceForThread(
    project: NonNullable<ReturnType<ProjectStore["project"]>>,
    threadId: string,
  ): DesktopTaskWorkspace;
}

export class DesktopProjectController {
  constructor(private readonly host: DesktopProjectControllerHost) {}

  async handleSettingsGet(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.settingsStore) throw new Error("Settings are not available");
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.settings();
    }
    return this.host.settingsStore.snapshot();
  }

  async handleSettingsUpdate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.settingsStore) throw new Error("Settings are not available");

    const update = parseSettingsUpdate(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      this.host.stopAppServers();
      return this.host.remoteHost.updateSettings(update);
    }
    const previousRuntimeSettings = this.host.settingsStore.runtimeSettings();
    const snapshot = this.host.settingsStore.update(update);
    const nextRuntimeSettings = this.host.settingsStore.runtimeSettings();
    if (
      this.host.mainWindow &&
      JSON.stringify(previousRuntimeSettings) !==
        JSON.stringify(nextRuntimeSettings)
    ) {
      const environment = runtimeEnvironment(nextRuntimeSettings);
      this.host.restartLocalRuntimes(environment);
    }
    return snapshot;
  }

  handleDiagnosticsGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const project = this.host.requireProject(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.diagnostics(project.id);
    }
    return projectDiagnostics(project);
  }

  async handleDiagnosticsExport(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const request = parseDiagnosticExportRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.diagnosticBundle(
        project.id,
        request.conversationIds,
      );
    }
    if (!this.host.conversationChangeTracker) {
      throw new Error("Conversation changes are not available.");
    }
    return projectDiagnosticBundle(project, {
      changes: this.host.conversationChangeTracker,
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

  handleProviderTest(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.settingsStore) throw new Error("Settings are not available");
    const request = parseProviderTestRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.testProvider(request);
    }
    return testProviderConnection(
      request,
      this.host.settingsStore.runtimeSettings(),
    );
  }

  async handleProjectsGet(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.syncRemoteProjects(
        await this.host.remoteHost.projects(),
      );
    }
    return this.host.currentProjectsSnapshot();
  }

  handleAutomationsGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const project = this.host.requireProject(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.automations(project.id);
    }
    if (!this.host.automationStore)
      throw new Error("Automations are not available");
    return this.host.automationStore.snapshot(project.id);
  }

  handleAutomationCreate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const request = parseAutomationRequest(value);
    this.host.requireProject(request.projectId);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.createAutomation(request);
    }
    if (!this.host.automationStore)
      throw new Error("Automations are not available");
    const snapshot = this.host.automationStore.create(request);
    this.host.sendAutomationSnapshot(request.projectId);
    return snapshot;
  }

  handleAutomationUpdate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const request = parseAutomationRequest(value, true);
    this.host.requireProject(request.projectId);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.updateAutomation(request);
    }
    if (!this.host.automationStore)
      throw new Error("Automations are not available");
    const snapshot = this.host.automationStore.update(request);
    this.host.sendAutomationSnapshot(request.projectId);
    return snapshot;
  }

  handleAutomationDelete(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const target = parseAutomationTarget(value);
    this.host.requireProject(target.projectId);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.deleteAutomation(target.projectId, target.id);
    }
    if (!this.host.automationStore)
      throw new Error("Automations are not available");
    const snapshot = this.host.automationStore.delete(
      target.projectId,
      target.id,
    );
    this.host.sendAutomationSnapshot(target.projectId);
    return snapshot;
  }

  handleAutomationRun(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const target = parseAutomationTarget(value);
    this.host.requireProject(target.projectId);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.runAutomation(target.projectId, target.id);
    }
    if (!this.host.automationStore || !this.host.automationScheduler) {
      throw new Error("Automations are not available");
    }
    const automation = this.host.automationStore.get(target.id);
    if (!automation || automation.projectId !== target.projectId) {
      throw new Error("Unknown automation");
    }
    this.host.automationScheduler.runNow(target.id);
    return this.host.automationStore.snapshot(target.projectId);
  }

  async handleProjectOpen(event: IpcMainInvokeEvent, value?: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore || !this.host.mainWindow) {
      throw new Error("Projects are not available");
    }
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      if (typeof value !== "string" || !value.trim()) {
        throw new Error("Enter an absolute project path on the remote host.");
      }
      const remoteSnapshot = await this.host.remoteHost.client.registerProject(
        value.trim(),
      );
      const snapshot = this.host.syncRemoteProjects(
        remoteSnapshot,
        remoteSnapshot.activeProjectId,
      );
      const activeProject = this.host.currentActiveProject();
      if (activeProject) {
        this.host.ensureAppServer(
          this.host.mainWindow,
          activeProject.id,
          activeProject.basePath,
          this.host.folderWorkspace(activeProject.basePath),
        );
      }
      return snapshot;
    }
    const result = await dialog.showOpenDialog(this.host.mainWindow, {
      title: desktopCopy(
        this.host.settingsStore?.snapshot().language ?? "zh-CN",
      ).openProjectFolder,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return this.host.currentProjectsSnapshot();
    }

    const snapshot = this.host.projectStore.register(result.filePaths[0]);
    const activeProject = this.host.currentActiveProject();
    if (activeProject) {
      this.host.ensureAppServer(
        this.host.mainWindow,
        activeProject.id,
        activeProject.basePath,
        this.host.folderWorkspace(activeProject.basePath),
      );
    }
    return this.host.withRunningThreads(snapshot);
  }

  async handleStandaloneCreate(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore || !this.host.mainWindow) {
      throw new Error("Projects are not available");
    }
    let snapshot: DesktopProjectsSnapshot;
    if (this.host.isRemoteHost()) {
      const remoteSnapshot =
        await this.host.remoteHost!.client.createStandaloneTask();
      snapshot = this.host.syncRemoteProjects(
        remoteSnapshot,
        remoteSnapshot.activeProjectId,
      );
    } else {
      snapshot = this.host.withRunningThreads(
        this.host.projectStore.activateStandalone(),
      );
    }
    const activeProject = this.host.currentActiveProject();
    if (activeProject) {
      this.host.ensureAppServer(
        this.host.mainWindow,
        activeProject.id,
        activeProject.basePath,
        this.host.folderWorkspace(activeProject.basePath),
      );
    }
    return snapshot;
  }

  async handleRemoteRuntimeConnect(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (
      !this.host.projectStore ||
      !this.host.hostStore ||
      !this.host.hostCredentials ||
      !this.host.mainWindow
    ) {
      throw new Error("Threadlight Host is not available.");
    }
    const request = parseRemoteRuntimeConnectRequest(value);
    const endpoint = normalizeRemoteRuntimeEndpoint(request.endpoint);
    const connection = new RemoteHostConnection(endpoint, request.token);
    const health = await connection.health();
    if (health.protocolVersion !== THREADLIGHT_HOST_PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported Threadlight Host protocol: ${health.protocolVersion}`,
      );
    }
    this.host.stopAppServers();
    this.host.stopTerminalSessions();
    this.host.hostStore.upsert({
      id: health.hostId,
      name: request.name?.trim() || health.name,
      endpoint,
    });
    this.host.hostCredentials.set(health.hostId, request.token);
    this.host.setRemoteHost(connection);
    this.host.setProjectStore(this.host.remoteProjectStore);
    this.host.syncRemoteProjects(await connection.projects());
    return this.host.hostStore.snapshot();
  }

  handleHostsGet(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.hostStore) throw new Error("Hosts are not available.");
    return this.host.hostStore.snapshot();
  }

  async handleHostActivate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (
      !this.host.hostStore ||
      !this.host.projectStore ||
      !this.host.hostCredentials
    ) {
      throw new Error("Hosts are not available.");
    }
    if (typeof value !== "string" || !value)
      throw new Error("Invalid host id.");
    this.host.stopAppServers();
    this.host.stopTerminalSessions();
    if (value === LOCAL_HOST_ID) {
      this.host.hostStore.activate(value);
      this.host.setRemoteHost(null);
      this.host.setProjectStore(this.host.localProjectStore);
      return this.host.hostStore.snapshot();
    }
    const profile = this.host.hostStore.remote(value);
    const token = this.host.hostCredentials.get(value);
    if (!profile || !token) {
      throw new Error("Saved Host credentials are unavailable. Connect again.");
    }
    const connection = new RemoteHostConnection(profile.endpoint, token);
    const health = await connection.health();
    if (health.hostId !== value) {
      throw new Error("The endpoint now identifies a different Host.");
    }
    this.host.hostStore.activate(value);
    this.host.setRemoteHost(connection);
    this.host.setProjectStore(this.host.remoteProjectStore);
    this.host.syncRemoteProjects(await connection.projects());
    return this.host.hostStore.snapshot();
  }

  async handleHostUpdate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (
      !this.host.hostStore ||
      !this.host.hostCredentials ||
      !this.host.remoteProjectStore
    ) {
      throw new Error("Hosts are not available.");
    }
    const request = parseHostUpdateRequest(value);
    const profile = this.host.hostStore.remote(request.hostId);
    if (!profile) {
      throw new Error("Only a saved remote Host can be updated.");
    }
    const endpoint = normalizeRemoteRuntimeEndpoint(request.endpoint);
    const replacementToken = request.token?.trim();
    const token =
      replacementToken || this.host.hostCredentials.get(request.hostId);
    if (!token) {
      throw new Error("Saved Host credentials are unavailable. Enter a token.");
    }
    const connection = new RemoteHostConnection(endpoint, token);
    const health = await connection.health();
    if (health.protocolVersion !== THREADLIGHT_HOST_PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported Threadlight Host protocol: ${health.protocolVersion}`,
      );
    }
    if (health.hostId !== request.hostId) {
      throw new Error("The endpoint identifies a different Threadlight Host.");
    }

    const updatingActiveHost = this.host.activeHostId() === request.hostId;
    const reconnectActiveHost =
      updatingActiveHost &&
      (endpoint !== profile.endpoint || Boolean(replacementToken));
    const remoteProjects = reconnectActiveHost
      ? await connection.projects()
      : undefined;

    if (reconnectActiveHost) {
      this.host.stopAppServers();
      this.host.stopTerminalSessions();
    }
    const snapshot = this.host.hostStore.update({
      id: request.hostId,
      name: request.name?.trim() || health.name,
      endpoint,
    });
    if (replacementToken) {
      this.host.hostCredentials.set(request.hostId, replacementToken);
    }
    if (remoteProjects) {
      this.host.setRemoteHost(connection);
      this.host.setProjectStore(this.host.remoteProjectStore);
      this.host.syncRemoteProjects(remoteProjects);
    }
    return snapshot;
  }

  handleHostDelete(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (
      !this.host.hostStore ||
      !this.host.hostCredentials ||
      !this.host.remoteProjectStore
    ) {
      throw new Error("Hosts are not available.");
    }
    if (typeof value !== "string" || !value)
      throw new Error("Invalid host id.");
    if (value === LOCAL_HOST_ID || !this.host.hostStore.remote(value)) {
      throw new Error("Only a saved remote Host can be removed.");
    }
    const deletingActiveHost = this.host.activeHostId() === value;
    if (deletingActiveHost) {
      this.host.stopAppServers();
      this.host.stopTerminalSessions();
    }
    this.host.remoteProjectStore.removeRemoteHost(value);
    this.host.hostCredentials.delete(value);
    const snapshot = this.host.hostStore.delete(value);
    if (deletingActiveHost) {
      this.host.setRemoteHost(null);
      this.host.setProjectStore(this.host.localProjectStore);
    }
    return snapshot;
  }

  async handleHostDirectories(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.isRemoteHost() || !this.host.remoteHost) {
      throw new Error("Remote Host is not connected.");
    }
    const request =
      typeof value === "string"
        ? { path: value }
        : value &&
            typeof value === "object" &&
            "path" in value &&
            typeof value.path === "string"
          ? {
              path: value.path,
              options:
                "options" in value &&
                value.options &&
                typeof value.options === "object"
                  ? {
                      showHidden:
                        "showHidden" in value.options &&
                        value.options.showHidden === true,
                      strict:
                        "strict" in value.options &&
                        value.options.strict === true,
                    }
                  : undefined,
            }
          : undefined;
    if (!request) {
      throw new Error("A remote directory path is required.");
    }
    return this.host.remoteHost.client.directories(
      request.path,
      request.options,
    );
  }

  async handleProjectActivate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore || !this.host.mainWindow) {
      throw new Error("Projects are not available");
    }
    if (typeof value !== "string" || !value)
      throw new Error("Invalid project id");

    const snapshot = this.host.isRemoteHost()
      ? this.host.syncRemoteProjects(
          await this.host.remoteHost!.client.projects(),
          value,
        )
      : this.host.withRunningThreads(
          this.host.projectStore.activate(value) as DesktopProjectsSnapshot,
        );
    const activeProject = this.host.currentActiveProject();
    if (activeProject) {
      this.host.ensureAppServer(
        this.host.mainWindow,
        activeProject.id,
        activeProject.basePath,
        this.host.folderWorkspace(activeProject.basePath),
      );
    }
    return snapshot;
  }

  async handleProjectUpdate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    const update = parseProjectMetadataUpdate(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.syncRemoteProjects(
        await this.host.remoteHost.client.updateProject(update),
      );
    }
    return this.host.withRunningThreads(
      this.host.projectStore.updateProject(update),
    );
  }

  async handleProjectDelete(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    if (typeof value !== "string" || !value)
      throw new Error("Invalid project id");
    const deletingActive = this.host.currentActiveProject()?.id === value;
    const project = this.host.currentProject(value);
    const deletedThreadIds = new Set(
      project?.conversations.map((conversation) => conversation.id) ?? [],
    );
    if (project?.runtime?.kind !== "remote" && project) {
      for (const threadId of deletedThreadIds) {
        await this.host.conversationChangeTracker
          ?.deleteSnapshot(value, threadId)
          .catch(() => undefined);
        await this.host.worktreeDeliveryManager
          ?.deleteJournal({
            projectId: value,
            threadId,
            projectPath: project.basePath,
          })
          .catch(() => undefined);
      }
    }
    const snapshot = this.host.isRemoteHost()
      ? this.host.syncRemoteProjects(
          await this.host.remoteHost!.client.deleteProject(value),
        )
      : this.host.projectStore.deleteProject(value);
    this.host.stopProjectRuntimes(value);
    if (deletingActive && this.host.mainWindow) {
      const nextProject = this.host.currentActiveProject();
      if (nextProject) {
        this.host.ensureAppServer(
          this.host.mainWindow,
          nextProject.id,
          nextProject.basePath,
          this.host.folderWorkspace(nextProject.basePath),
        );
      }
    }
    return this.host.withRunningThreads(snapshot);
  }

  async handleProjectOpenersGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const selectedProject =
      typeof value === "string" && value
        ? this.host.requireProject(value)
        : this.host.projectStore
          ? this.host.currentActiveProject()
          : undefined;
    if (selectedProject?.runtime?.kind === "remote") return [];
    const basePath =
      typeof value === "string" && value
        ? this.host.requireProject(value).basePath
        : (this.host.currentActiveProject()?.basePath ?? app.getPath("home"));
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

  async handleProjectOpenWith(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> {
    this.host.requireTrustedSender(event);
    const request = parseProjectOpenWithRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      throw new Error("Remote workspaces cannot be opened by a local app.");
    }
    const workspace = request.threadId
      ? this.host.workspaceForThread(project, request.threadId)
      : this.host.folderWorkspace(project.basePath);
    const availableOpeners = await projectOpeners(workspace.path);
    if (!availableOpeners.some((opener) => opener.id === request.opener)) {
      throw new Error("The selected project app is no longer available");
    }
    await openProjectWith(workspace.path, request.opener, {
      openPath: (path) => shell.openPath(path),
    });
  }

  async handleConversationUpsert(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    const update = parseConversationUpdate(value);
    this.host.threadProjects.set(update.id, update.projectId);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.syncRemoteProjects(
        await this.host.remoteHost.client.upsertConversation(update),
      );
    }
    return this.host.withRunningThreads(
      this.host.projectStore.upsertConversation(update),
    );
  }

  async handleConversationRead(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    const target = parseConversationTarget(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.syncRemoteProjects(
        await this.host.remoteHost.client.markConversationRead(target),
      );
    }
    return this.host.withRunningThreads(
      this.host.projectStore.markConversationRead(target),
    );
  }

  async handleConversationUpdate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    const update = parseConversationMetadataUpdate(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.syncRemoteProjects(
        await this.host.remoteHost.client.updateConversation(update),
      );
    }
    return this.host.withRunningThreads(
      this.host.projectStore.updateConversation(update),
    );
  }

  async handleConversationRecover(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    const request = parseConversationRecoveryRequest(value);
    let snapshot;
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      snapshot = this.host.syncRemoteProjects(
        await this.host.remoteHost.client.recoverConversation(request),
      );
    } else {
      snapshot = this.host.projectStore.recoverConversation(request);
    }
    this.host.threadProjects.delete(request.id);
    if (request.replacementId) {
      this.host.threadProjects.set(request.replacementId, request.projectId);
    }
    return this.host.withRunningThreads(snapshot);
  }

  async handleConversationDelete(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectStore) throw new Error("Projects are not available");
    const target = parseConversationTarget(value);
    const project = this.host.currentProject(target.projectId);
    const workspace = project
      ? this.host.workspaceForThread(project, target.id)
      : undefined;
    this.host.threadProjects.delete(target.id);
    await this.host.conversationChangeTracker
      ?.deleteSnapshot(target.projectId, target.id)
      .catch(() => undefined);
    if (
      !this.host.isRemoteHost() &&
      project &&
      this.host.worktreeDeliveryManager
    ) {
      await this.host.worktreeDeliveryManager
        .deleteJournal({
          projectId: target.projectId,
          threadId: target.id,
          projectPath: project.basePath,
        })
        .catch(() => undefined);
    }
    const snapshot = this.host.isRemoteHost()
      ? this.host.syncRemoteProjects(
          await this.host.remoteHost!.client.deleteConversation(target),
        )
      : this.host.projectStore.deleteConversation(target);
    if (workspace) {
      await this.host.disposeTaskWorkspace(workspace).catch(() => undefined);
    }
    return this.host.withRunningThreads(snapshot);
  }
}
