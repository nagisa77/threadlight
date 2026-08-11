export {
  clampWorkspacePanelWidth,
  composerProviderIsReady,
  ComputerPermissionCard,
  ConversationChangesButton,
  currentPlanStep,
  filterProjectsForPicker,
  filterProjectsForTaskList,
  NewTaskProjectPrompt,
  pendingComputerPermissionResume,
  planDocumentOpenRequest,
  ProjectPickerPopover,
  RuntimeStatusControl,
  TaskSearchDialog,
  ThreadlightApp,
  TurnStatusPill,
} from "./app.js";
export { activeProject } from "./projects.js";
export { Dialog } from "./dialog.js";
export type { DialogProps } from "./dialog.js";
export {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
} from "./popover.js";
export type { PopoverPosition } from "./popover.js";
export {
  fileReaderReference,
  MarkdownContent,
  localFileContextMenuPosition,
  parseLocalFileReference,
  workspaceFileReference,
} from "./markdown.js";
export { MemoryDocument, ProjectMemoryPage } from "./memory.js";
export { CommandPalette, paletteEntryMatches } from "./command-palette.js";
export {
  DiagnosticExportDialog,
  DiagnosticsPage,
  downloadDiagnosticBundle,
  exportSingleConversationDiagnostic,
  formatDuration,
} from "./diagnostics.js";
export { AutomationsPage } from "./automations.js";
export {
  initialSessionState,
  sessionReducer,
  useThreadlightSession,
} from "./session.js";
export { isNearBottom } from "./scroll.js";
export {
  I18nProvider,
  LANGUAGE_OPTIONS,
  SUPPORTED_LANGUAGES,
  isLanguage,
  useI18n,
} from "./i18n.js";
export {
  THEME_PREFERENCES,
  ThemeProvider,
  isThemePreference,
  useTheme,
} from "./theme.js";
export {
  SettingsPage,
  ThemePicker,
  createSettingsUpdate,
  providerIsConfigured,
  providerIsConfiguredFor,
} from "./settings.js";
export {
  FirstRunGuide,
  firstRunInitialStep,
  firstRunProviderBaseUrl,
  firstRunSettingsUpdate,
} from "./first-run.js";
export type { FirstRunStep } from "./first-run.js";
export {
  ConversationAccessControl,
  ConversationAccessPopover,
  ExecutionApprovalGate,
  ExecutionPolicyPage,
  type ExecutionApprovalRequest,
  type ExecutionApprovalScope,
  type ExecutionPolicyAdapter,
  type ExecutionPolicySnapshot,
} from "./execution-policy.js";
export { TerminalPanel } from "./terminal.js";
export {
  ProjectOpenControl,
  ProjectOpenerIcon,
  resolvePreferredProjectOpener,
} from "./project-opener.js";
export {
  buildChangeTree,
  FileSource,
  formatFileSize,
  GitHubDeliveryCard,
  ReviewChangesTree,
  ReviewView,
  WorkspacePanel,
  WorkspaceTree,
} from "./workspace-panel.js";
export {
  appendVoiceTranscript,
  preferredRecordingMimeType,
  voiceInputErrorMessage,
} from "./voice-input.js";

export type { TaskListFilter, ThreadlightAppProps } from "./app.js";
export type {
  AttachmentPreviewAdapter,
  AttachmentStageAdapter,
  ClipboardAdapter,
  ConnectorAuthorizationAdapter,
  ComputerPermissionAdapter,
  ComputerPermissionCapability,
  ComputerPermissionSnapshot,
  ComputerShareAdapter,
  ComputerShareSnapshot,
  ComputerShareTarget,
} from "./app.js";
export type {
  ConversationSummary,
  ConversationMetadataUpdate,
  ConversationStatus,
  ConversationSummaryTarget,
  ConversationSummaryUpdate,
  HostSummary,
  HostsSnapshot,
  ProjectSummary,
  ProjectsAdapter,
  ProjectsSnapshot,
  TaskWorkspace,
} from "./projects.js";
export type {
  FileReaderReference,
  LocalFileReference,
  MarkdownContentProps,
  WorkspaceFileReference,
} from "./markdown.js";
export type { ProjectMemoryAdapter, ProjectMemorySnapshot } from "./memory.js";
export type {
  CommandPaletteEntry,
  CommandPaletteMode,
  SearchAdapter,
  SearchResult,
} from "./command-palette.js";
export type {
  DiagnosticConversationOption,
  DiagnosticsAdapter,
  ProjectDiagnosticsSnapshot,
} from "./diagnostics.js";
export type {
  Automation,
  AutomationAdapter,
  AutomationCadence,
  AutomationCreateRequest,
  AutomationKind,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationsSnapshot,
  AutomationUpdateRequest,
} from "./automations.js";
export type {
  ConversationMessage,
  ConversationProgress,
  SessionAction,
  SessionState,
  ToolActivity,
} from "./session.js";
export type { ScrollMetrics } from "./scroll.js";
export type { Language, Translate } from "./i18n.js";
export type { ResolvedTheme, ThemePreference } from "./theme.js";
export type {
  ModelProviderId,
  ProviderDiagnostic,
  ProviderDiagnosticCode,
  ProviderSecretDrafts,
  ProviderTestRequest,
  SecretStorageBoundary,
  SettingsAdapter,
  SecretDraft,
  SearchProviderId,
  SearchSecretDrafts,
  SettingsSnapshot,
  SettingsUpdate,
} from "./settings.js";
export type { VoiceInputAdapter, VoiceRecording } from "./voice-input.js";
export type {
  TerminalAdapter,
  TerminalEvent,
  TerminalSessionInfo,
} from "./terminal.js";
export type {
  ProjectOpenerAdapter,
  ProjectOpenerId,
  ProjectOpenerOption,
} from "./project-opener.js";
export type {
  ConversationChangesSnapshot,
  ConversationFileChange,
  CodeHostCheck,
  CodeHostCommitPushResult,
  CodeHostDeliverySetupIssue,
  CodeHostDeliveryStatus,
  CodeHostPullRequest,
  CodeHostReviewComment,
  WorktreeDeliveryHistoryEntry,
  WorktreeDeliveryHistorySnapshot,
  WorktreeDeliveryConflict,
  WorktreeDeliveryPreflight,
  WorktreeDeliveryResult,
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFileOpenRequest,
} from "./workspace-panel.js";
