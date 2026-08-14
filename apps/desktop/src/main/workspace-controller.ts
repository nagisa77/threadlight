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
  parseComputerPermission,
  parseConversationChangesRequest,
} from "./ipc-settings-parsers.js";
import {
  parseConversationChangesRestoreRequest,
  parseWorktreeDeliveryRequest,
  parseWorktreeDeliveryCommitRequest,
  parseCodeHostCommitPushRequest,
  parseCodeHostCreatePullRequest,
  parseWorkspaceListRequest,
  parseWorkspaceFileRequest,
  parseSystemFileRequest,
  parseSearchRequest,
  parseAttachmentReferenceRequest,
} from "./ipc-workspace-parsers.js";

export interface DesktopWorkspaceControllerHost {
  readonly mainWindow: BrowserWindow | null;
  readonly settingsStore: SettingsStore | null;
  readonly projectStore: ProjectStore | null;
  readonly remoteHost: RemoteHostConnection | null;
  readonly computerService: DesktopComputerService | null;
  readonly computerPermissionService: ComputerPermissionService | null;
  readonly conversationChangeTracker: ConversationChangeTracker | null;
  readonly worktreeDeliveryManager: WorktreeDeliveryManager | null;
  readonly codeHostDeliveryManager: CodeHostDeliveryManager | null;
  readonly projectSearchService: ProjectSearchService | null;
  currentActiveProject(): ReturnType<ProjectStore["activeProject"]>;
  isRemoteHost(): boolean;
  requireRemoteRuntime(projectId: string): RemoteRuntimeConnection;
  workspaceForThread(
    project: NonNullable<ReturnType<ProjectStore["project"]>>,
    threadId: string,
  ): DesktopTaskWorkspace;
  folderWorkspace(path: string): DesktopTaskWorkspace;
  requireProject(
    value: unknown,
  ): NonNullable<ReturnType<ProjectStore["project"]>>;
  requireTrustedSender(event: IpcMainInvokeEvent): void;
  recordDeliveryConversationState(
    projectId: string,
    threadId: string,
    status: "syncing" | "synced" | "conflict" | "failed",
    source: HostDeliverySource,
    error?: string,
  ): void;
  automaticDeliveryNotification(
    projectId: string,
    threadId: string,
    state: AutomaticWorktreeDeliveryState,
    source: HostDeliverySource,
  ): JsonRpcOutgoing;
}

export class DesktopWorkspaceController {
  constructor(private readonly host: DesktopWorkspaceControllerHost) {}

  async handleConversationChangesGet(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    if (!this.host.conversationChangeTracker) {
      throw new Error("Conversation change tracking is not available");
    }
    const request = parseConversationChangesRequest(value);
    const project = this.host.requireProject(request.projectId);
    const workspace = this.host.workspaceForThread(project, request.threadId);
    if (project.runtime?.kind === "remote") {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.conversationChanges(
        project.id,
        request.threadId,
      );
    }
    return this.host.conversationChangeTracker.changes(
      project.id,
      request.threadId,
      workspace.path,
    );
  }

