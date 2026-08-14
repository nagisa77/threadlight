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
import { DesktopProjectController } from "./project-controller.js";
import { DesktopNotificationController } from "./notification-controller.js";
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
  errorMessage,
  extractJsonRpcId,
  isJsonRpcRequest,
  jsonRpcRequestKey,
} from "./json-rpc-model.js";

export interface DesktopIpcControllerHost {
  readonly mainWindow: BrowserWindow | null;
  readonly threadProjects: Map<string, string>;
  readonly pendingThreadStarts: Map<
    string | number | null,
    { projectId: string; workspace: DesktopTaskWorkspace }
  >;
  readonly processWorkspaces: Map<string, string>;
  readonly projectStore: ProjectStore | null;
  readonly conversationChangeTracker: ConversationChangeTracker | null;
  readonly taskWorkspaceManager: TaskWorkspaceManager | null;
  readonly executionPolicyStore: ExecutionPolicyStore | null;
  readonly taskExecutionGrants: Set<string>;
  readonly pendingExecutionApprovals: Map<
    string,
    { request: DesktopExecutionApprovalRequest; runtimeKey: string }
  >;
  requireProject(
    value: unknown,
  ): NonNullable<ReturnType<ProjectStore["project"]>>;
  requireTrustedSender(event: IpcMainInvokeEvent): void;
  currentProject(
    projectId: string,
  ): DesktopProjectsSnapshot["projects"][number] | undefined;
  currentProjectsSnapshot(): DesktopProjectsSnapshot;
  disposeTaskWorkspace(workspace: DesktopTaskWorkspace): Promise<void>;
  ensureAppServer(
    window: BrowserWindow | null,
    projectId: string,
    projectRoot: string,
    workspace: DesktopTaskWorkspace,
  ): AppServerProcess | RemoteRuntimeConnection;
  folderWorkspace(path: string): DesktopTaskWorkspace;
  runtimeKeyForProject(projectId: string, workspacePath: string): string;
  sendRuntime(runtimeKey: string, message: JsonRpcRequest): void;
  sendToRenderer(window: BrowserWindow, message: JsonRpcOutgoing): void;
}

export class DesktopIpcController {
  constructor(private readonly host: DesktopIpcControllerHost) {}

  projectIdForThread(threadId: string): string | undefined {
    const known = this.host.threadProjects.get(threadId);
    if (known) return known;
    const project = this.host.projectStore
      ? this.host
          .currentProjectsSnapshot()
          .projects.find((candidate) =>
            candidate.conversations.some(
              (conversation) => conversation.id === threadId,
            ),
          )
      : undefined;
    if (project) this.host.threadProjects.set(threadId, project.id);
    return project?.id;
  }

  handleExecutionApprovalNotification(
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
        this.host.pendingExecutionApprovals.delete(requestId);
        const window = this.host.mainWindow;
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
    const request = this.parseExecutionApprovalRequest(
      projectId,
      message.params,
    );
    if (!request) return true;
    const key = this.taskExecutionGrantKey(request);
    const granted =
      this.host.taskExecutionGrants.has(key) ||
      this.host.executionPolicyStore?.allows(
        projectId,
        request.permissionKey,
      ) === true;
    const runtimeId = this.host.runtimeKeyForProject(projectId, workspace.path);
    if (granted) {
      this.host.sendRuntime(runtimeId, {
        jsonrpc: "2.0",
        method: "execution/approval/respond",
        params: { requestId: request.requestId, decision: "allow" },
      });
      return true;
    }
    this.host.pendingExecutionApprovals.set(request.requestId, {
      request,
      runtimeKey: runtimeId,
    });
    const window = this.host.mainWindow;
    if (window && !window.isDestroyed()) {
      window.webContents.send(
        DESKTOP_EXECUTION_APPROVAL_REQUIRED_CHANNEL,
        request,
      );
      window.show();
    }
    return true;
  }

