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
import { desktopCopy } from "./desktop-copy.js";

type RuntimeProcess = AppServerProcess | RemoteRuntimeConnection;

export interface DesktopNotificationControllerHost {
  readonly mainWindow: BrowserWindow | null;
  readonly threadProjects: Map<string, string>;
  readonly deliveryAttentionCompletions: Set<string>;
  readonly settingsStore: SettingsStore | null;
  readonly projectStore: ProjectStore | null;
  readonly conversationChangeTracker: ConversationChangeTracker | null;
  readonly automationStore: AutomationStore | null;
  readonly automationRpcWaiters: Map<
    string,
    {
      resolve(result: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  readonly automationTurnWaiters: Map<
    string,
    { resolve(result: AutomationExecutionResult): void }
  >;
  readonly automationThreads: Map<string, string>;
  readonly appIconPath: string;
  nextAutomationRequestId(): number;
  createWindow(): void;
  requireProject(
    value: unknown,
  ): NonNullable<ReturnType<ProjectStore["project"]>>;
  currentProject(
    projectId: string,
  ): DesktopProjectsSnapshot["projects"][number] | undefined;
  ensureAppServer(
    window: BrowserWindow | null,
    projectId: string,
    projectRoot: string,
    workspace: DesktopTaskWorkspace,
  ): AppServerProcess | RemoteRuntimeConnection;
  folderWorkspace(path: string): DesktopTaskWorkspace;
  sendToRenderer(window: BrowserWindow, message: JsonRpcOutgoing): void;
}

export class DesktopNotificationController {
  constructor(private readonly host: DesktopNotificationControllerHost) {}

  automaticDeliveryNotification(
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
    return this.deliveryFailedNotification(
      projectId,
      threadId,
      source,
      state.error!,
      state.revision,
      state.preflight,
    );
  }

  deliveryFailedNotification(
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

  deliveryStateFromNotification(message: JsonRpcOutgoing):
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
        "syncing" | "synced" | "conflict" | "failed",
      source: params.source,
      ...(typeof params.error === "string" ? { error: params.error } : {}),
    };
  }

  recordDeliveryConversationState(
    projectId: string,
    threadId: string,
    status: "syncing" | "synced" | "conflict" | "failed",
    source: HostDeliverySource,
    error?: string,
  ): void {
    const project = this.host.currentProject(projectId);
    const conversation = project?.conversations.find(
      ({ id }) => id === threadId,
    );
    const target = { projectId, id: threadId };
    try {
      if (status === "syncing") {
        this.host.projectStore?.markConversationPending(target);
      } else if (status === "synced") {
        this.host.projectStore?.markConversationCompleted(target);
        this.host.deliveryAttentionCompletions.delete(
          this.deliveryConversationKey(projectId, threadId),
        );
      } else {
        this.host.projectStore?.markConversationAttention(target);
        this.host.projectStore?.markConversationUnread(target);
        if (source === "lifecycle") {
          this.host.deliveryAttentionCompletions.add(
            this.deliveryConversationKey(projectId, threadId),
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
      this.showDeliveryAttentionNotification({
        status,
        task: conversation?.title ?? threadId,
        error,
      });
    }
  }

  deliveryConversationKey(projectId: string, threadId: string): string {
    return `${projectId}\u0000${threadId}`;
  }

  showDeliveryAttentionNotification(input: {
    status: "conflict" | "failed";
    task: string;
    error?: string;
  }): void {
    if (!Notification.isSupported()) return;
    const language = this.host.settingsStore?.snapshot().language ?? "zh-CN";
    const notification = new Notification({
      title: deliveryAttentionTitle(language, input.status),
      body: deliveryAttentionBody(input.task, input.error),
      icon: this.host.appIconPath,
    });
    notification.on("click", () => {
      const window = this.host.mainWindow;
      if (!window || window.isDestroyed()) return;
      window.show();
      window.focus();
    });
    notification.show();
  }

  showTaskCompletionNotification(completion: TaskCompletionNotification): void {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: completion.title,
      body: completion.body,
      icon: this.host.appIconPath,
    });
    notification.on("click", () => {
      const window = this.host.mainWindow;
      if (!window || window.isDestroyed()) return;
      window.show();
      window.focus();
    });
    notification.show();
  }

  sendAutomationSnapshot(projectId: string): void {
    const window = this.host.mainWindow;
    if (!window || window.isDestroyed() || !this.host.automationStore) return;
    window.webContents.send(
      DESKTOP_AUTOMATIONS_CHANGED_CHANNEL,
      this.host.automationStore.snapshot(projectId),
    );
  }

  showAutomationAlert(alert: AutomationAlert): void {
    if (!Notification.isSupported()) return;
    const language = this.host.settingsStore?.snapshot().language ?? "zh-CN";
    const copy = desktopCopy(language).automation;
    const title = alert.status === "failed" ? copy.failed : copy.attention;
    const notification = new Notification({
      title,
      body: `${alert.automation.name} · ${alert.summary}`,
      icon: this.host.appIconPath,
    });
    notification.on("click", () => {
      if (!this.host.mainWindow || this.host.mainWindow.isDestroyed())
        this.host.createWindow();
      const window = this.host.mainWindow;
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

  async executeAutomation(
    automation: DesktopAutomation,
  ): Promise<AutomationExecutionResult> {
    const project = this.host.requireProject(automation.projectId);
    const workspace = this.host.folderWorkspace(project.basePath);
    const runtime = this.host.ensureAppServer(
      this.host.mainWindow,
      project.id,
      project.basePath,
      workspace,
    );
    await runtime.initialize();
    const started = await this.requestAutomationRuntime(
      runtime,
      "thread/start",
    );
    const threadId =
      started &&
      typeof started === "object" &&
      !Array.isArray(started) &&
      typeof (started as Record<string, unknown>).threadId === "string"
        ? (started as Record<string, string>).threadId
        : undefined;
    if (!threadId)
      throw new Error("Automation task did not return a thread id");

    this.host.threadProjects.set(threadId, project.id);
    this.host.projectStore?.setConversationWorkspace(
      { projectId: project.id, id: threadId },
      workspace,
    );
    this.host.projectStore?.updateConversation({
      projectId: project.id,
      id: threadId,
      title: `⏱ ${automation.name}`,
    });
    if (project.runtime?.kind !== "remote") {
      await this.host.conversationChangeTracker?.ensureSnapshot(
        project.id,
        threadId,
        workspace.path,
      );
    }
    this.host.automationThreads.set(threadId, automation.id);
    const completed = new Promise<AutomationExecutionResult>((resolve) => {
      this.host.automationTurnWaiters.set(threadId, { resolve });
    });

    try {
      await this.requestAutomationRuntime(runtime, "turn/start", {
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
      this.host.automationTurnWaiters.delete(threadId);
      this.host.automationThreads.delete(threadId);
      throw error;
    }
  }

  requestAutomationRuntime(
    runtime: RuntimeProcess,
    method: ThreadlightMethod,
    params?: unknown,
  ): Promise<unknown> {
    const id = `threadlight:automation:${this.host.nextAutomationRequestId()}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.host.automationRpcWaiters.delete(id);
        reject(new Error(`Automation runtime request timed out: ${method}`));
      }, 15_000);
      this.host.automationRpcWaiters.set(id, { resolve, reject, timer });
    });
    runtime.send({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    });
    return promise;
  }

  settleAutomationRpc(message: JsonRpcOutgoing): void {
    if (
      !("id" in message) ||
      typeof message.id !== "string" ||
      !message.id.startsWith("threadlight:automation:")
    ) {
      return;
    }
    const waiter = this.host.automationRpcWaiters.get(message.id);
    if (!waiter) return;
    this.host.automationRpcWaiters.delete(message.id);
    clearTimeout(waiter.timer);
    if ("error" in message && message.error) {
      waiter.reject(new Error(message.error.message));
    } else {
      waiter.resolve(message.result);
    }
  }
}