  async handleConversationChangesRestore(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    if (!this.host.conversationChangeTracker) {
      throw new Error("Conversation change tracking is not available");
    }
    const request = parseConversationChangesRestoreRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.restoreConversationChanges(
        project.id,
        request.threadId,
        {
          revision: request.revision,
          ...(request.paths ? { paths: request.paths } : {}),
        },
      );
    }
    const workspace = this.host.workspaceForThread(project, request.threadId);
    return this.host.conversationChangeTracker.restore(
      project.id,
      request.threadId,
      workspace.path,
      request.revision,
      request.paths,
    );
  }

  async handleWorktreeDeliveryPreflight(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    const request = parseWorktreeDeliveryRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.preflightWorktreeDelivery(
        request.projectId,
        request.threadId,
        request.revision,
      );
    }
    const delivery = this.requireWorktreeDelivery(request);
    return delivery.manager.preflight(delivery.request);
  }

  async handleWorktreeDeliveryHistory(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    const request = parseConversationChangesRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.worktreeDeliveryHistory(
        request.projectId,
        request.threadId,
      );
    }
    if (!this.host.worktreeDeliveryManager) {
      throw new Error("Worktree delivery is not available");
    }
    const project = this.host.requireProject(request.projectId);
    const workspace = this.host.workspaceForThread(project, request.threadId);
    if (workspace.mode !== "worktree") {
      throw new Error("Only isolated worktree tasks have delivery history");
    }
    return this.host.worktreeDeliveryManager.history({
      ...request,
      projectPath: project.basePath,
    });
  }

  async handleWorktreeDeliveryApply(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const request = parseWorktreeDeliveryRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.applyWorktreeDelivery(
        request.projectId,
        request.threadId,
        request.revision,
      );
    }
    const delivery = this.requireWorktreeDelivery(request);
    return applyAutomaticWorktreeDelivery(
      delivery.manager,
      delivery.request,
      (state) => {
        this.host.recordDeliveryConversationState(
          request.projectId,
          request.threadId,
          state.status,
          "retry",
          state.error,
        );
        event.sender.send(
          DESKTOP_MESSAGE_CHANNEL,
          this.host.automaticDeliveryNotification(
            request.projectId,
            request.threadId,
            state,
            "retry",
          ),
        );
      },
    );
  }

  async handleWorktreeDeliveryUndo(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const request = parseWorktreeDeliveryRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.undoWorktreeDelivery(
        request.projectId,
        request.threadId,
        request.revision,
      );
    }
    const delivery = this.requireWorktreeDelivery(request);
    return delivery.manager.undo(delivery.request);
  }

  async handleWorktreeDeliveryCommit(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    const request = parseWorktreeDeliveryCommitRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.commitWorktreeDelivery(
        request.projectId,
        request.threadId,
        request.revision,
        request.message,
      );
    }
    const delivery = this.requireWorktreeDelivery(request);
    return delivery.manager.commit(delivery.request, request.message);
  }

  async handleCodeHostDeliveryStatus(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    const request = parseWorktreeDeliveryRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.codeHostDeliveryStatus(
        request.projectId,
        request.threadId,
        request.revision,
      );
    }
    const delivery = this.requireCodeHostDelivery(request);
    return delivery.manager.status(delivery.request);
  }

  async handleCodeHostDeliveryCommitPush(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    const request = parseCodeHostCommitPushRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.commitAndPushCodeHostDelivery(
        request.projectId,
        request.threadId,
        request.revision,
        request.message,
      );
    }
    const delivery = this.requireCodeHostDelivery(request);
    return delivery.manager.commitAndPush(delivery.request, request.message);
  }

  async handleCodeHostDeliveryCreatePr(
    event: IpcMainInvokeEvent,
    value: unknown,
  ) {
    this.host.requireTrustedSender(event);
    const request = parseCodeHostCreatePullRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.createPullRequest(
        request.projectId,
        request.threadId,
        request.revision,
        request.title,
        request.body,
        request.draft,
      );
    }
    const delivery = this.requireCodeHostDelivery(request);
    return delivery.manager.createPullRequest(delivery.request, {
      title: request.title,
      draft: request.draft,
      ...(request.body ? { body: request.body } : {}),
    });
  }

  requireWorktreeDelivery(request: DesktopWorktreeDeliveryRequest) {
    if (!this.host.worktreeDeliveryManager) {
      throw new Error("Worktree delivery is not available");
    }
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      throw new Error(
        "Remote Runtime tasks do not use local worktree delivery.",
      );
    }
    const workspace = this.host.workspaceForThread(project, request.threadId);
    if (workspace.mode !== "worktree") {
      throw new Error("Only isolated worktree tasks can be delivered");
    }
    return {
      manager: this.host.worktreeDeliveryManager,
      request: {
        ...request,
        projectPath: project.basePath,
        workspace,
      },
    };
  }

  requireCodeHostDelivery(request: DesktopWorktreeDeliveryRequest) {
    if (!this.host.codeHostDeliveryManager) {
      throw new Error("GitHub delivery is not available");
    }
    const delivery = this.requireWorktreeDelivery(request);
    return {
      manager: this.host.codeHostDeliveryManager,
      request: {
        projectId: request.projectId,
        threadId: request.threadId,
        revision: request.revision,
        workspace: delivery.request.workspace,
      },
    };
  }

  async handleWorkspaceList(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.conversationChangeTracker) {
      throw new Error("Workspace browsing is not available");
    }
    const request = parseWorkspaceListRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      if (request.threadId && this.host.remoteHost) {
        return this.host.remoteHost.client.conversationWorkspaceList(
          project.id,
          request.threadId,
          request.path,
        );
      }
      const entries = await this.host
        .requireRemoteRuntime(project.id)
        .listWorkspace(request.path);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.kind,
      }));
    }
    const workspace = request.threadId
      ? this.host.workspaceForThread(project, request.threadId)
      : this.host.folderWorkspace(project.basePath);
    return this.host.conversationChangeTracker.listWorkspace(
      workspace.path,
      request.path,
    );
  }

  async handleWorkspaceFileGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.conversationChangeTracker) {
      throw new Error("Workspace browsing is not available");
    }
    const request = parseWorkspaceFileRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      if (request.threadId && this.host.remoteHost) {
        return this.host.remoteHost.client.conversationWorkspaceFile(
          project.id,
          request.threadId,
          request.path,
        );
      }
      const file = await this.host
        .requireRemoteRuntime(project.id)
        .getWorkspaceFile(request.path);
      return {
        path: file.path,
        name: file.path.split("/").at(-1) ?? file.path,
        ...(file.binary ? {} : { content: file.content }),
        binary: file.binary,
        size: file.size,
      };
    }
    const workspace = request.threadId
      ? this.host.workspaceForThread(project, request.threadId)
      : this.host.folderWorkspace(project.basePath);
    return this.host.conversationChangeTracker.readWorkspaceFile(
      workspace.path,
      request.path,
    );
  }

  async handleWorkspaceFileReveal(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> {
    this.host.requireTrustedSender(event);
    if (!this.host.conversationChangeTracker) {
      throw new Error("Workspace browsing is not available");
    }
    const request = parseWorkspaceFileRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      throw new Error(
        "Remote files cannot be revealed in the local file manager.",
      );
    }
    const workspace = request.threadId
      ? this.host.workspaceForThread(project, request.threadId)
      : this.host.folderWorkspace(project.basePath);
    const absolutePath =
      await this.host.conversationChangeTracker.workspaceFilePath(
        workspace.path,
        request.path,
      );
    shell.showItemInFolder(absolutePath);
  }

  async handleWorkspaceFileDownload(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ArrayBuffer> {
    this.host.requireTrustedSender(event);
    const request = parseWorkspaceFileRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind !== "remote") {
      throw new Error(
        "Local workspace files should be opened in the file manager.",
      );
    }
    if (request.threadId && this.host.remoteHost) {
      return this.host.remoteHost.client.downloadConversationWorkspaceFile(
        project.id,
        request.threadId,
        request.path,
      );
    }
    return this.host
      .requireRemoteRuntime(project.id)
      .downloadWorkspaceFile(request.path);
  }

  async handleSystemFileChoose(
    event: IpcMainInvokeEvent,
  ): Promise<string | undefined> {
    this.host.requireTrustedSender(event);
    if (this.host.isRemoteHost()) {
      throw new Error("Local files are hidden while a remote Host is active.");
    }
    if (!this.host.mainWindow)
      throw new Error("File browsing is not available");
    const result = await dialog.showOpenDialog(this.host.mainWindow, {
      properties: ["openFile"],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return undefined;
    return resolveSystemFilePath(path);
  }

  async handleSystemFileGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const request = parseSystemFileRequest(value);
    if (this.host.isRemoteHost()) {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.client.file(request.path);
    }
    return readSystemFile(request.path);
  }

  async handleSystemFileList(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.isRemoteHost() || !this.host.remoteHost) {
      throw new Error("Remote Host file browsing is not active.");
    }
    return this.host.remoteHost.client.files(
      parseSystemFileRequest(value).path,
    );
  }

  async handleSystemFileReveal(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> {
    this.host.requireTrustedSender(event);
    if (this.host.isRemoteHost()) {
      throw new Error("Local files are hidden while a remote Host is active.");
    }
    const absolutePath = await resolveSystemFilePath(
      parseSystemFileRequest(value).path,
    );
    shell.showItemInFolder(absolutePath);
  }

  async handleSystemFileDownload(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ArrayBuffer> {
    this.host.requireTrustedSender(event);
    if (!this.host.isRemoteHost() || !this.host.remoteHost) {
      throw new Error(
        "Local system files should be opened in the file manager.",
      );
    }
    return this.host.remoteHost.client.downloadFile(
      parseSystemFileRequest(value).path,
    );
  }

  async handleProjectMemoryGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    const project = this.host.requireProject(value);
    if (project.runtime?.kind === "remote") {
      const file = await this.host
        .requireRemoteRuntime(project.id)
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

  async handleProjectMemoryOpen(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> {
    this.host.requireTrustedSender(event);
    const project = this.host.requireProject(value);
    if (project.runtime?.kind === "remote") {
      throw new Error("Remote project memory cannot be opened by a local app.");
    }
    const snapshot = await new ProjectMemoryStore(project.basePath).read();
    const error = await shell.openPath(snapshot.absolutePath);
    if (error) throw new Error(error);
  }

  async handleSearch(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.projectSearchService)
      throw new Error("Search is not available");
    const request = parseSearchRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      if (!this.host.remoteHost)
        throw new Error("Remote Host is not connected.");
      return this.host.remoteHost.search(request);
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
      ? this.host.workspaceForThread(project, request.threadId)
      : this.host.folderWorkspace(project.basePath);
    return this.host.projectSearchService.search({
      project,
      workspacePath: workspace.path,
      query: request.query,
      mode: request.mode,
      limit: request.limit ?? 80,
    });
  }

  async handleAudioTranscription(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<string> {
    this.host.requireTrustedSender(event);
    if (!this.host.settingsStore) throw new Error("Settings are not available");
    const request = parseAudioTranscriptionRequest(value);
    if (this.host.isRemoteHost()) {
      const connection = this.host.remoteHost;
      if (!connection) throw new Error("Remote Host is not connected.");
      return connection.transcribeAudio(request);
    }
    const apiKey = this.host.settingsStore.runtimeSettings().openAIApiKey;
    if (!apiKey) {
      throw new Error(VOICE_INPUT_ERROR_CODES.openAiKeyRequired);
    }
    return transcribeAudio(request, { apiKey });
  }

  async handleAttachmentReference(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<AttachmentData> {
    this.host.requireTrustedSender(event);
    const activeProject = this.host.projectStore
      ? this.host.currentActiveProject()
      : undefined;
    if (!activeProject) {
      throw new Error(ATTACHMENT_ERROR_CODES.projectRequired);
    }
    const request = parseAttachmentReferenceRequest(value);
    if (this.host.isRemoteHost()) {
      const connection = this.host.remoteHost;
      if (!connection) throw new Error("Remote Host is not connected.");
      return uploadAttachmentReference(request, activeProject.id, (upload) =>
        connection.uploadAttachment(upload),
      );
    }
    return createAttachmentReference(request);
  }

  handleComputerShareGet(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.computerService)
      throw new Error("Computer sharing is not available");
    return this.host.computerService.shareSnapshot();
  }

  handleComputerShareShow(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.computerService)
      throw new Error("Computer sharing is not available");
    return this.host.computerService.showPictureInPicture();
  }

  handleComputerShareStop(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.computerService)
      throw new Error("Computer sharing is not available");
    return this.host.computerService.stopSharing();
  }

  handleComputerPermissionGet(event: IpcMainInvokeEvent) {
    this.host.requireTrustedSender(event);
    if (!this.host.computerPermissionService) {
      throw new Error("Computer permissions are not available");
    }
    return this.host.computerPermissionService.snapshot().required
      ? this.host.computerPermissionService.refresh()
      : this.host.computerPermissionService.snapshot();
  }

  handleComputerPermissionRequest(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.computerPermissionService) {
      throw new Error("Computer permissions are not available");
    }
    return this.host.computerPermissionService.request(
      parseComputerPermission(value),
    );
  }

  handleComputerPermissionRelaunch(event: IpcMainInvokeEvent): void {
    this.host.requireTrustedSender(event);
    app.relaunch();
    setImmediate(() => app.exit(0));
  }
}
