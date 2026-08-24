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
import type { AppViewModel } from "./app-view-model.js";
import { ThreadlightAppView } from "./app-view.js";
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
import { CommandPalette, type SearchAdapter } from "./command-palette.js";
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
  formatTokenUsage,
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
import { useComposerRuntime } from "./features/composer/runtime-controller.js";
import { useVoiceInputController } from "./features/composer/voice-input-controller.js";
import { useActiveModelSelection } from "./model-selection-controller.js";
import {
  completeFirstRun,
  useNavigationController,
} from "./features/navigation/controller.js";
import { useNavigationRuntime } from "./features/navigation/runtime-controller.js";
import { useFirstRunController } from "./features/navigation/first-run-controller.js";
import {
  commandPaletteActions,
  commandPaletteTasks,
} from "./features/navigation/command-palette-model.js";
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

function ThreadlightAppContent(app: ThreadlightAppProps & AppShellState) {
  const {
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
  } = app;
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
  const sessionApi = useThreadlightSession(client, {
    autoConnect: !projects,
    runningThreadIds: projectSnapshot?.runningThreadIds,
  });
  const {
    state: activeState,
    retry,
    openThread,
    deleteThread,
    send,
    sendNewThread,
    continueTurn,
    setThreadModel,
    addFollowUp,
    injectQueuedTurn,
    reorderQueuedTurn,
    cancelQueuedTurn,
    clearSubmissionError,
    interrupt,
    terminateProcess,
    runningThreadIds,
  } = sessionApi;
  const defaultAccessMode = runtimeSettings?.defaultAccessMode ?? "approval";
  const taskSession = useTaskSessionController(defaultAccessMode);
  const {
    newTaskDraft,
    setNewTaskDraft,
    newTaskDraftError,
    setNewTaskDraftError,
    developmentMode,
    setDevelopmentMode,
    draftAccessMode,
    setDraftAccessMode,
    resetDraftAccessMode,
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
  } = taskSession;
  const { beginDraft, connectProject } = useProjectSessionActions({
    projects,
    openThread,
    setProjectSnapshot,
    setDevelopmentMode,
    resetDraftAccessMode,
    defaultAccessMode,
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
  const composer = useComposerController();
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
  } = composer;
  const attachments = useAttachmentController({
    adapter: attachmentStage,
    enabled: view === "thread",
    limit: MAX_COMPOSER_ATTACHMENTS,
    t,
  });
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
  } = attachments;
  const capabilityController = useCapabilityController({
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
  } = capabilityController;
  const voice = useVoiceInputController({
    adapter: voiceInput,
    setInput,
    textarea,
    t,
  });
  const {
    status: voiceStatus,
    error: voiceError,
    setError: setVoiceError,
    start: startVoiceInput,
    stop: stopVoiceInput,
    cancel: cancelVoiceInput,
  } = voice;
  const computer = useComputerController({
    share: computerShare,
    permissions: computerPermissions,
    threadId: state.threadId,
    connection: state.connection,
    running: state.isRunning,
    send,
    t,
  });
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
  } = computer;
  const delivery = useDeliveryRuntime({
    client,
    projects,
    workspace,
    project: currentProject,
    conversation: currentConversation,
    session: state,
    setProjectSnapshot,
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
  } = delivery;
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
  const selectedAccessMode = newTaskDraft
    ? draftAccessMode
    : (currentConversation?.accessMode ?? "approval");
  const { selectedProvider, selectedModel, setConversationModel } =
    useActiveModelSelection({
      settings: runtimeSettings,
      storage: productivityStorage,
      newTaskDraft,
      draftModel,
      fallbackProvider: state.provider,
      fallbackModel: state.model,
      threadId: state.threadId,
      updateThreadModel: setThreadModel,
    });
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
  const { runDemo: runFirstDemoTask } = useFirstRunController({
    client,
    projects,
    project: currentProject,
    projectSnapshot,
    providerReady,
    demoThreadId: firstRunDemoThreadId,
    setCompleted: setFirstRunCompleted,
    setDemoThreadId: setFirstRunDemoThreadId,
    setRetryDemo: setFirstRunRetryDemo,
    setProjectSnapshot,
    setNewTaskDraft,
    setNewTaskDraftError,
    showThread: () => setView("thread"),
    sendNewThread,
    t,
  });

  async function persistSubmittedThread(
    threadId: string,
    accessMode: ConversationAccessMode,
  ) {
    if (!projects || !currentProject) return;
    try {
      const existingTitle = currentProject.conversations.find(
        (conversation) => conversation.id === threadId,
      )?.title;
      setProjectSnapshot(
        await projects.upsertConversation({
          projectId: currentProject.id,
          id: threadId,
          title: existingTitle ?? t("task"),
          accessMode,
        }),
      );
    } catch (error) {
      setProjectError(errorMessage(error));
    }
  }

  const composerRuntime = useComposerRuntime({
    session: state,
    input,
    setInput,
    setSubmitting,
    submissionGate,
    inputValueRef,
    composerMode,
    setComposerMode,
    textarea,
    composing,
    historyIndex,
    historyDraft,
    followOutput,
    voiceStatus,
    voiceError,
    setVoiceError,
    cancelVoiceInput,
    attachmentError,
    setAttachmentError,
    preparingAttachments,
    pendingAttachmentsRef,
    stageAttachments,
    clearAttachments,
    capabilityQuery,
    setCapabilityQuery,
    selectedCapabilities,
    setSelectedCapabilities,
    addMenuOpen,
    setAddMenuOpen,
    activeCapabilityIndex,
    setActiveCapabilityIndex,
    composerMenuItemCount,
    selectComposerMenuItem,
    newTaskDraft,
    setNewTaskDraft,
    setNewTaskDraftError,
    developmentMode,
    draftAccessMode,
    selectedAccessMode,
    selectedProvider,
    selectedModel,
    providerReady,
    firstRunRequired,
    showProviderSetup: (required) => setView(required ? "thread" : "settings"),
    clearSubmissionError,
    sendNewThread,
    send,
    continueTurn: () =>
      continueTurn(selectedAccessMode, selectedProvider, selectedModel),
    addFollowUp,
    persistSubmittedThread,
    navigateHistory: navigateComposerHistory,
  });
  const {
    dismissErrors: dismissComposerErrors,
    submit,
    rewriteQuestion,
    handleCompositionStart,
    handleCompositionEnd,
    handleKeyDown,
  } = composerRuntime;

  function closeConversationPanels() {
    setTerminalOpen(false);
    setWorkspacePanelOpen(false);
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

  const viewModel: AppViewModel = {
    app,
    navigation,
    navigationRuntime,
    sessionApi,
    state,
    taskSession,
    taskRuntime: taskSessionRuntime,
    composer,
    composerRuntime,
    attachments,
    capabilities: capabilityController,
    voice,
    computer,
    delivery,
    productivity: taskProductivity,
    currentProject,
    currentConversation,
    providerReady,
    firstRunRequired,
    showFirstRunGuide,
    selectedAccessMode,
    selectedProvider,
    selectedModel,
    setConversationModel,
    headerTitle,
    draftStatus,
    runFirstDemoTask,
    requestMissingThreadMetadataDelete,
    confirmDeleteConversation,
    confirmDeleteProject,
  };

  return <ThreadlightAppView model={viewModel} />;
}
