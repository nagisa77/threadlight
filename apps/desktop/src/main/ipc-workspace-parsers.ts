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

import { parseConversationChangesRequest } from "./ipc-settings-parsers.js";

export function parseConversationChangesRestoreRequest(
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

export function parseWorktreeDeliveryRequest(
  value: unknown,
): DesktopWorktreeDeliveryRequest {
  const request = parseConversationChangesRequest(value);
  const delivery = value as Record<string, unknown>;
  if (typeof delivery.revision !== "string" || !delivery.revision) {
    throw new Error("Invalid worktree delivery request");
  }
  return { ...request, revision: delivery.revision };
}

export function parseWorktreeDeliveryCommitRequest(
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

export function parseCodeHostCommitPushRequest(
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

export function parseCodeHostCreatePullRequest(
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

export function parseWorkspaceListRequest(
  value: unknown,
): DesktopWorkspaceListRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace list request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    (request.threadId !== undefined && typeof request.threadId !== "string") ||
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

export function parseWorkspaceFileRequest(
  value: unknown,
): DesktopWorkspaceFileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid workspace file request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    (request.threadId !== undefined && typeof request.threadId !== "string") ||
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

export function parseSystemFileRequest(
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

export function parseSearchRequest(value: unknown): DesktopSearchRequest {
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

export function parseAutomationRequest(
  value: unknown,
): DesktopAutomationCreateRequest;
export function parseAutomationRequest(
  value: unknown,
  update: true,
): DesktopAutomationUpdateRequest;
export function parseAutomationRequest(
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
  return update ? { ...parsed, id: request.id as string } : parsed;
}

export function parseAutomationTarget(value: unknown): DesktopAutomationTarget {
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

export function parseAttachmentReferenceRequest(
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

export function parseTerminalCreateRequest(
  value: unknown,
): DesktopTerminalCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid terminal create request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    (request.threadId !== undefined && typeof request.threadId !== "string") ||
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

export function parseTerminalWriteRequest(
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

export function parseTerminalResizeRequest(
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