  parseExecutionApprovalRequest(
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
    const project = this.host.projectStore
      ? this.host.currentProject(projectId)
      : undefined;
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

  taskExecutionGrantKey(
    request: Pick<
      DesktopExecutionApprovalRequest,
      "projectId" | "threadId" | "permissionKey"
    >,
  ): string {
    return `${request.projectId}\0${request.threadId}\0${request.permissionKey}`;
  }

  handleExecutionApprovalRespond(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): void {
    this.host.requireTrustedSender(event);
    const response = this.parseExecutionApprovalResponse(value);
    const pending = this.host.pendingExecutionApprovals.get(response.requestId);
    if (!pending)
      throw new Error("This approval request is no longer pending.");
    if (
      response.scope === "project" &&
      !pending.request.projectScopeAvailable
    ) {
      throw new Error(
        "Permanent project approval is unavailable outside a project.",
      );
    }
    this.host.pendingExecutionApprovals.delete(response.requestId);
    if (response.decision === "allow") {
      if (response.scope === "task") {
        this.host.taskExecutionGrants.add(
          this.taskExecutionGrantKey(pending.request),
        );
      } else if (response.scope === "project") {
        this.host.executionPolicyStore?.grant(pending.request.projectId, {
          permissionKey: pending.request.permissionKey,
          label: pending.request.summary,
          external: pending.request.external,
        });
      }
    }
    this.host.sendRuntime(pending.runtimeKey, {
      jsonrpc: "2.0",
      method: "execution/approval/respond",
      params: {
        requestId: response.requestId,
        decision: response.decision,
      },
    });
  }

  parseExecutionApprovalResponse(
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

  handleExecutionPolicyGet(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (typeof value !== "string") throw new TypeError("projectId is required");
    this.host.requireProject(value);
    if (!this.host.executionPolicyStore)
      throw new Error("Execution policy is unavailable");
    return this.host.executionPolicyStore.snapshot(value);
  }

  handleExecutionPolicyRevoke(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
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
    this.host.requireProject(request.projectId);
    if (!this.host.executionPolicyStore)
      throw new Error("Execution policy is unavailable");
    return this.host.executionPolicyStore.revoke(
      request.projectId,
      request.permissionKey,
    );
  }

  projectForRequest(request: JsonRpcRequest) {
    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : undefined;
    const threadId = params?.threadId;
    const projectId =
      typeof threadId === "string"
        ? this.projectIdForThread(threadId)
        : this.host.currentProjectsSnapshot().activeProjectId;
    return projectId ? this.host.currentProject(projectId) : undefined;
  }

  workspaceForRequest(
    request: JsonRpcRequest,
    project: NonNullable<ReturnType<ProjectStore["project"]>>,
  ): DesktopTaskWorkspace {
    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : undefined;
    const threadId = params?.threadId;
    if (typeof threadId === "string") {
      return this.workspaceForThread(project, threadId);
    }
    const sessionId = params?.sessionId;
    if (typeof sessionId === "string") {
      const workspacePath = this.host.processWorkspaces.get(sessionId);
      if (workspacePath) {
        return (
          project.conversations.find(
            (conversation) => conversation.workspace?.path === workspacePath,
          )?.workspace ?? this.host.folderWorkspace(workspacePath)
        );
      }
    }
    return this.host.folderWorkspace(project.basePath);
  }

  workspaceForThread(
    project: NonNullable<ReturnType<ProjectStore["project"]>>,
    threadId: string,
  ): DesktopTaskWorkspace {
    return (
      project.conversations.find((conversation) => conversation.id === threadId)
        ?.workspace ?? this.host.folderWorkspace(project.basePath)
    );
  }

  developmentModeForThreadStart(request: JsonRpcRequest): TaskDevelopmentMode {
    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : undefined;
    const mode = params?.developmentMode;
    if (mode === undefined) return "local";
    if (mode === "local" || mode === "worktree") return mode;
    throw new Error("Invalid task development mode");
  }

  async handleRequest(event: IpcMainEvent, value: unknown): Promise<void> {
    if (
      !this.host.mainWindow ||
      event.sender !== this.host.mainWindow.webContents ||
      event.senderFrame !== this.host.mainWindow.webContents.mainFrame
    ) {
      return;
    }
    if (!isJsonRpcRequest(value)) {
      const id = extractJsonRpcId(value);
      if (id !== undefined) {
        this.host.sendToRenderer(this.host.mainWindow, {
          jsonrpc: "2.0",
          id,
          error: { code: -32600, message: "Invalid JSON-RPC request" },
        });
      }
      return;
    }
    const project = this.projectForRequest(value);
    if (!project) {
      if (value.id !== undefined) {
        this.host.sendToRenderer(this.host.mainWindow, {
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
          workspace = this.host.folderWorkspace(project.runtime.workspacePath);
        } else if (!this.host.taskWorkspaceManager) {
          throw new Error("Task workspace management is not available");
        } else {
          workspace =
            project.scope === "standalone"
              ? await this.host.taskWorkspaceManager.prepareStandalone()
              : await this.host.taskWorkspaceManager.prepare(
                  project.id,
                  project.basePath,
                  this.developmentModeForThreadStart(value),
                );
          await this.host.conversationChangeTracker?.beginPendingSnapshot(
            project.id,
            jsonRpcRequestKey(value.id),
            workspace.path,
          );
        }
      } catch (error) {
        if (workspace) await this.host.disposeTaskWorkspace(workspace);
        if (value.id !== undefined) {
          this.host.sendToRenderer(this.host.mainWindow, {
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
      const runtime = this.host.ensureAppServer(
        this.host.mainWindow,
        project.id,
        project.basePath,
        workspace,
      );
      try {
        await runtime.initialize();
      } catch (error) {
        if (project.runtime?.kind !== "remote") {
          await this.host.conversationChangeTracker?.discardPendingSnapshot(
            project.id,
            jsonRpcRequestKey(value.id),
          );
        }
        await this.host.disposeTaskWorkspace(workspace);
        this.host.sendToRenderer(this.host.mainWindow, {
          jsonrpc: "2.0",
          id: value.id,
          error: {
            code: -32010,
            message: `Unable to initialize the task runtime: ${errorMessage(error)}`,
          },
        });
        return;
      }
      this.host.pendingThreadStarts.set(value.id, {
        projectId: project.id,
        workspace,
      });
      runtime.send(value);
      return;
    }
    const workspace = this.workspaceForRequest(value, project);
    if (
      (value.method === "thread/resume" || value.method === "turn/start") &&
      value.params &&
      typeof value.params === "object"
    ) {
      const threadId = (value.params as Record<string, unknown>).threadId;
      if (typeof threadId === "string") {
        try {
          if (project.runtime?.kind !== "remote") {
            await this.host.conversationChangeTracker?.ensureSnapshot(
              project.id,
              threadId,
              workspace.path,
            );
          }
        } catch (error) {
          if (value.id !== undefined) {
            this.host.sendToRenderer(this.host.mainWindow, {
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
            this.host.projectStore?.markConversationPending({
              projectId: project.id,
              id: threadId,
            });
          } catch {
            // The runtime will report an unknown thread if the task disappeared.
          }
        }
      }
    }
    const runtime = this.host.ensureAppServer(
      this.host.mainWindow,
      project.id,
      project.basePath,
      workspace,
    );
    if (value.method !== "initialize") {
      try {
        await runtime.initialize();
      } catch (error) {
        if (value.id !== undefined) {
          this.host.sendToRenderer(this.host.mainWindow, {
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
}
