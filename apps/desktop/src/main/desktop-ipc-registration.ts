import { clipboard, ipcMain, shell, type IpcMainInvokeEvent } from "electron";

import * as desktopApi from "../shared/desktop-api.js";
import * as previewApi from "../shared/computer-preview-api.js";
import type { DesktopIpcController } from "./ipc-controller.js";
import type { DesktopProjectController } from "./project-controller.js";
import type { DesktopRuntimeController } from "./runtime-controller.js";
import type { DesktopSecurity } from "./desktop-security.js";
import type { DesktopWorkspaceController } from "./workspace-controller.js";

type InvokeHandler = (event: IpcMainInvokeEvent, value: unknown) => unknown;

export interface DesktopIpcControllers {
  readonly ipc: DesktopIpcController;
  readonly project: DesktopProjectController;
  readonly workspace: DesktopWorkspaceController;
  readonly runtime: DesktopRuntimeController;
  readonly security: DesktopSecurity;
}

/** Maps transport channels to domain controllers; controllers remain IPC-agnostic. */
export function registerDesktopIpc({
  ipc,
  project,
  workspace,
  runtime,
  security,
}: DesktopIpcControllers): void {
  ipcMain.on(desktopApi.DESKTOP_REQUEST_CHANNEL, (event, value) => {
    void ipc.handleRequest(event, value);
  });

  const projectHandlers: readonly (readonly [string, InvokeHandler])[] = [
    [
      desktopApi.DESKTOP_SETTINGS_GET_CHANNEL,
      project.handleSettingsGet.bind(project),
    ],
    [
      desktopApi.DESKTOP_SETTINGS_UPDATE_CHANNEL,
      project.handleSettingsUpdate.bind(project),
    ],
    [
      desktopApi.DESKTOP_DIAGNOSTICS_GET_CHANNEL,
      project.handleDiagnosticsGet.bind(project),
    ],
    [
      desktopApi.DESKTOP_DIAGNOSTICS_EXPORT_CHANNEL,
      project.handleDiagnosticsExport.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROVIDER_TEST_CHANNEL,
      project.handleProviderTest.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECTS_GET_CHANNEL,
      project.handleProjectsGet.bind(project),
    ],
    [
      desktopApi.DESKTOP_HOSTS_GET_CHANNEL,
      project.handleHostsGet.bind(project),
    ],
    [
      desktopApi.DESKTOP_HOST_ACTIVATE_CHANNEL,
      project.handleHostActivate.bind(project),
    ],
    [
      desktopApi.DESKTOP_HOST_UPDATE_CHANNEL,
      project.handleHostUpdate.bind(project),
    ],
    [
      desktopApi.DESKTOP_HOST_DELETE_CHANNEL,
      project.handleHostDelete.bind(project),
    ],
    [
      desktopApi.DESKTOP_HOST_DIRECTORIES_CHANNEL,
      project.handleHostDirectories.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECT_OPEN_CHANNEL,
      project.handleProjectOpen.bind(project),
    ],
    [
      desktopApi.DESKTOP_STANDALONE_CREATE_CHANNEL,
      project.handleStandaloneCreate.bind(project),
    ],
    [
      desktopApi.DESKTOP_REMOTE_RUNTIME_CONNECT_CHANNEL,
      project.handleRemoteRuntimeConnect.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECT_ACTIVATE_CHANNEL,
      project.handleProjectActivate.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECT_UPDATE_CHANNEL,
      project.handleProjectUpdate.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECT_DELETE_CHANNEL,
      project.handleProjectDelete.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECT_OPENERS_GET_CHANNEL,
      project.handleProjectOpenersGet.bind(project),
    ],
    [
      desktopApi.DESKTOP_PROJECT_OPEN_WITH_CHANNEL,
      project.handleProjectOpenWith.bind(project),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_UPSERT_CHANNEL,
      project.handleConversationUpsert.bind(project),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_UPDATE_CHANNEL,
      project.handleConversationUpdate.bind(project),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_READ_CHANNEL,
      project.handleConversationRead.bind(project),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_RECOVER_CHANNEL,
      project.handleConversationRecover.bind(project),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_DELETE_CHANNEL,
      project.handleConversationDelete.bind(project),
    ],
    [
      desktopApi.DESKTOP_AUTOMATIONS_GET_CHANNEL,
      project.handleAutomationsGet.bind(project),
    ],
    [
      desktopApi.DESKTOP_AUTOMATIONS_CREATE_CHANNEL,
      project.handleAutomationCreate.bind(project),
    ],
    [
      desktopApi.DESKTOP_AUTOMATIONS_UPDATE_CHANNEL,
      project.handleAutomationUpdate.bind(project),
    ],
    [
      desktopApi.DESKTOP_AUTOMATIONS_DELETE_CHANNEL,
      project.handleAutomationDelete.bind(project),
    ],
    [
      desktopApi.DESKTOP_AUTOMATIONS_RUN_CHANNEL,
      project.handleAutomationRun.bind(project),
    ],
  ];

  const workspaceHandlers: readonly (readonly [string, InvokeHandler])[] = [
    [
      desktopApi.DESKTOP_PROJECT_MEMORY_GET_CHANNEL,
      workspace.handleProjectMemoryGet.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_PROJECT_MEMORY_OPEN_CHANNEL,
      workspace.handleProjectMemoryOpen.bind(workspace),
    ],
    [desktopApi.DESKTOP_SEARCH_CHANNEL, workspace.handleSearch.bind(workspace)],
    [
      desktopApi.DESKTOP_AUDIO_TRANSCRIBE_CHANNEL,
      workspace.handleAudioTranscription.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_ATTACHMENT_REFERENCE_CHANNEL,
      workspace.handleAttachmentReference.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_COMPUTER_SHARE_GET_CHANNEL,
      workspace.handleComputerShareGet.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_COMPUTER_SHARE_SHOW_CHANNEL,
      workspace.handleComputerShareShow.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_COMPUTER_SHARE_STOP_CHANNEL,
      workspace.handleComputerShareStop.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_COMPUTER_PERMISSION_GET_CHANNEL,
      workspace.handleComputerPermissionGet.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_COMPUTER_PERMISSION_REQUEST_CHANNEL,
      workspace.handleComputerPermissionRequest.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_COMPUTER_PERMISSION_RELAUNCH_CHANNEL,
      workspace.handleComputerPermissionRelaunch.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_CHANGES_GET_CHANNEL,
      workspace.handleConversationChangesGet.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_CONVERSATION_CHANGES_RESTORE_CHANNEL,
      workspace.handleConversationChangesRestore.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKTREE_DELIVERY_PREFLIGHT_CHANNEL,
      workspace.handleWorktreeDeliveryPreflight.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKTREE_DELIVERY_HISTORY_CHANNEL,
      workspace.handleWorktreeDeliveryHistory.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKTREE_DELIVERY_APPLY_CHANNEL,
      workspace.handleWorktreeDeliveryApply.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKTREE_DELIVERY_UNDO_CHANNEL,
      workspace.handleWorktreeDeliveryUndo.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKTREE_DELIVERY_COMMIT_CHANNEL,
      workspace.handleWorktreeDeliveryCommit.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_CODE_HOST_DELIVERY_STATUS_CHANNEL,
      workspace.handleCodeHostDeliveryStatus.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_CODE_HOST_DELIVERY_COMMIT_PUSH_CHANNEL,
      workspace.handleCodeHostDeliveryCommitPush.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_CODE_HOST_DELIVERY_CREATE_PR_CHANNEL,
      workspace.handleCodeHostDeliveryCreatePr.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKSPACE_LIST_CHANNEL,
      workspace.handleWorkspaceList.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKSPACE_FILE_GET_CHANNEL,
      workspace.handleWorkspaceFileGet.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKSPACE_FILE_DOWNLOAD_CHANNEL,
      workspace.handleWorkspaceFileDownload.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_WORKSPACE_FILE_REVEAL_CHANNEL,
      workspace.handleWorkspaceFileReveal.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_SYSTEM_FILE_CHOOSE_CHANNEL,
      workspace.handleSystemFileChoose.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_SYSTEM_FILE_LIST_CHANNEL,
      workspace.handleSystemFileList.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_SYSTEM_FILE_GET_CHANNEL,
      workspace.handleSystemFileGet.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_SYSTEM_FILE_DOWNLOAD_CHANNEL,
      workspace.handleSystemFileDownload.bind(workspace),
    ],
    [
      desktopApi.DESKTOP_SYSTEM_FILE_REVEAL_CHANNEL,
      workspace.handleSystemFileReveal.bind(workspace),
    ],
  ];

  const ipcHandlers: readonly (readonly [string, InvokeHandler])[] = [
    [
      desktopApi.DESKTOP_EXECUTION_APPROVAL_RESPOND_CHANNEL,
      ipc.handleExecutionApprovalRespond.bind(ipc),
    ],
    [
      desktopApi.DESKTOP_EXECUTION_POLICY_GET_CHANNEL,
      ipc.handleExecutionPolicyGet.bind(ipc),
    ],
    [
      desktopApi.DESKTOP_EXECUTION_POLICY_REVOKE_CHANNEL,
      ipc.handleExecutionPolicyRevoke.bind(ipc),
    ],
  ];

  for (const [channel, handler] of [
    ...projectHandlers,
    ...workspaceHandlers,
    ...ipcHandlers,
  ]) {
    ipcMain.handle(channel, handler);
  }

  ipcMain.handle(
    desktopApi.DESKTOP_CLIPBOARD_WRITE_CHANNEL,
    (_event, value) => {
      if (typeof value !== "string") {
        throw new TypeError("Clipboard text must be a string");
      }
      clipboard.writeText(value);
    },
  );
  ipcMain.handle(
    desktopApi.DESKTOP_EXTERNAL_OPEN_CHANNEL,
    async (event, value) => {
      security.requireTrustedSender(event);
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

  ipcMain.handle(
    desktopApi.DESKTOP_TERMINAL_CREATE_CHANNEL,
    runtime.handleTerminalCreate.bind(runtime),
  );
  ipcMain.on(
    desktopApi.DESKTOP_TERMINAL_WRITE_CHANNEL,
    runtime.handleTerminalWrite.bind(runtime),
  );
  ipcMain.on(
    desktopApi.DESKTOP_TERMINAL_RESIZE_CHANNEL,
    runtime.handleTerminalResize.bind(runtime),
  );
  ipcMain.handle(
    desktopApi.DESKTOP_TERMINAL_CLOSE_CHANNEL,
    runtime.handleTerminalClose.bind(runtime),
  );
  ipcMain.on(
    previewApi.DESKTOP_COMPUTER_PREVIEW_CLOSE_CHANNEL,
    runtime.handleComputerPreviewClose.bind(runtime),
  );
  ipcMain.on(
    previewApi.DESKTOP_COMPUTER_PREVIEW_RESIZE_CHANNEL,
    runtime.handleComputerPreviewResize.bind(runtime),
  );
  ipcMain.on(
    previewApi.DESKTOP_COMPUTER_PREVIEW_DRAG_CHANNEL,
    runtime.handleComputerPreviewDrag.bind(runtime),
  );
}
