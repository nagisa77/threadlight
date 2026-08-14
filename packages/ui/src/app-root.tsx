import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type {
  AgentPlanData,
  AttachmentData,
  ConversationAccessMode,
  HostDirectoryEntry,
  HostDirectoryListing,
  TaskDevelopmentMode,
} from "@threadlight/protocol";
import {
  Activity,
  ArrowUp,
  Archive,
  ArchiveRestore,
  ChevronRight,
  CircleStop,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  FileDiff,
  FileText,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  Monitor,
  NotebookText,
  Paperclip,
  PanelLeftOpen,
  PencilLine,
  Pin,
  PinOff,
  PictureInPicture2,
  Plus,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  CapabilityChips,
  CapabilityMenu,
  MessageCapabilityReceipts,
  ConnectorSetupDialog,
  nextCapabilityIndex,
} from "./capabilities.js";
import {
  newTaskDraftState,
  useThreadlightSession,
  type ConversationProgress,
  type ToolActivity,
} from "./features/task-session/session.js";
import { MarkdownContent } from "./markdown.js";
import { ProjectMemoryPage, type ProjectMemoryAdapter } from "./memory.js";
import {
  CommandPalette,
  type CommandPaletteEntry,
  type SearchAdapter,
} from "./command-palette.js";
import { isNearBottom } from "./scroll.js";
import {
  isCommandPaletteShortcut,
  isFileSearchShortcut,
} from "./keyboard-shortcuts.js";
import type { SettingsAdapter, SettingsSnapshot } from "./settings.js";
import {
  ConversationAccessControl,
  ExecutionApprovalGate,
  ExecutionPolicyPage,
  type ExecutionPolicyAdapter,
} from "./execution-policy.js";
import { DiagnosticsPage, type DiagnosticsAdapter } from "./diagnostics.js";
import type { AutomationAdapter } from "./automations.js";
import { useI18n, type Translate } from "./i18n.js";
import type { TerminalAdapter } from "./terminal.js";
import { scopeFor, terminalWorkspaceContextLabel } from "./terminal-context.js";
import {
  activeProject,
  prepareFirstRunDemoProject,
  type ConversationSummary,
  type HostSummary,
  type HostsSnapshot,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "./projects.js";
import {
  DeliveryTurnStatus,
  shouldShowDeliveryTurnStatus,
} from "./features/delivery/delivery-turn-status.js";
import {
  type ProjectOpenerAdapter,
  type ProjectOpenerId,
  type ProjectOpenerOption,
} from "./project-opener.js";
import {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "./popover.js";
import { ModelSelector } from "./features/composer/model-selector.js";
import { DevelopmentModeControl } from "./features/composer/development-mode.js";
import { VoiceInputButton } from "./features/composer/voice-input-button.js";
import {
  ComposerQueue,
  GuidedMessageReceipt,
} from "./features/composer/composer-queue.js";
import {
  ComputerPermissionCard,
  ComputerShareStatus,
  ComposerFloatingControls,
  MessageActions,
  writeClipboardText,
} from "./features/task-session/turn-status.js";
import {
  filterProjectsForTaskList,
  ownsActiveComputerShare,
} from "./features/navigation/project-sidebar.js";
import { NavigationSidebar } from "./features/navigation/navigation-sidebar.js";
import {
  ActivityList,
  AgentTreePanel,
  ComposerAttachments,
  ConnectionError,
  MissingThreadRecovery,
  MessageAttachments,
  ProgressList,
  attachmentHint,
  composerSubmitDelivery,
  connectionLabel,
  errorMessage,
  hasUserInput,
  shortId,
} from "./features/task-session/conversation-content.js";
import { ConversationTimeline as Timeline } from "./features/task-session/conversation-timeline.js";
export {
  ComputerPermissionCard,
  ComputerShareStatus,
  ConversationChangesButton,
  MessageActions,
  TurnStatusPill,
  currentPlanStep,
  pendingComputerPermissionResume,
  writeClipboardText,
} from "./features/task-session/turn-status.js";
export {
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
  clampWorkspacePanelWidth,
  conversationChangesRefreshKey,
  planDocumentOpenRequest,
} from "./features/delivery/controller.js";
export {
  ProjectActionPopover,
  ProjectConversationItem,
  ProjectGroup,
  ProjectListHeading,
  RecentTasksGroup,
  RuntimeStatusControl,
  TaskSearchDialog,
  conversationContextChanged,
  filterProjectsForTaskList,
  ownsActiveComputerShare,
  showsProjectLevelActivity,
  type TaskListFilter,
} from "./features/navigation/project-sidebar.js";
export {
  ActivityList,
  MessageAttachments,
  ProgressList,
  composerSubmitDelivery,
  hasUserInput,
  projectContainingThread,
} from "./features/task-session/conversation-content.js";
import {
  DeleteConversationDialog,
  DeleteProjectDialog,
  EmptyState,
  ProjectEmptyState,
  ProjectPickerPopover,
  RemoteProjectPathDialog,
  RemoteRuntimeDialog,
} from "./features/navigation/project-dialogs.js";
import {
  activateComposerMenuOnPointerDown,
  scheduleComposerErrorDismissal,
  preserveComposerFocusOnPointerDown,
  shouldIgnoreComposerKey,
  useComposerController,
} from "./features/composer/controller.js";
import { useAttachmentController } from "./features/composer/attachment-controller.js";
import { useCapabilityController } from "./features/composer/capability-controller.js";
import { useVoiceInputController } from "./features/composer/voice-input-controller.js";
import {
  completeFirstRun,
  useNavigationController,
} from "./features/navigation/controller.js";
import { useNavigationRuntime } from "./features/navigation/runtime-controller.js";
import {
  useProjectSessionActions,
  useTaskSessionController,
} from "./features/task-session/controller.js";
import { useComputerController } from "./features/task-session/computer-controller.js";
import { useInitialViewReady } from "./features/task-session/initial-view.js";
import { useTaskSessionRuntime } from "./features/task-session/runtime-controller.js";
import { useDeliveryRuntime } from "./features/delivery/runtime-controller.js";
import {
  browserStorage,
  usePersistedComposerDraft,
  useTaskProductivity,
} from "./features/productivity/controller.js";
import {
  composerDraftScope,
  navigateComposerHistory,
} from "./features/productivity/model.js";
import { MessageBookmarksDialog } from "./features/productivity/task-actions.js";
import { ComposerProductivityStatus } from "./features/productivity/composer-status.js";
import type {
  AttachmentPreviewAdapter,
  AttachmentStageAdapter,
  ClipboardAdapter,
  ConnectorAuthorizationAdapter,
} from "./features/composer/types.js";
import {
  ThreadlightAppShell,
  type AppShellState,
  type ThreadlightAppProps,
} from "./features/app-shell/app-shell.js";
import {
  DeferredTerminalPanel,
  DeferredView,
  DeferredWorkspacePanel,
  LazyAutomationsPage,
  LazyFirstRunGuide,
  LazySettingsPage,
  LazyTerminalPanel,
  LazyWorkspacePanel,
} from "./features/app-shell/deferred.js";
import { TaskHeader } from "./features/productivity/task-header.js";
import { WorkspaceActions } from "./features/app-shell/workspace-actions.js";
import {
  composerProviderIsReady,
  projectSupportsDevelopmentMode,
} from "./features/app-shell/readiness.js";
export { composerProviderIsReady, projectSupportsDevelopmentMode };
export type { ThreadlightAppProps } from "./features/app-shell/app-shell.js";
export {
  activateComposerMenuOnPointerDown,
  createSubmissionGate,
  preserveComposerFocusOnPointerDown,
  shouldIgnoreComposerKey,
} from "./features/composer/controller.js";
export { restoredThreadRoute } from "./features/navigation/startup.js";
export type {
  PendingAttachment,
  VoiceInputStatus,
} from "./features/composer/controller.js";
export {
  firstRunIsComplete,
  sidebarStartsOpen,
} from "./features/navigation/controller.js";
export type {
  AttachmentPreviewAdapter,
  AttachmentStageAdapter,
  ClipboardAdapter,
  ConnectorAuthorizationAdapter,
} from "./features/composer/types.js";
export type {
  ComputerPermissionAdapter,
  ComputerPermissionCapability,
  ComputerPermissionSnapshot,
  ComputerShareAdapter,
  ComputerShareSnapshot,
  ComputerShareTarget,
} from "./features/task-session/computer-types.js";
export {
  DeleteConversationDialog,
  EmptyState,
  NewTaskProjectPrompt,
  ProjectPickerPopover,
  RemoteRuntimeDialog,
  filterProjectsForPicker,
} from "./features/navigation/project-dialogs.js";

const MAX_COMPOSER_ATTACHMENTS = 10;
/** Composes the domain controllers with the application surfaces. */
export function ThreadlightApp(props: ThreadlightAppProps) {
  return (
    <ThreadlightAppShell app={props}>
      {(shell) => <ThreadlightAppContent {...props} {...shell} />}
    </ThreadlightAppShell>
  );
}

function ThreadlightAppContent({
  client,
  taskLinksEnabled = false,
  clipboard,
  settings,
  diagnostics,
  automations,
  projects,
  memory,
  search,
  voiceInput,
  connectorAuthorization,
  attachmentStage,
  attachmentPreview,
  computerShare,
  computerPermissions,
  terminal,
  workspace,
  projectOpener,
  executionPolicy,
  initialThreadId,
  initialSettings,
  initialProjects,
  onInitialViewReady,
  onThreadChange,
  onLanguageChange,
  onThemeChange,
  preferredProjectOpener,
  onPreferredProjectOpenerChange,
}: ThreadlightAppProps & AppShellState) {
  const { language, t } = useI18n();
  const navigation = useNavigationController({
    projects: initialProjects,
    settings: initialSettings,
  });
  const {
    mobileSidebar,
    setMobileSidebar,
    sidebarOpen,
    setSidebarOpen,
    sidebarCloseButton,
    sidebarOpenButton,
    view,
    setView,
    projectSnapshot,
    setProjectSnapshot,
    runtimeSettings,
    setRuntimeSettings,
    firstRunCompleted,
    setFirstRunCompleted,
    firstRunDemoThreadId,
    setFirstRunDemoThreadId,
    firstRunRetryDemo,
    setFirstRunRetryDemo,
    observedInitialProjects,
    hostSnapshot,
    setHostSnapshot,
    projectError,
    setProjectError,
    switchingProject,
    setSwitchingProject,
    remoteRuntimeOpen,
    setRemoteRuntimeOpen,
    remoteProjectPathOpen,
    setRemoteProjectPathOpen,
    remoteRuntimeBusy,
    setRemoteRuntimeBusy,
    remoteRuntimeError,
    setRemoteRuntimeError,
    commandPaletteOpen,
    setCommandPaletteOpen,
    commandPaletteMode,
    setCommandPaletteMode,
    pendingSearchJump,
    setPendingSearchJump,
    pendingDelete,
    setPendingDelete,
    deleteError,
    setDeleteError,
    deletingConversation,
    setDeletingConversation,
    pendingDeleteProject,
    setPendingDeleteProject,
    deleteProjectError,
    setDeleteProjectError,
    deletingProject,
    setDeletingProject,
    projectOpeners,
    setProjectOpeners,
    commandPaletteTrigger,
    projectSnapshotRef,
    activeThreadIdRef,
    viewRef,
  } = navigation;
  const {
    state: activeState,
    retry,
    openThread,
    deleteThread,
    send,
    sendNewThread,
    setThreadModel,
    addFollowUp,
    injectQueuedTurn,
    reorderQueuedTurn,
    cancelQueuedTurn,
    clearSubmissionError,
    interrupt,
    terminateProcess,
    runningThreadIds,
  } = useThreadlightSession(client, {
    autoConnect: !projects,
    runningThreadIds: projectSnapshot?.runningThreadIds,
  });
  const {
    newTaskDraft,
    setNewTaskDraft,
    newTaskDraftError,
    setNewTaskDraftError,
    developmentMode,
    setDevelopmentMode,
    draftAccessMode,
    setDraftAccessMode,
    draftModel,
    setDraftModel,
    conversationRecoveryBusy,
    setConversationRecoveryBusy,
    conversationRecoveryError,
    setConversationRecoveryError,
    suggestedQuestions,
    setSuggestedQuestions,
    suggestionRetry,
    setSuggestionRetry,
    conversation,
    followOutput,
  } = useTaskSessionController();
  const { beginDraft, connectProject } = useProjectSessionActions({
    projects,
    openThread,
    setProjectSnapshot,
    setDevelopmentMode,
    setDraftAccessMode,
    setDraftModel,
    setNewTaskDraftError,
    setNewTaskDraft,
  });
  const state = newTaskDraft
    ? newTaskDraftState(activeState, newTaskDraftError)
    : activeState;
  const currentProject = activeProject(projectSnapshot);
  const currentConversation = currentProject?.conversations.find(
    (conversation) => conversation.id === state.threadId,
  );
  const {
    input,
    setInput,
    submitting,
    setSubmitting,
    submissionGate,
    inputValueRef,
    composerMode,
    setComposerMode,
    composerRoot,
    textarea,
    composing,
    historyIndex,
    historyDraft,
  } = useComposerController();
  const {
    attachments: pendingAttachments,
    attachmentsRef: pendingAttachmentsRef,
    preparing: preparingAttachments,
    error: attachmentError,
    setError: setAttachmentError,
    dragging: isDraggingFiles,
    fileInput,
    add: addAttachments,
    stage: stageAttachments,
    clear: clearAttachments,
    remove: removeAttachment,
    openPicker: openAttachmentPicker,
    onPaste: handlePaste,
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  } = useAttachmentController({
    adapter: attachmentStage,
    enabled: view === "thread",
    limit: MAX_COMPOSER_ATTACHMENTS,
    t,
  });
  const {
    capabilities,
    selected: selectedCapabilities,
    setSelected: setSelectedCapabilities,
    query: capabilityQuery,
    setQuery: setCapabilityQuery,
    activeIndex: activeCapabilityIndex,
    setActiveIndex: setActiveCapabilityIndex,
    addMenuOpen,
    setAddMenuOpen,
    loading: capabilitiesLoading,
    connectorSetup,
    connectorBusy,
    connectorError,
    filtered: filteredCapabilities,
    addActions,
    itemCount: composerMenuItemCount,
    toggleAddMenu: toggleComposerAddMenu,
    updateQuery: updateCapabilityQuery,
    selectAddAction,
    selectCapability,
    selectMenuItem: selectComposerMenuItem,
    manageConnector,
    connectConnector,
    disconnectConnector,
    closeConnectorSetup,
  } = useCapabilityController({
    client,
    threadId: state.threadId,
    connection: state.connection,
    running: state.isRunning,
    input,
    setInput,
    textarea,
    composerRoot,
    setComposerMode,
    attachmentAvailable: Boolean(
      attachmentStage && pendingAttachments.length < MAX_COMPOSER_ATTACHMENTS,
    ),
    openAttachmentPicker,
    connectorAuthorization,
    t,
  });
  const {
    status: voiceStatus,
    error: voiceError,
    setError: setVoiceError,
    start: startVoiceInput,
    stop: stopVoiceInput,
    cancel: cancelVoiceInput,
  } = useVoiceInputController({ adapter: voiceInput, setInput, textarea, t });
  const {
    shareSnapshot: computerShareSnapshot,
    shareError: computerShareError,
    permissionSnapshot: computerPermissionSnapshot,
    permissionBusy: computerPermissionBusy,
    permissionError: computerPermissionError,
    showingShare: showingComputerShare,
    stoppingShare: stoppingComputerShare,
    requestPermission: requestComputerPermission,
    refreshPermissions: refreshComputerPermissions,
    relaunchForPermissions: relaunchForComputerPermissions,
    stopShare: stopComputerShare,
    showSharePreview: showComputerSharePreview,
  } = useComputerController({
    share: computerShare,
    permissions: computerPermissions,
    threadId: state.threadId,
    connection: state.connection,
    running: state.isRunning,
    send,
    t,
  });
  const {
    terminalOpen,
    setTerminalOpen,
    workspacePanelOpen,
    setWorkspacePanelOpen,
    workspacePanelMounted,
    workspacePanelWidth,
    setWorkspacePanelWidth,
    workspaceReviewRequest,
    workspaceDeliveryRequest,
    workspaceFileOpenRequest,
    setWorkspaceFileOpenRequest,
    conversationChanges,
    conversationChangesLoading,
    conversationChangesError,
    workspaceRoot,
    workspaceAgentPanel,
    automaticDelivery,
    currentWorkspacePath,
    hasConversationChanges,
    refreshChanges: refreshConversationChanges,
    restoreChanges: restoreConversationChanges,
    retryAutomaticDelivery,
    undoAutomaticDelivery,
    openReviewPanel,
    openDeliveryCenter,
    openLocalFile,
    revealLocalFile,
    beginResize: beginWorkspacePanelResize,
    resizeBy: resizeWorkspacePanelBy,
  } = useDeliveryRuntime({
    client,
    projects,
    workspace,
    project: currentProject,
    conversation: currentConversation,
    session: state,
    setProjectSnapshot,
    t,
  });
  const navigationRuntime = useNavigationRuntime({
    client,
    navigation,
    projects,
    settings,
    search,
    automations,
    workspace,
    projectOpener,
    initialThreadId,
    initialProjects,
    initialSettingsProvided: Boolean(initialSettings),
    activeThread: {
      threadId: activeState.threadId,
      recovery: activeState.recovery,
      hasUserInput: hasUserInput(activeState.messages),
    },
    displayedThreadId: state.threadId,
    newTaskDraft,
    voiceStatus,
    textarea,
    beginDraft,
    selectExistingTask: () => {
      setNewTaskDraftError(undefined);
      setNewTaskDraft(false);
    },
    connectProject,
    cancelVoiceInput,
    closeConversationPanels,
    openReviewPanel,
    stopComputerShare,
    deleteThread,
    retryRuntime: retry,
    setWorkspacePanelOpen,
    setTerminalOpen,
    setWorkspaceFileOpenRequest,
    onThreadChange,
    onLanguageChange,
    onThemeChange,
    onPreferredProjectOpenerChange,
    t,
  });
  const {
    initialRestoreComplete,
    currentHost,
    showSidebar,
    hideSidebar,
    closeSidebarForNavigation,
    createThread,
    createProjectThread,
    createStandaloneThread,
    openProjectView,
    toggleProjectPinned,
    revealProjectInFinder,
    openCommandPalette,
    closeCommandPalette,
    selectCommandPaletteEntry,
    openProjectFolder,
    connectRemoteRuntime,
    activateHost,
    updateRemoteHost,
    deleteRemoteHost,
    updateConversationMetadata,
    selectConversation,
    confirmDeleteConversation: deleteConversationFromNavigation,
    confirmDeleteProject: deleteProjectFromNavigation,
    reconnectRuntime,
  } = navigationRuntime;
  const productivityStorage = browserStorage();
  const draftStatus = usePersistedComposerDraft({
    scope: composerDraftScope(currentProject?.id, state.threadId, newTaskDraft),
    value: input,
    setValue: setInput,
    valueRef: inputValueRef,
    storage: productivityStorage,
  });
  useInitialViewReady({
    onReady: onInitialViewReady,
    restoreComplete: initialRestoreComplete,
    hasCurrentProject: Boolean(currentProject),
    connection: state.connection,
    messagesLength: state.messages.length,
    conversation,
    followOutput,
  });
  const currentDevelopmentMode: TaskDevelopmentMode = newTaskDraft
    ? developmentMode
    : currentConversation?.workspace?.mode === "worktree"
      ? "worktree"
      : "local";
  const showDevelopmentMode = Boolean(
    projects && projectSupportsDevelopmentMode(currentProject),
  );
  const developmentModeEditable = Boolean(
    showDevelopmentMode && newTaskDraft && !state.threadId,
  );
  const selectedAccessMode = newTaskDraft
    ? draftAccessMode
    : (currentConversation?.accessMode ?? "approval");
  const selectedProvider = newTaskDraft
    ? (draftModel?.provider ?? state.provider)
    : state.provider;
  const selectedModel = newTaskDraft
    ? (draftModel?.model ?? state.model)
    : state.model;
  // Prefer the persisted sidebar title, then the first user message.
  const headerTitle =
    currentConversation?.title && currentConversation.title !== t("task")
      ? currentConversation.title
      : state.messages[0]?.text || t("task");
  const isEmpty = state.messages.length === 0 && state.connection !== "error";
  const taskProductivity = useTaskProductivity({
    threadId: state.threadId,
    title: headerTitle,
    projectName: currentProject?.name,
    messages: state.messages,
    storage: productivityStorage,
    currentHref:
      typeof window === "undefined" ? undefined : window.location.href,
    writeClipboard: (value) => writeClipboardText(value, clipboard?.writeText),
  });
  const taskSessionRuntime = useTaskSessionRuntime({
    client,
    projects,
    project: currentProject,
    conversationSummary: currentConversation,
    session: state,
    newTaskDraft,
    language,
    suggestedQuestions,
    setSuggestedQuestions,
    suggestionRetry,
    setSuggestionRetry,
    recoveryBusy: conversationRecoveryBusy,
    setRecoveryBusy: setConversationRecoveryBusy,
    setRecoveryError: setConversationRecoveryError,
    conversation,
    followOutput,
    textarea,
    pendingSearchJump,
    setPendingSearchJump,
    setProjectSnapshot,
    setProjectError,
    setNewTaskDraft,
    openThread,
    closeBookmarks: () => taskProductivity.setBookmarksOpen(false),
    t,
  });
  const {
    suggestionKey,
    suggestions,
    suggestionsLoading,
    suggestionsFailed,
    retrySuggestions,
    showJumpToLatest,
    setShowJumpToLatest,
    jumpToMessage,
    jumpToLatest,
    repairMissingThread,
    relinkMissingThread,
    updateAccessMode: updateConversationAccessMode,
  } = taskSessionRuntime;
  const taskTerminalBranch =
    currentConversation?.workspace?.mode === "worktree"
      ? currentConversation.workspace.branch
      : undefined;
  const originalTerminalBranch =
    automaticDelivery?.result?.targetBranch ??
    automaticDelivery?.preflight?.targetBranch ??
    (currentConversation?.workspace?.mode === "worktree"
      ? currentConversation.workspace.sourceBranch
      : undefined);
  const terminalScope = scopeFor({
    projectScope: currentProject?.scope,
    threadId: state.threadId,
    workspaceMode: currentConversation?.workspace?.mode,
  });
  const defaultTerminalContext = terminalWorkspaceContextLabel(
    terminalScope,
    terminalScope === "task" ? taskTerminalBranch : originalTerminalBranch,
    t,
  );
  const providerReady = composerProviderIsReady(
    Boolean(settings),
    runtimeSettings,
  );
  const firstRunReady = Boolean(
    settings && projects && runtimeSettings && projectSnapshot,
  );
  const firstRunRequired = firstRunReady && !firstRunCompleted;
  const showFirstRunGuide = Boolean(
    firstRunRequired && !firstRunDemoThreadId && view === "thread",
  );
  useEffect(() => {
    if (!firstRunDemoThreadId) return;
    const completed = client.on("turn/completed", ({ threadId }) => {
      if (threadId !== firstRunDemoThreadId) return;
      completeFirstRun(setFirstRunCompleted);
      setFirstRunDemoThreadId(undefined);
      setFirstRunRetryDemo(false);
    });
    const failed = client.on("turn/failed", ({ threadId }) => {
      if (threadId !== firstRunDemoThreadId) return;
      setFirstRunDemoThreadId(undefined);
      setFirstRunRetryDemo(true);
    });
    return () => {
      completed();
      failed();
    };
  }, [client, firstRunDemoThreadId]);

  useEffect(() => {
    if (!firstRunDemoThreadId || !projectSnapshot) return;
    const demo = projectSnapshot.projects
      .flatMap((project) => project.conversations)
      .find(({ id }) => id === firstRunDemoThreadId);
    if (demo?.status !== "completed") return;
    completeFirstRun(setFirstRunCompleted);
    setFirstRunDemoThreadId(undefined);
    setFirstRunRetryDemo(false);
  }, [firstRunDemoThreadId, projectSnapshot]);

  const sidebarProjects = filterProjectsForTaskList(
    (projectSnapshot?.projects ?? []).filter(
      (project) => project.scope !== "standalone",
    ),
    "",
    "all",
    runningThreadIds,
  );
  const standaloneProject = projectSnapshot?.projects.find(
    (project) => project.scope === "standalone",
  );
  const commandPaletteActions: CommandPaletteEntry[] = [
    {
      id: "action:new-task",
      kind: "action",
      actionId: "new-task",
      title: t("newTask"),
      subtitle: t("commandNewTaskDescription"),
      keywords: "new create task thread",
    },
    ...(memory && currentProject?.scope !== "standalone"
      ? [
          {
            id: "action:memory",
            kind: "action" as const,
            actionId: "memory",
            title: t("projectMemory"),
            subtitle: t("commandMemoryDescription"),
            keywords: "memory context",
          },
        ]
      : []),
    ...(workspace
      ? [
          {
            id: "action:review",
            kind: "action" as const,
            actionId: "review",
            title: t("reviewTaskChanges"),
            subtitle: t("commandReviewDescription"),
            keywords: "diff changes review",
          },
          {
            id: "action:workspace",
            kind: "action" as const,
            actionId: "workspace",
            title: workspacePanelOpen
              ? t("closeRightPanel")
              : t("openRightPanel"),
            subtitle: t("commandWorkspaceDescription"),
            keywords: "files panel workspace",
          },
        ]
      : []),
    ...(terminal
      ? [
          {
            id: "action:terminal",
            kind: "action" as const,
            actionId: "terminal",
            title: terminalOpen ? t("closeTerminal") : t("openTerminal"),
            subtitle: t("commandTerminalDescription"),
            keywords: "shell command terminal",
          },
        ]
      : []),
    ...(diagnostics
      ? [
          {
            id: "action:diagnostics",
            kind: "action" as const,
            actionId: "diagnostics",
            title: t("usageDiagnostics"),
            subtitle: t("commandDiagnosticsDescription"),
            keywords: "usage diagnostics tokens",
          },
        ]
      : []),
    ...(automations && currentProject?.scope !== "standalone"
      ? [
          {
            id: "action:automations",
            kind: "action" as const,
            actionId: "automations",
            title: t("automations"),
            subtitle: t("commandAutomationsDescription"),
            keywords:
              "automation schedule recurring cron tests dependencies issues",
          },
        ]
      : []),
    ...(settings
      ? [
          {
            id: "action:settings",
            kind: "action" as const,
            actionId: "settings",
            title: t("settings"),
            subtitle: t("commandSettingsDescription"),
            keywords: "preferences provider model theme language",
          },
        ]
      : []),
  ];
  const commandPaletteTasks: CommandPaletteEntry[] =
    projectSnapshot?.projects.flatMap((project) =>
      project.conversations.map((item) => ({
        id: `task:${project.id}:${item.id}`,
        kind: "task" as const,
        projectId: project.id,
        threadId: item.id,
        title: item.title,
        subtitle: `${
          project.scope === "standalone" ? t("notInProject") : project.name
        } · ${
          item.archivedAt
            ? t("archivedTasks")
            : runningThreadIds.includes(item.id)
              ? t("runningTasks")
              : item.status === "pending"
                ? t("pendingTasks")
                : item.status === "attention"
                  ? t("needsAttention")
                  : t("completedTasks")
        }`,
        keywords: `${project.name} ${
          project.scope === "standalone"
            ? "standalone not in project 不在项目中 不在專案中 プロジェクト外 프로젝트"
            : ""
        } ${item.archivedAt ? "archived" : item.status}`,
      })),
    ) ?? [];

  const dismissComposerErrors = useCallback(() => {
    setVoiceError(undefined);
    setAttachmentError(undefined);
    setNewTaskDraftError(undefined);
    if (state.threadId) clearSubmissionError(state.threadId);
  }, [clearSubmissionError, setNewTaskDraftError, state.threadId]);

  useEffect(() => {
    if (!voiceError && !attachmentError && !state.submissionError) return;
    return scheduleComposerErrorDismissal(dismissComposerErrors);
  }, [
    attachmentError,
    dismissComposerErrors,
    state.submissionError,
    voiceError,
  ]);

  function restoreComposerDraft(draft: string) {
    // Only restore when the user has not typed anything new while the
    // submission was in flight, so a failed send never clobbers fresh input.
    if (inputValueRef.current !== "") return;
    setInput(draft);
    inputValueRef.current = draft;
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
      element.focus();
      element.setSelectionRange(draft.length, draft.length);
    });
  }

  async function submit(
    value = input,
    followUpDelivery: "inject" | "queued" = "queued",
  ) {
    if (
      submissionGate.current.pending ||
      voiceStatus !== "idle" ||
      preparingAttachments
    ) {
      return;
    }
    if (!providerReady) {
      setView(firstRunRequired ? "thread" : "settings");
      return;
    }
    const draftInput = value;
    const draftAttachments = [...pendingAttachmentsRef.current];
    if (!draftInput.trim() && draftAttachments.length === 0) return;
    if (!submissionGate.current.tryStart()) return;
    const submittingFollowUp = state.isRunning;
    followOutput.current = true;
    setSubmitting(true);
    // Clear the composer immediately instead of waiting for the server round
    // trip, so the UI reacts instantly and the pending state is visible.
    historyIndex.current = -1;
    historyDraft.current = "";
    setInput("");
    setCapabilityQuery(undefined);
    inputValueRef.current = "";
    if (textarea.current) textarea.current.style.height = "auto";
    try {
      let stagedAttachments: AttachmentData[] = [];
      if (draftAttachments.length > 0) {
        try {
          stagedAttachments = await stageAttachments(draftAttachments);
        } catch {
          restoreComposerDraft(draftInput);
          return;
        }
      }
      if (submittingFollowUp) {
        if (!(await addFollowUp(value, followUpDelivery, stagedAttachments))) {
          restoreComposerDraft(draftInput);
          return;
        }
        clearAttachments(draftAttachments);
        return;
      }
      let submittedThreadId: string | undefined;
      let submitted = false;
      if (newTaskDraft && !state.threadId) {
        // Create the task only after the user has chosen its development
        // mode, so no hidden checkout needs to be replaced.
        const result = await sendNewThread(
          value,
          stagedAttachments,
          composerMode,
          selectedCapabilities,
          draftAccessMode,
          selectedProvider,
          selectedModel,
          developmentMode,
        );
        if (result) {
          if ("error" in result) {
            setNewTaskDraftError(result.error);
            restoreComposerDraft(draftInput);
          } else {
            setNewTaskDraft(false);
            setNewTaskDraftError(undefined);
            if (result.sent) {
              submittedThreadId = result.threadId;
              submitted = true;
            } else {
              restoreComposerDraft(draftInput);
            }
          }
        }
      } else if (
        await send(
          value,
          stagedAttachments,
          composerMode,
          selectedCapabilities,
          selectedAccessMode,
          state.provider,
          state.model,
        )
      ) {
        submittedThreadId = state.threadId;
        submitted = true;
        if (newTaskDraft) {
          setNewTaskDraft(false);
          setNewTaskDraftError(undefined);
        }
      } else {
        restoreComposerDraft(draftInput);
      }
      if (submitted) {
        setComposerMode("default");
        setSelectedCapabilities([]);
        clearAttachments(draftAttachments);
        if (projects && currentProject && submittedThreadId) {
          try {
            const existingTitle = currentProject.conversations.find(
              (conversation) => conversation.id === submittedThreadId,
            )?.title;
            const snapshot = await projects.upsertConversation({
              projectId: currentProject.id,
              id: submittedThreadId,
              title: existingTitle ?? t("task"),
            });
            setProjectSnapshot(snapshot);
          } catch (error) {
            setProjectError(errorMessage(error));
          }
        }
      }
    } finally {
      submissionGate.current.stop();
      setSubmitting(false);
    }
  }

  function rewriteQuestion(value: string) {
    historyIndex.current = -1;
    historyDraft.current = "";
    setInput(value);
    setVoiceError(undefined);
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
      element.focus();
      element.setSelectionRange(value.length, value.length);
    });
  }

  function closeConversationPanels() {
    setTerminalOpen(false);
    setWorkspacePanelOpen(false);
  }
  async function runFirstDemoTask(accessMode: ConversationAccessMode) {
    if (!projects || !providerReady) throw new Error(t("waitingForRuntime"));
    const demo = await prepareFirstRunDemoProject(projects, currentProject);
    if (!demo) throw new Error(t("waitingForRuntime"));
    if (demo.snapshot) setProjectSnapshot(demo.snapshot);
    const result = await sendNewThread(
      t("firstRunDemoPrompt"),
      [],
      "default",
      [],
      accessMode,
      undefined,
      undefined,
      "local",
    );
    if (!result) throw new Error(t("demoTaskStartFailed"));
    if ("error" in result) throw new Error(result.error);
    if (!result.sent) throw new Error(t("demoTaskStartFailed"));
    setFirstRunRetryDemo(false);
    setFirstRunDemoThreadId(result.threadId);
    setNewTaskDraft(false);
    setNewTaskDraftError(undefined);
    setView("thread");
    setProjectSnapshot(
      await projects.upsertConversation({
        projectId: demo.project.id,
        id: result.threadId,
        title: t("demoTask"),
      }),
    );
  }

  function requestMissingThreadMetadataDelete() {
    if (!currentProject || !currentConversation) return;
    setPendingDelete({
      projectId: currentProject.id,
      conversation: currentConversation,
      mode: "metadata",
    });
  }

  async function confirmDeleteConversation() {
    if (!pendingDelete || deletingConversation) return;
    setDeletingConversation(true);
    setDeleteError(undefined);
    try {
      const snapshot = await deleteConversationFromNavigation(
        pendingDelete,
        runningThreadIds,
      );
      if (snapshot) {
        setProjectSnapshot(snapshot);
        setPendingDelete(undefined);
      }
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeletingConversation(false);
    }
  }

  async function confirmDeleteProject() {
    if (!pendingDeleteProject || deletingProject) return;
    setDeletingProject(true);
    setDeleteProjectError(undefined);
    try {
      const snapshot = await deleteProjectFromNavigation(pendingDeleteProject);
      if (snapshot) {
        setProjectSnapshot(snapshot);
        setPendingDeleteProject(undefined);
      }
    } catch (error) {
      setDeleteProjectError(errorMessage(error));
    } finally {
      setDeletingProject(false);
    }
  }

  function handleCompositionStart() {
    composing.current = true;
  }

  function handleCompositionEnd() {
    composing.current = false;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Some IMEs (notably on macOS) report `isComposing` as false for the
    // Enter key that confirms the current candidate. Keep our own state and
    // also recognize the legacy keyCode 229 signal before handling menus or
    // submitting the message.
    if (shouldIgnoreComposerKey(composing.current, event.nativeEvent)) {
      return;
    }
    if (event.key === "Escape" && voiceStatus === "recording") {
      event.preventDefault();
      cancelVoiceInput();
      return;
    }
    if (addMenuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveCapabilityIndex((current) =>
          nextCapabilityIndex(current, composerMenuItemCount, delta),
        );
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        composerMenuItemCount > 0
      ) {
        event.preventDefault();
        selectComposerMenuItem(activeCapabilityIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAddMenuOpen(false);
        return;
      }
    }
    if (capabilityQuery) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (composerMenuItemCount > 0) {
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setActiveCapabilityIndex((current) =>
            nextCapabilityIndex(current, composerMenuItemCount, delta),
          );
        }
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        composerMenuItemCount > 0
      ) {
        event.preventDefault();
        selectComposerMenuItem(activeCapabilityIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCapabilityQuery(undefined);
        return;
      }
    }
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      const element = event.currentTarget;
      const atBoundary =
        event.key === "ArrowUp"
          ? element.selectionStart === 0 && element.selectionEnd === 0
          : element.selectionStart === input.length &&
            element.selectionEnd === input.length;
      if (atBoundary) {
        const next = navigateComposerHistory({
          messages: state.messages,
          current: input,
          draft: historyDraft.current,
          index: historyIndex.current,
          direction: event.key === "ArrowUp" ? "older" : "newer",
        });
        if (next) {
          event.preventDefault();
          historyIndex.current = next.index;
          historyDraft.current = next.draft;
          setInput(next.value);
          inputValueRef.current = next.value;
          requestAnimationFrame(() => {
            element.style.height = "auto";
            element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
            element.setSelectionRange(next.value.length, next.value.length);
          });
          return;
        }
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      voiceStatus === "idle"
    ) {
      event.preventDefault();
      void submit(input, composerSubmitDelivery(event, state.isRunning));
    }
  }

  const globalActions = currentProject ? (
    <WorkspaceActions
      projectId={currentProject.id}
      threadId={state.threadId}
      standalone={currentProject.scope === "standalone"}
      projectOpener={projectOpener}
      projectOpeners={projectOpeners}
      preferredProjectOpener={preferredProjectOpener}
      terminalAvailable={Boolean(terminal)}
      terminalOpen={terminalOpen}
      terminalContext={defaultTerminalContext}
      workspaceAvailable={Boolean(workspace)}
      workspaceOpen={workspacePanelOpen}
      onToggleTerminal={() => setTerminalOpen((open) => !open)}
      onToggleWorkspace={() => setWorkspacePanelOpen((open) => !open)}
    />
  ) : null;
  const globalActionsInPanel = Boolean(
    workspacePanelOpen && workspace && currentProject,
  );
  const composerHasContext = Boolean(
    (computerPermissionSnapshot?.required &&
      (!computerPermissionSnapshot.ownerThreadId ||
        computerPermissionSnapshot.ownerThreadId === state.threadId)) ||
    ownsActiveComputerShare(computerShareSnapshot, state.threadId) ||
    pendingAttachments.length > 0 ||
    state.queuedTurns.length > 0 ||
    selectedCapabilities.length > 0 ||
    capabilityQuery ||
    addMenuOpen,
  );

  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-hidden"}`}
    >
      <NavigationSidebar
        open={sidebarOpen}
        mobile={mobileSidebar}
        closeButtonRef={sidebarCloseButton}
        currentProject={currentProject}
        connection={state.connection}
        threadId={state.threadId}
        fallbackTaskTitle={state.messages[0]?.text}
        disabled={switchingProject || voiceStatus !== "idle"}
        automationsEnabled={Boolean(automations)}
        view={view}
        projectsAvailable={Boolean(projects)}
        projects={projectSnapshot}
        sidebarProjects={sidebarProjects}
        standaloneProject={standaloneProject}
        runningThreadIds={runningThreadIds}
        computerThreadId={computerShareSnapshot?.ownerThreadId}
        searchAvailable={Boolean(search)}
        memoryEnabled={Boolean(memory)}
        securityEnabled={Boolean(executionPolicy)}
        diagnostics={diagnostics}
        canRevealProjects={Boolean(workspace?.revealSystemFile)}
        canUpdateProjects={Boolean(projects?.updateProject)}
        canDeleteProjects={Boolean(projects?.deleteProject)}
        settingsEnabled={Boolean(settings)}
        currentHost={currentHost}
        canConnectRemote={Boolean(projects?.connectRemote)}
        searchTriggerRef={commandPaletteTrigger}
        onHide={() => hideSidebar(true)}
        onCreateTask={() => void createThread()}
        onNavigate={(nextView) => {
          cancelVoiceInput();
          setView(nextView);
          closeSidebarForNavigation();
        }}
        onSearch={() => openCommandPalette("all")}
        onOpenProject={() => void openProjectFolder()}
        onCreateProjectTask={createProjectThread}
        onOpenProjectView={openProjectView}
        onRevealProject={revealProjectInFinder}
        onToggleProjectPinned={toggleProjectPinned}
        onDeleteProject={(project) => {
          closeSidebarForNavigation();
          setDeleteProjectError(undefined);
          setPendingDeleteProject(project);
        }}
        onSelectConversation={(projectId, threadId) =>
          void selectConversation(projectId, threadId)
        }
        onUpdateConversation={updateConversationMetadata}
        onDeleteConversation={(projectId, conversation) => {
          closeSidebarForNavigation();
          setDeleteError(undefined);
          setPendingDelete({ projectId, conversation });
        }}
        onOpenRemoteRuntime={() => {
          closeSidebarForNavigation();
          setRemoteRuntimeError(undefined);
          setRemoteRuntimeOpen(true);
        }}
      />

      <main
        ref={workspaceRoot}
        className={`workspace ${terminalOpen ? "has-terminal" : ""} ${workspacePanelOpen && workspace && currentProject ? "has-workspace-panel" : ""} ${isDraggingFiles ? "is-dragging-files" : ""}`}
        style={
          workspacePanelOpen &&
          workspace &&
          currentProject &&
          workspacePanelWidth
            ? {
                gridTemplateColumns: `minmax(360px, 1fr) ${workspacePanelWidth}px`,
              }
            : undefined
        }
        onPaste={handlePaste}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!sidebarOpen && (
          <button
            ref={sidebarOpenButton}
            type="button"
            className="sidebar-reveal-button pressable"
            aria-label={t("showSidebar")}
            title={t("showSidebar")}
            aria-controls="app-sidebar"
            aria-expanded={false}
            onClick={showSidebar}
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        <div className="workspace-primary">
          {showFirstRunGuide && settings && runtimeSettings ? (
            <Suspense fallback={<DeferredView label={t("loading")} />}>
              <LazyFirstRunGuide
                key={firstRunRetryDemo ? "demo-retry" : "first-run"}
                adapter={settings}
                settings={runtimeSettings}
                project={currentProject}
                connectionReady={providerReady}
                initialStep={firstRunRetryDemo ? "demo" : undefined}
                onSettingsSaved={setRuntimeSettings}
                onLanguageChange={onLanguageChange}
                onThemeChange={onThemeChange}
                onRuntimeRestart={reconnectRuntime}
                onOpenProject={() => openProjectFolder()}
                onRunDemo={runFirstDemoTask}
              />
            </Suspense>
          ) : view === "memory" &&
            memory &&
            currentProject &&
            currentProject.scope !== "standalone" ? (
            <ProjectMemoryPage
              adapter={memory}
              projectId={currentProject.id}
              projectName={currentProject.name}
            />
          ) : view === "diagnostics" && diagnostics && currentProject ? (
            <DiagnosticsPage
              adapter={diagnostics}
              projectId={currentProject.id}
              projectName={currentProject.name}
              conversations={currentProject.conversations}
            />
          ) : view === "automations" && automations && currentProject ? (
            <Suspense fallback={<DeferredView label={t("loading")} />}>
              <LazyAutomationsPage
                adapter={automations}
                projectId={currentProject.id}
                projectName={currentProject.name}
                onOpenThread={(threadId) =>
                  void selectConversation(currentProject.id, threadId)
                }
              />
            </Suspense>
          ) : view === "settings" && settings ? (
            <Suspense fallback={<DeferredView label={t("loading")} />}>
              <LazySettingsPage
                adapter={settings}
                secretStorageBoundary={
                  currentHost?.kind === "remote" ? "host-file" : "system"
                }
                onRuntimeRestart={reconnectRuntime}
                onLanguageChange={onLanguageChange}
                onThemeChange={onThemeChange}
                projectOpeners={projectOpeners}
                onPreferredProjectOpenerChange={onPreferredProjectOpenerChange}
                onSettingsChange={setRuntimeSettings}
              />
            </Suspense>
          ) : view === "security" && executionPolicy && currentProject ? (
            <ExecutionPolicyPage
              adapter={executionPolicy}
              projectId={currentProject.id}
              projectName={currentProject.name}
            />
          ) : projects && !currentProject ? (
            <ProjectEmptyState
              error={projectError}
              opening={switchingProject}
              onOpen={() => void openProjectFolder()}
              onCreateStandalone={
                projects.createStandalone
                  ? () => void createStandaloneThread()
                  : undefined
              }
              onConnectRemote={
                projects.connectRemote
                  ? () => setRemoteRuntimeOpen(true)
                  : undefined
              }
            />
          ) : (
            <>
              <TaskHeader
                title={headerTitle}
                context={
                  currentProject?.scope === "standalone"
                    ? t("notInProject")
                    : currentProject?.runtime?.kind === "remote"
                      ? `${t("remoteRuntime")} · ${currentProject.runtime.workspacePath}`
                      : (currentProject?.basePath ?? t("agentRuntime"))
                }
                taskId={shortId(state.threadId)}
                running={state.isRunning}
                connectionReady={
                  state.connection === "ready" && Boolean(state.threadId)
                }
                bookmarkCount={taskProductivity.bookmarkedMessages.length}
                taskLinksEnabled={taskLinksEnabled}
                onCopyReference={taskProductivity.copyReference}
                onExport={taskProductivity.exportConversation}
                onOpenBookmarks={() => taskProductivity.setBookmarksOpen(true)}
              />

              <section
                ref={conversation}
                className={`conversation ${isEmpty ? "is-empty" : ""} ${hasConversationChanges ? "has-conversation-changes" : ""} ${showJumpToLatest || state.plan || hasConversationChanges ? "has-composer-floats" : ""}`}
                aria-live="polite"
                onScroll={(event) => {
                  const following = isNearBottom(event.currentTarget);
                  followOutput.current = following;
                  setShowJumpToLatest(!following);
                }}
              >
                <Timeline messages={state.messages} onJump={jumpToMessage} />
                <div className="conversation-inner">
                  {state.recovery?.kind === "missing_thread" ? (
                    <MissingThreadRecovery
                      threadId={state.recovery.threadId}
                      busy={conversationRecoveryBusy}
                      error={conversationRecoveryError}
                      onRepair={() => void repairMissingThread()}
                      onRelink={(threadId) =>
                        void relinkMissingThread(threadId)
                      }
                      onDeleteMetadata={requestMissingThreadMetadataDelete}
                    />
                  ) : state.connection === "error" ? (
                    <ConnectionError
                      message={
                        state.connectionError ?? t("appServerConnectionFailed")
                      }
                      onRetry={() => void retry()}
                      onOpenSettings={
                        settings ? () => setView("settings") : undefined
                      }
                    />
                  ) : null}

                  {isEmpty ? (
                    <EmptyState
                      connecting={state.connection === "connecting"}
                      project={currentProject}
                      projects={(projectSnapshot?.projects ?? []).filter(
                        (project) => project.scope !== "standalone",
                      )}
                      suggestions={suggestions}
                      suggestionsLoading={suggestionsLoading}
                      suggestionsFailed={suggestionsFailed}
                      onRetrySuggestions={retrySuggestions}
                      onSelectProject={createProjectThread}
                      onOpenProject={() => void openProjectFolder()}
                      onCreateStandalone={() => void createStandaloneThread()}
                      onSelect={(value) => {
                        setInput(value);
                        textarea.current?.focus();
                      }}
                    />
                  ) : (
                    <div className="message-list">
                      {state.messages.map((message) => (
                        <article
                          id={`message-${message.id}`}
                          className={`message ${message.role} ${message.error ? "error" : ""}`}
                          key={message.id}
                          tabIndex={-1}
                        >
                          {message.role === "user" &&
                            message.followUpDelivery === "inject" && (
                              <GuidedMessageReceipt />
                            )}
                          {message.role === "user" &&
                            message.attachments &&
                            message.attachments.length > 0 && (
                              <MessageAttachments
                                attachments={message.attachments}
                                attachmentPreview={attachmentPreview}
                              />
                            )}
                          <MessageCapabilityReceipts
                            role={message.role}
                            capabilities={message.capabilities}
                            capabilityRefs={message.capabilityRefs}
                            catalog={capabilities}
                          />
                          {(message.text || message.role === "assistant") && (
                            <div className="message-body">
                              {message.progress &&
                                message.progress.length > 0 && (
                                  <ProgressList
                                    progress={message.progress}
                                    onTerminateProcess={terminateProcess}
                                    onOpenLocalFile={openLocalFile}
                                    onRevealLocalFile={
                                      workspace?.reveal ||
                                      workspace?.revealSystemFile
                                        ? revealLocalFile
                                        : undefined
                                    }
                                  />
                                )}
                              {(!message.progress ||
                                message.progress.length === 0) &&
                                message.activities &&
                                message.activities.length > 0 && (
                                  <ActivityList
                                    activities={message.activities}
                                    onTerminateProcess={terminateProcess}
                                  />
                                )}
                              {message.role === "assistant" && (
                                <AgentTreePanel tree={message.agentTree} />
                              )}
                              {message.role === "assistant" ? (
                                <MarkdownContent
                                  onOpenLocalFile={openLocalFile}
                                  sources={message.sources}
                                  citations={message.citations}
                                  onRevealLocalFile={
                                    workspace?.reveal ||
                                    workspace?.revealSystemFile
                                      ? revealLocalFile
                                      : undefined
                                  }
                                >
                                  {message.text}
                                </MarkdownContent>
                              ) : (
                                <p>{message.text}</p>
                              )}
                            </div>
                          )}
                          {message.text && (
                            <MessageActions
                              role={message.role}
                              text={message.text}
                              copyText={clipboard?.writeText}
                              onRewrite={
                                message.role === "user"
                                  ? () => rewriteQuestion(message.text)
                                  : undefined
                              }
                              bookmarked={taskProductivity.bookmarkedIds.includes(
                                message.id,
                              )}
                              onToggleBookmark={() =>
                                taskProductivity.toggleBookmark(message.id)
                              }
                            />
                          )}
                        </article>
                      ))}

                      {(state.progress.length > 0 ||
                        state.streamingText.length > 0 ||
                        state.isThinking) && (
                        <div className="live-run">
                          {state.progress.length > 0 && (
                            <ProgressList
                              progress={state.progress}
                              live
                              onTerminateProcess={terminateProcess}
                              onOpenLocalFile={openLocalFile}
                              onRevealLocalFile={
                                workspace?.reveal || workspace?.revealSystemFile
                                  ? revealLocalFile
                                  : undefined
                              }
                            />
                          )}
                          {state.streamingText.length > 0 && (
                            <div className="streaming-copy" aria-busy="true">
                              <MarkdownContent
                                onOpenLocalFile={openLocalFile}
                                onRevealLocalFile={
                                  workspace?.reveal ||
                                  workspace?.revealSystemFile
                                    ? revealLocalFile
                                    : undefined
                                }
                              >
                                {state.streamingText}
                              </MarkdownContent>
                            </div>
                          )}
                          {state.isThinking && (
                            <div className="thinking-row">
                              <LoaderCircle size={15} />
                              {t("thinking")}
                            </div>
                          )}
                        </div>
                      )}

                      {shouldShowDeliveryTurnStatus(
                        currentConversation?.workspace?.mode,
                        state.isRunning,
                      ) && (
                        <DeliveryTurnStatus
                          delivery={automaticDelivery}
                          disabled={
                            automaticDelivery?.status === "syncing" ||
                            automaticDelivery?.status === "undoing"
                          }
                          onOpen={openDeliveryCenter}
                          onRetry={
                            workspace?.applyDelivery
                              ? () => void retryAutomaticDelivery()
                              : undefined
                          }
                          onUndo={
                            workspace?.undoDelivery
                              ? () => void undoAutomaticDelivery()
                              : undefined
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </section>

              <footer className="composer-wrap">
                <ComposerFloatingControls
                  jumpVisible={showJumpToLatest && state.messages.length > 0}
                  plan={state.plan}
                  changes={
                    hasConversationChanges ? conversationChanges : undefined
                  }
                  onJump={jumpToLatest}
                  onOpenChanges={openReviewPanel}
                />
                <AgentTreePanel
                  tree={state.agentTree}
                  live
                  controls={{ client, threadId: state.threadId }}
                  onOpenInPanel={workspaceAgentPanel.open}
                />
                {!providerReady && (
                  <button
                    type="button"
                    className="composer-provider-gate pressable"
                    onClick={() =>
                      setView(firstRunRequired ? "thread" : "settings")
                    }
                  >
                    <KeyRound size={14} />
                    <span>
                      <strong>{t("providerRequired")}</strong>
                      <small>{t("providerRequiredDescription")}</small>
                    </span>
                    <span>{t("configureProvider")}</span>
                  </button>
                )}
                <div
                  ref={composerRoot}
                  className={`composer${voiceStatus !== "idle" ? " is-voice-active" : ""}${voiceStatus === "recording" ? " is-recording" : ""}${composerHasContext ? " has-context" : ""}`}
                >
                  <input
                    ref={fileInput}
                    className="visually-hidden"
                    type="file"
                    multiple
                    tabIndex={-1}
                    onChange={(event) => {
                      addAttachments([...(event.currentTarget.files ?? [])]);
                      event.currentTarget.value = "";
                    }}
                  />
                  {computerPermissionSnapshot?.required &&
                    (!computerPermissionSnapshot.ownerThreadId ||
                      computerPermissionSnapshot.ownerThreadId ===
                        state.threadId) && (
                      <ComputerPermissionCard
                        snapshot={computerPermissionSnapshot}
                        busy={computerPermissionBusy}
                        error={computerPermissionError}
                        onRequest={(capability) =>
                          void requestComputerPermission(capability)
                        }
                        onRefresh={() => void refreshComputerPermissions()}
                        onRelaunch={() => void relaunchForComputerPermissions()}
                      />
                    )}
                  {ownsActiveComputerShare(
                    computerShareSnapshot,
                    state.threadId,
                  ) && (
                    <ComputerShareStatus
                      snapshot={computerShareSnapshot}
                      busy={showingComputerShare || stoppingComputerShare}
                      stopping={stoppingComputerShare}
                      error={computerShareError}
                      onShow={() => void showComputerSharePreview()}
                      onStop={() => void stopComputerShare()}
                    />
                  )}
                  {pendingAttachments.length > 0 && (
                    <ComposerAttachments
                      attachments={pendingAttachments}
                      onRemove={removeAttachment}
                      disabled={preparingAttachments}
                    />
                  )}
                  {state.queuedTurns.length > 0 && (
                    <ComposerQueue
                      items={state.queuedTurns}
                      onInject={injectQueuedTurn}
                      onReorder={reorderQueuedTurn}
                      onCancel={cancelQueuedTurn}
                    />
                  )}
                  <CapabilityChips
                    capabilities={selectedCapabilities}
                    disabled={state.isRunning}
                    onManage={manageConnector}
                    onRemove={(capability) =>
                      setSelectedCapabilities((current) => {
                        if (capability.id === "tool:plan") {
                          setComposerMode("default");
                        }
                        return current.filter(({ id }) => id !== capability.id);
                      })
                    }
                  />
                  {(capabilityQuery || addMenuOpen) && (
                    <CapabilityMenu
                      actions={addActions}
                      capabilities={filteredCapabilities}
                      activeIndex={Math.min(
                        activeCapabilityIndex,
                        Math.max(0, composerMenuItemCount - 1),
                      )}
                      loading={capabilitiesLoading}
                      onSelectAction={selectAddAction}
                      onSelect={selectCapability}
                    />
                  )}
                  <textarea
                    ref={textarea}
                    value={input}
                    rows={2}
                    placeholder={
                      voiceStatus === "recording"
                        ? t("listening")
                        : providerReady
                          ? t("askThreadlight")
                          : t("configureProviderToStart")
                    }
                    disabled={state.connection !== "ready" || !providerReady}
                    onChange={(event) => {
                      const value = event.target.value;
                      historyIndex.current = -1;
                      historyDraft.current = "";
                      setInput(value);
                      inputValueRef.current = value;
                      if (state.isRunning) {
                        setCapabilityQuery(undefined);
                      } else {
                        updateCapabilityQuery(
                          value,
                          event.target.selectionStart,
                        );
                      }
                      dismissComposerErrors();
                    }}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onKeyDown={handleKeyDown}
                    onInput={(event) => {
                      event.currentTarget.style.height = "auto";
                      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
                    }}
                    aria-label={t("message")}
                    aria-describedby="composer-hint"
                    role="combobox"
                    aria-haspopup="listbox"
                    aria-autocomplete="list"
                    aria-expanded={Boolean(capabilityQuery || addMenuOpen)}
                    aria-controls={
                      capabilityQuery || addMenuOpen
                        ? "composer-capability-menu"
                        : undefined
                    }
                    aria-activedescendant={
                      (capabilityQuery || addMenuOpen) &&
                      composerMenuItemCount > 0
                        ? `composer-capability-${Math.min(
                            activeCapabilityIndex,
                            composerMenuItemCount - 1,
                          )}`
                        : undefined
                    }
                  />
                  <div className="composer-toolbar">
                    <div className="composer-toolbar-start">
                      <button
                        type="button"
                        className={`composer-action add pressable ${addMenuOpen ? "active" : ""}`}
                        onPointerDown={(event) =>
                          activateComposerMenuOnPointerDown(
                            event,
                            toggleComposerAddMenu,
                          )
                        }
                        onClick={(event) => {
                          if (event.detail !== 0) return;
                          toggleComposerAddMenu();
                        }}
                        disabled={
                          state.connection !== "ready" ||
                          !providerReady ||
                          submitting ||
                          preparingAttachments
                        }
                        aria-label={t("add")}
                        aria-expanded={addMenuOpen}
                        aria-controls={
                          addMenuOpen ? "composer-capability-menu" : undefined
                        }
                        title={t("add")}
                      >
                        <Plus size={18} />
                      </button>
                      {showDevelopmentMode && (
                        <DevelopmentModeControl
                          mode={currentDevelopmentMode}
                          disabled={
                            !developmentModeEditable ||
                            submitting ||
                            preparingAttachments ||
                            voiceStatus !== "idle"
                          }
                          onOpen={() => {
                            setAddMenuOpen(false);
                            setCapabilityQuery(undefined);
                          }}
                          onChange={setDevelopmentMode}
                        />
                      )}
                      {executionPolicy &&
                        projects &&
                        currentProject &&
                        (state.threadId || newTaskDraft) && (
                          <ConversationAccessControl
                            mode={selectedAccessMode}
                            disabled={
                              state.connection !== "ready" ||
                              state.isRunning ||
                              switchingProject ||
                              voiceStatus !== "idle"
                            }
                            onOpen={() => {
                              setAddMenuOpen(false);
                              setCapabilityQuery(undefined);
                            }}
                            onChange={
                              newTaskDraft
                                ? (mode) => setDraftAccessMode(mode)
                                : updateConversationAccessMode
                            }
                          />
                        )}
                    </div>
                    <div className="composer-toolbar-end">
                      <ModelSelector
                        settings={runtimeSettings}
                        provider={selectedProvider}
                        model={selectedModel}
                        disabled={
                          state.connection !== "ready" ||
                          !providerReady ||
                          state.isRunning ||
                          voiceStatus !== "idle" ||
                          submitting ||
                          preparingAttachments
                        }
                        t={t}
                        onSelect={(selection) => {
                          if (newTaskDraft) {
                            setDraftModel(selection);
                          } else if (state.threadId) {
                            setThreadModel(
                              state.threadId,
                              selection.provider,
                              selection.model,
                            );
                          }
                        }}
                      />
                      {voiceInput && !state.isRunning && (
                        <VoiceInputButton
                          status={voiceStatus}
                          onToggle={() => {
                            if (voiceStatus === "recording") stopVoiceInput();
                            else void startVoiceInput();
                          }}
                          disabled={
                            state.connection !== "ready" || !providerReady
                          }
                          t={t}
                        />
                      )}
                      {state.isRunning && (
                        <button
                          type="button"
                          className="composer-action send pressable"
                          onPointerDown={preserveComposerFocusOnPointerDown}
                          onClick={() => void submit(input, "queued")}
                          disabled={
                            submitting ||
                            preparingAttachments ||
                            (!input.trim() && pendingAttachments.length === 0)
                          }
                          aria-label={t("queueMessage")}
                          title={t("queueMessage")}
                        >
                          {submitting ? (
                            <LoaderCircle className="spin" size={18} />
                          ) : (
                            <ArrowUp size={18} strokeWidth={2.4} />
                          )}
                        </button>
                      )}
                      {state.isRunning ? (
                        <button
                          type="button"
                          className="composer-action stop pressable"
                          onPointerDown={preserveComposerFocusOnPointerDown}
                          onClick={() => void interrupt()}
                          aria-label={t("stopRun")}
                          title={t("stop")}
                        >
                          <CircleStop size={18} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="composer-action send pressable"
                          onPointerDown={preserveComposerFocusOnPointerDown}
                          onClick={() => void submit()}
                          disabled={
                            submitting ||
                            (!input.trim() &&
                              pendingAttachments.length === 0) ||
                            state.connection !== "ready" ||
                            !providerReady ||
                            voiceStatus !== "idle" ||
                            preparingAttachments
                          }
                          aria-label={t("sendMessage")}
                          title={t("send")}
                        >
                          {submitting ? (
                            <LoaderCircle className="spin" size={18} />
                          ) : (
                            <ArrowUp size={18} strokeWidth={2.4} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="composer-footer-status">
                  <p
                    id="composer-hint"
                    className={`composer-hint ${voiceError || attachmentError || state.submissionError ? "error" : ""}`}
                    data-mobile-instruction={
                      voiceStatus === "idle" &&
                      !voiceError &&
                      !attachmentError &&
                      !state.submissionError &&
                      !submitting &&
                      !preparingAttachments &&
                      pendingAttachments.length === 0
                        ? "true"
                        : undefined
                    }
                    aria-live="polite"
                  >
                    {attachmentHint(
                      voiceStatus,
                      voiceError,
                      attachmentError,
                      state.submissionError,
                      pendingAttachments,
                      preparingAttachments,
                      state.isRunning,
                      submitting,
                      t,
                    )}
                  </p>
                  <ComposerProductivityStatus
                    hasHistory={state.messages.some(
                      (message) =>
                        message.role === "user" && message.text.trim(),
                    )}
                    draftStatus={draftStatus}
                  />
                </div>
              </footer>
              {isDraggingFiles && (
                <div className="attachment-drop-overlay" aria-hidden="true">
                  <div>
                    <Paperclip size={20} />
                    <span>{t("dropFiles")}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {!globalActionsInPanel &&
          currentProject &&
          (projectOpener || terminal || workspace) && (
            <div className="workspace-global-actions">{globalActions}</div>
          )}
        {workspace && currentProject && workspacePanelMounted.current && (
          <Suspense
            fallback={
              <DeferredWorkspacePanel
                hidden={!workspacePanelOpen}
                label={t("loading")}
              />
            }
          >
            <LazyWorkspacePanel
              adapter={workspace}
              terminal={terminal}
              projectId={currentProject.id}
              threadId={state.threadId}
              projectName={currentProject.name}
              remoteFileRoot={
                currentProject.runtime?.kind === "remote"
                  ? currentProject.runtime.workspacePath
                  : undefined
              }
              changes={conversationChanges}
              changesLoading={conversationChangesLoading}
              changesError={conversationChangesError}
              reviewRequest={workspaceReviewRequest}
              deliveryRequest={workspaceDeliveryRequest}
              fileOpenRequest={workspaceFileOpenRequest}
              agentPanel={workspaceAgentPanel}
              agentControls={{ client, threadId: state.threadId }}
              hidden={!workspacePanelOpen}
              onResizeStart={beginWorkspacePanelResize}
              onResizeBy={resizeWorkspacePanelBy}
              onResetSize={() => setWorkspacePanelWidth(undefined)}
              onRefreshChanges={() => void refreshConversationChanges()}
              onRestoreChanges={
                workspace.restoreChanges
                  ? restoreConversationChanges
                  : undefined
              }
              restoreDisabled={state.isRunning}
              deliveryEnabled={
                currentConversation?.workspace?.mode === "worktree"
              }
              deliveryDisabled={state.isRunning}
              automaticDelivery={automaticDelivery}
              taskBranch={taskTerminalBranch}
              originalBranch={originalTerminalBranch}
              taskWorkspaceAvailable={terminalScope === "task"}
              generatePullRequestDescription={
                state.threadId && conversationChanges
                  ? () =>
                      client.generatePullRequestDescription(
                        state.threadId as string,
                        conversationChanges.files
                          .filter((file) => !file.localOnly)
                          .map((file) => ({
                            path: file.path,
                            status: file.status,
                            additions: file.additions,
                            deletions: file.deletions,
                            binary: file.binary,
                          })),
                      )
                  : undefined
              }
              onRetryAutomaticDelivery={() => void retryAutomaticDelivery()}
              onUndoAutomaticDelivery={undoAutomaticDelivery}
              taskTitle={currentConversation?.title}
              onDiscardTask={
                currentConversation?.workspace?.mode === "worktree"
                  ? () =>
                      setPendingDelete({
                        projectId: currentProject.id,
                        conversation: currentConversation,
                        mode: "discard",
                      })
                  : undefined
              }
              toolbarActions={globalActionsInPanel ? globalActions : undefined}
            />
          </Suspense>
        )}
        {terminalOpen && terminal && currentProject && (
          <Suspense fallback={<DeferredTerminalPanel label={t("loading")} />}>
            <LazyTerminalPanel
              key={`${currentProject.id}:${state.threadId ?? ""}`}
              adapter={terminal}
              workspace={workspace}
              projectId={currentProject.id}
              threadId={state.threadId}
              projectName={currentProject.name}
              taskBranch={taskTerminalBranch}
              originalBranch={originalTerminalBranch}
              defaultWorkspace={terminalScope}
              taskWorkspaceAvailable={terminalScope === "task"}
              onClose={() => setTerminalOpen(false)}
            />
          </Suspense>
        )}
      </main>
      {commandPaletteOpen && search && currentProject && (
        <CommandPalette
          adapter={search}
          projectId={currentProject.id}
          threadId={state.threadId}
          mode={commandPaletteMode}
          actions={commandPaletteActions}
          tasks={commandPaletteTasks}
          onModeChange={setCommandPaletteMode}
          onClose={() => closeCommandPalette()}
          onSelect={(entry) => void selectCommandPaletteEntry(entry)}
        />
      )}
      {pendingDelete && (
        <DeleteConversationDialog
          conversation={pendingDelete.conversation}
          discard={pendingDelete.mode === "discard"}
          metadataOnly={pendingDelete.mode === "metadata"}
          localDataFiles={
            pendingDelete.mode === "discard" &&
            pendingDelete.conversation.id === state.threadId
              ? (conversationChanges?.files.filter((file) => file.localOnly)
                  .length ?? 0)
              : 0
          }
          deleting={deletingConversation}
          error={deleteError}
          onCancel={() => {
            setPendingDelete(undefined);
            setDeleteError(undefined);
          }}
          onConfirm={() => void confirmDeleteConversation()}
        />
      )}
      {pendingDeleteProject && (
        <DeleteProjectDialog
          project={pendingDeleteProject}
          deleting={deletingProject}
          error={deleteProjectError}
          onCancel={() => {
            setPendingDeleteProject(undefined);
            setDeleteProjectError(undefined);
          }}
          onConfirm={() => void confirmDeleteProject()}
        />
      )}
      {remoteRuntimeOpen && projects?.connectRemote && (
        <RemoteRuntimeDialog
          hosts={hostSnapshot}
          activeHostId={hostSnapshot?.activeHostId}
          busy={remoteRuntimeBusy || switchingProject}
          error={remoteRuntimeError}
          onCancel={() => {
            if (remoteRuntimeBusy) return;
            setRemoteRuntimeOpen(false);
            setRemoteRuntimeError(undefined);
          }}
          onActivate={(hostId) => void activateHost(hostId)}
          onUpdate={
            projects.updateRemoteHost
              ? (input) => void updateRemoteHost(input)
              : undefined
          }
          onDelete={(hostId) => void deleteRemoteHost(hostId)}
          onConnect={(input) => void connectRemoteRuntime(input)}
          onResetError={() => setRemoteRuntimeError(undefined)}
        />
      )}
      {remoteProjectPathOpen && (
        <RemoteProjectPathDialog
          key={currentHost?.id ?? "remote"}
          busy={switchingProject}
          error={projectError}
          hostId={currentHost?.id ?? "remote"}
          hostName={currentHost?.name ?? t("remoteHost")}
          recentProjects={(projectSnapshot?.projects ?? [])
            .filter((project) => project.scope !== "standalone")
            .map((project) => ({
              name: project.name,
              path: project.basePath,
              lastOpenedAt: project.lastOpenedAt,
            }))}
          onBrowse={projects?.listRemoteDirectories}
          onCancel={() => {
            if (!switchingProject) setRemoteProjectPathOpen(false);
          }}
          onOpen={(path) => {
            void openProjectFolder(path);
          }}
        />
      )}
      {connectorSetup && (
        <ConnectorSetupDialog
          capability={connectorSetup.capability}
          status={connectorSetup.status}
          busy={connectorBusy}
          error={connectorError}
          onCancel={closeConnectorSetup}
          onConnect={(clientId, clientSecret) =>
            void connectConnector(clientId, clientSecret)
          }
          onDisconnect={() => void disconnectConnector()}
        />
      )}
      {taskProductivity.bookmarksOpen && (
        <MessageBookmarksDialog
          messages={taskProductivity.bookmarkedMessages}
          onClose={() => taskProductivity.setBookmarksOpen(false)}
          onJump={jumpToMessage}
          onRemove={taskProductivity.toggleBookmark}
        />
      )}
      {executionPolicy && <ExecutionApprovalGate adapter={executionPolicy} />}
    </div>
  );
}
