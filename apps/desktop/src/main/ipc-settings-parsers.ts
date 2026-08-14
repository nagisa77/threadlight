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
  isHostLanguage,
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

export function parseComputerPermission(
  value: unknown,
): DesktopComputerPermissionCapability {
  if (value !== "screen_recording" && value !== "accessibility") {
    throw new Error("Invalid computer permission");
  }
  return value;
}

export function parseRemoteRuntimeConnectRequest(
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

export function parseHostUpdateRequest(
  value: unknown,
): DesktopHostUpdateRequest {
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

export function normalizeRemoteRuntimeEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote Runtime endpoint must use http or https.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function parseSettingsUpdate(value: unknown): DesktopSettingsUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings update");
  }
  const update = value as Record<string, unknown>;
  if (!isModelProvider(update.provider)) {
    throw new Error(
      "provider must be openai, deepseek, qwen, kimi, doubao, gemini, grok, or custom",
    );
  }
  if (!isSearchProvider(update.searchProvider)) {
    throw new Error("searchProvider must be brave or linkup");
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
  if (!isOptionalSecret(update.linkupApiKey)) {
    throw new Error("linkupApiKey must be a string or null");
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
    searchProvider: update.searchProvider,
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
    ...(update.linkupApiKey !== undefined
      ? { linkupApiKey: update.linkupApiKey }
      : {}),
  } as DesktopSettingsUpdate;
}

export function parseProviderTestRequest(
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

export function isLanguage(
  value: unknown,
): value is NonNullable<DesktopSettingsUpdate["language"]> {
  return isHostLanguage(value);
}

export function isTheme(
  value: unknown,
): value is NonNullable<DesktopSettingsUpdate["theme"]> {
  return value === "system" || value === "light" || value === "dark";
}

export function isProjectOpener(value: unknown): value is DesktopProjectOpener {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 255
  );
}

export function isProjectOpenerPreference(
  value: unknown,
): value is DesktopProjectOpener {
  return typeof value === "string" && value.length <= 255;
}

export function isModelProvider(
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

export function isSearchProvider(
  value: unknown,
): value is DesktopSettingsUpdate["searchProvider"] {
  return value === "brave" || value === "linkup";
}

export function isOptionalSecret(
  value: unknown,
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

export function parseConversationUpdate(
  value: unknown,
): DesktopConversationUpdate {
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

export function parseConversationMetadataUpdate(
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
    ...(typeof update.pinned === "boolean" ? { pinned: update.pinned } : {}),
    ...(typeof update.archived === "boolean"
      ? { archived: update.archived }
      : {}),
    ...(update.accessMode === "approval" || update.accessMode === "full"
      ? { accessMode: update.accessMode }
      : {}),
  };
}

export function parseProjectMetadataUpdate(
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

export function parseProjectOpenWithRequest(
  value: unknown,
): DesktopProjectOpenWithRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid project opener request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    !request.projectId ||
    (request.threadId !== undefined && typeof request.threadId !== "string") ||
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

export function parseConversationTarget(
  value: unknown,
): DesktopConversationTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid conversation target");
  }
  const target = value as Record<string, unknown>;
  if (typeof target.projectId !== "string" || typeof target.id !== "string") {
    throw new Error("Invalid conversation target");
  }
  return { projectId: target.projectId, id: target.id };
}

export function parseConversationRecoveryRequest(
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

export function parseDiagnosticExportRequest(value: unknown): {
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

export function parseConversationChangesRequest(
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
