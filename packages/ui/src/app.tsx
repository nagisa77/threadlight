import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createBrowserUuid, type ThreadlightClient } from "@threadlight/client";
import type {
  AgentPlanData,
  AttachmentData,
  CapabilityDescriptor,
  ConnectorStatusData,
  ConversationAccessMode,
  HostDirectoryEntry,
  HostDirectoryListing,
  TurnMode,
} from "@threadlight/protocol";
import {
  Activity,
  ArrowUp,
  Archive,
  ArchiveRestore,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
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
  Mic,
  Monitor,
  NotebookText,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PencilLine,
  Pin,
  PinOff,
  PictureInPicture2,
  Plus,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Square,
  Terminal,
  TriangleAlert,
  Trash2,
  X,
} from "lucide-react";

import {
  CapabilityChips,
  CapabilityMenu,
  MessageCapabilityReceipts,
  ConnectorSetupDialog,
  capabilityQueryAt,
  connectorCapabilityForSelection,
  filterCapabilities,
  filterComposerAddActions,
  nextCapabilityIndex,
  removeCapabilityQuery,
  type CapabilityQuery,
  type ComposerAddAction,
} from "./capabilities.js";
import {
  newTaskDraftState,
  useThreadlightSession,
  type ConversationProgress,
  type ToolActivity,
} from "./session.js";
import {
  fileReaderReference,
  MarkdownContent,
  type LocalFileReference,
} from "./markdown.js";
import { ProjectMemoryPage, type ProjectMemoryAdapter } from "./memory.js";
import {
  CommandPalette,
  type CommandPaletteEntry,
  type CommandPaletteMode,
  type SearchAdapter,
} from "./command-palette.js";
import { isNearBottom } from "./scroll.js";
import {
  isCommandPaletteShortcut,
  isFileSearchShortcut,
  isTogglePanelShortcut,
} from "./keyboard-shortcuts.js";
import type { SettingsAdapter, SettingsSnapshot } from "./settings.js";
import { providerIsConfigured } from "./settings-readiness.js";
import {
  ConversationAccessControl,
  ExecutionApprovalGate,
  ExecutionPolicyPage,
  type ExecutionPolicyAdapter,
} from "./execution-policy.js";
import { DiagnosticsPage, type DiagnosticsAdapter } from "./diagnostics.js";
import type { AutomationAdapter } from "./automations.js";
import {
  I18nProvider,
  isLanguage,
  useI18n,
  type Language,
  type Translate,
} from "./i18n.js";
import {
  ThemeProvider,
  isThemePreference,
  type ThemePreference,
} from "./theme.js";
import type { TerminalAdapter } from "./terminal.js";
import { terminalWorkspaceContextLabel } from "./terminal-context.js";
import type {
  AutomaticDeliveryState,
  ConversationChangesSnapshot,
  WorkspaceAdapter,
  WorkspaceFileOpenRequest,
} from "./workspace-panel.js";
import {
  MAX_VOICE_AUDIO_BYTES,
  appendVoiceTranscript,
  preferredRecordingMimeType,
  voiceInputErrorMessage,
  type VoiceInputAdapter,
} from "./voice-input.js";
import {
  activeProject,
  projectsWithDeliveryStatus,
  type ConversationSummary,
  type HostSummary,
  type HostsSnapshot,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "./projects.js";
import {
  automaticDeliveryFromHistory,
  DeliveryTurnStatus,
} from "./delivery-turn-status.js";
import {
  ProjectOpenControl,
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

import {
  ComputerPermissionCard,
  ComputerShareStatus,
  MessageActions,
  TurnStatusPill,
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
  clampWorkspacePanelWidth,
  conversationChangesRefreshKey,
  pendingComputerPermissionResume,
  planDocumentOpenRequest,
} from "./features/turn-status.js";
import {
  ProjectGroup,
  ProjectListHeading,
  RecentTasksGroup,
  RuntimeStatusControl,
  TaskSearchDialog,
  conversationContextChanged,
  filterProjectsForTaskList,
  ownsActiveComputerShare,
  type TaskListFilter,
} from "./features/project-sidebar.js";
import {
  ActivityList,
  ComposerAttachments,
  ConnectionError,
  MessageAttachments,
  ProgressList,
  attachmentHint,
  composerSubmitDelivery,
  connectionLabel,
  errorMessage,
  hasFiles,
  hasUserInput,
  projectContainingThread,
  shortId,
} from "./features/conversation-content.js";
export {
  ComputerPermissionCard,
  ComputerShareStatus,
  ConversationChangesButton,
  MessageActions,
  TurnStatusPill,
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
  clampWorkspacePanelWidth,
  conversationChangesRefreshKey,
  currentPlanStep,
  pendingComputerPermissionResume,
  planDocumentOpenRequest,
  writeClipboardText,
} from "./features/turn-status.js";
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
} from "./features/project-sidebar.js";
export {
  ActivityList,
  MessageAttachments,
  ProgressList,
  composerSubmitDelivery,
  hasUserInput,
  projectContainingThread,
} from "./features/conversation-content.js";

import {
  DeleteConversationDialog,
  EmptyState,
  ProjectEmptyState,
  ProjectPickerPopover,
  RemoteProjectPathDialog,
  RemoteRuntimeDialog,
} from "./features/project-dialogs.js";
export {
  DeleteConversationDialog,
  EmptyState,
  NewTaskProjectPrompt,
  ProjectPickerPopover,
  RemoteRuntimeDialog,
  filterProjectsForPicker,
} from "./features/project-dialogs.js";

const LazyFirstRunGuide = lazy(() =>
  import("./first-run.js").then(({ FirstRunGuide }) => ({
    default: FirstRunGuide,
  })),
);
const LazySettingsPage = lazy(() =>
  import("./settings.js").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);
const LazyAutomationsPage = lazy(() =>
  import("./automations.js").then(({ AutomationsPage }) => ({
    default: AutomationsPage,
  })),
);
const LazyWorkspacePanel = lazy(() =>
  import("./workspace-panel.js").then(({ WorkspacePanel }) => ({
    default: WorkspacePanel,
  })),
);
const LazyTerminalPanel = lazy(() =>
  import("./terminal.js").then(({ TerminalPanel }) => ({
    default: TerminalPanel,
  })),
);

function DeferredView({ label }: { label: string }) {
  return (
    <div className="deferred-view" role="status">
      <LoaderCircle className="spin" size={17} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function DeferredWorkspacePanel({
  hidden,
  label,
}: {
  hidden: boolean;
  label: string;
}) {
  return (
    <aside className="workspace-panel deferred-panel" hidden={hidden}>
      <DeferredView label={label} />
    </aside>
  );
}

function DeferredTerminalPanel({ label }: { label: string }) {
  return (
    <section className="terminal-panel panel-container deferred-panel">
      <DeferredView label={label} />
    </section>
  );
}

export interface ThreadlightAppProps {
  client: ThreadlightClient;
  initialThreadId?: string;
  onThreadChange?(threadId?: string): void;
  clipboard?: ClipboardAdapter;
  settings?: SettingsAdapter;
  diagnostics?: DiagnosticsAdapter;
  automations?: AutomationAdapter;
  projects?: ProjectsAdapter;
  memory?: ProjectMemoryAdapter;
  search?: SearchAdapter;
  voiceInput?: VoiceInputAdapter;
  connectorAuthorization?: ConnectorAuthorizationAdapter;
  attachmentStage?: AttachmentStageAdapter;
  attachmentPreview?: AttachmentPreviewAdapter;
  computerShare?: ComputerShareAdapter;
  computerPermissions?: ComputerPermissionAdapter;
  terminal?: TerminalAdapter;
  workspace?: WorkspaceAdapter;
  projectOpener?: ProjectOpenerAdapter;
  executionPolicy?: ExecutionPolicyAdapter;
}

export interface ClipboardAdapter {
  writeText(text: string): Promise<void>;
}

export interface ConnectorAuthorizationAdapter {
  authorize<Result>(action: () => Promise<Result>): Promise<Result>;
}

const COMPUTER_PERMISSION_RESUME_KEY = "threadlight:computer-permission-resume";
const COMPUTER_PERMISSION_RESUME_TTL_MS = 5 * 60 * 1_000;
const SIDEBAR_VISIBILITY_KEY = "threadlight:sidebar-visible";
const FIRST_RUN_COMPLETE_KEY = "threadlight:first-run-complete:v1";
const MOBILE_SIDEBAR_QUERY = "(max-width: 720px)";

export function sidebarStartsOpen(
  mobile: boolean,
  storedVisibility?: string | null,
): boolean {
  return !mobile && storedVisibility !== "false";
}

function isMobileSidebarViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
  );
}

function storedSidebarVisibility(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SIDEBAR_VISIBILITY_KEY);
  } catch {
    return null;
  }
}

export function firstRunIsComplete(stored?: string | null): boolean {
  return stored === "true";
}

export function composerProviderIsReady(
  settingsAvailable: boolean,
  runtimeSettings?: SettingsSnapshot,
): boolean {
  return settingsAvailable
    ? Boolean(runtimeSettings && providerIsConfigured(runtimeSettings))
    : true;
}

function storedFirstRunComplete(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return firstRunIsComplete(
      window.localStorage.getItem(FIRST_RUN_COMPLETE_KEY),
    );
  } catch {
    return false;
  }
}

function completeFirstRun(setCompleted: (completed: boolean) => void): void {
  try {
    window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, "true");
  } catch {
    // Persisted project history still prevents established users from looping.
  }
  setCompleted(true);
}

export interface AttachmentStageAdapter {
  stage(file: File): Promise<AttachmentData>;
}

export interface AttachmentPreviewAdapter {
  imageUrl(attachment: AttachmentData): string | undefined;
  loadImageUrl?(attachment: AttachmentData): Promise<string | undefined>;
}

export type ComputerPermissionCapability = "screen_recording" | "accessibility";

export interface ComputerPermissionSnapshot {
  required: boolean;
  blockingCapability?: ComputerPermissionCapability;
  ownerThreadId?: string;
  screenRecording:
    "not-determined" | "granted" | "denied" | "restricted" | "unknown";
  accessibility: "granted" | "denied";
  relaunchRequired: boolean;
}

export interface ComputerPermissionAdapter {
  load(): Promise<ComputerPermissionSnapshot>;
  request(
    capability: ComputerPermissionCapability,
  ): Promise<ComputerPermissionSnapshot>;
  relaunch(): Promise<void>;
  subscribe(
    listener: (snapshot: ComputerPermissionSnapshot) => void,
  ): () => void;
}

export interface ComputerShareTarget {
  id: string;
  name: string;
  applicationName?: string;
}

export interface ComputerShareSnapshot {
  active: boolean;
  pictureInPicture: boolean;
  ownerThreadId?: string;
  targets: readonly ComputerShareTarget[];
}

export interface ComputerShareAdapter {
  load(): Promise<ComputerShareSnapshot>;
  showPictureInPicture(): Promise<ComputerShareSnapshot>;
  stop(): Promise<ComputerShareSnapshot>;
  subscribe(listener: (snapshot: ComputerShareSnapshot) => void): () => void;
}

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
}

const MAX_COMPOSER_ATTACHMENTS = 10;

interface SuggestedQuestionsState {
  key: string;
  status: "loading" | "ready" | "error";
  suggestions: readonly string[];
}

export type VoiceInputStatus =
  "idle" | "requesting" | "recording" | "transcribing";

export function ThreadlightApp(props: ThreadlightAppProps) {
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [preferredProjectOpener, setPreferredProjectOpener] =
    useState<ProjectOpenerId>("");

  useEffect(() => {
    let active = true;
    void props.settings
      ?.load()
      .then((snapshot) => {
        if (active && isLanguage(snapshot.language))
          setLanguage(snapshot.language);
        if (active && isThemePreference(snapshot.theme))
          setTheme(snapshot.theme);
        if (active) {
          setPreferredProjectOpener(snapshot.preferredProjectOpener);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [props.settings]);

  return (
    <ThemeProvider preference={theme}>
      <I18nProvider language={language}>
        <ThreadlightAppContent
          {...props}
          onLanguageChange={setLanguage}
          onThemeChange={setTheme}
          preferredProjectOpener={preferredProjectOpener}
          onPreferredProjectOpenerChange={setPreferredProjectOpener}
        />
      </I18nProvider>
    </ThemeProvider>
  );
}

function ThreadlightAppContent({
  client,
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
  onThreadChange,
  onLanguageChange,
  onThemeChange,
  preferredProjectOpener,
  onPreferredProjectOpenerChange,
}: ThreadlightAppProps & {
  onLanguageChange(language: Language): void;
  onThemeChange(theme: ThemePreference): void;
  preferredProjectOpener: ProjectOpenerId;
  onPreferredProjectOpenerChange(opener: ProjectOpenerId): void;
}) {
  const { language, t } = useI18n();
  const initialMobileSidebar = isMobileSidebarViewport();
  const [mobileSidebar, setMobileSidebar] = useState(initialMobileSidebar);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    sidebarStartsOpen(initialMobileSidebar, storedSidebarVisibility()),
  );
  const sidebarCloseButton = useRef<HTMLButtonElement>(null);
  const sidebarOpenButton = useRef<HTMLButtonElement>(null);
  const {
    state: activeState,
    retry,
    openThread,
    newThread,
    deleteThread,
    send,
    sendNewThread,
    addFollowUp,
    reorderQueuedTurn,
    cancelQueuedTurn,
    interrupt,
    terminateProcess,
    runningThreadIds,
  } = useThreadlightSession(client, { autoConnect: !projects });
  const [newTaskDraft, setNewTaskDraft] = useState(false);
  const [newTaskDraftError, setNewTaskDraftError] = useState<string>();
  const state = newTaskDraft
    ? newTaskDraftState(activeState, newTaskDraftError)
    : activeState;
  const [view, setView] = useState<
    | "thread"
    | "memory"
    | "diagnostics"
    | "automations"
    | "security"
    | "settings"
  >("thread");
  const [input, setInput] = useState("");
  const [composerMode, setComposerMode] = useState<TurnMode>("default");
  const [capabilities, setCapabilities] = useState<
    readonly CapabilityDescriptor[]
  >([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    readonly CapabilityDescriptor[]
  >([]);
  const [capabilityQuery, setCapabilityQuery] = useState<CapabilityQuery>();
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [connectorSetup, setConnectorSetup] = useState<{
    capability: CapabilityDescriptor;
    selection: CapabilityDescriptor;
    status: ConnectorStatusData;
  }>();
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [connectorError, setConnectorError] = useState<string>();
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectsSnapshot>();
  const [runtimeSettings, setRuntimeSettings] = useState<SettingsSnapshot>();
  const [firstRunCompleted, setFirstRunCompleted] = useState(
    storedFirstRunComplete,
  );
  const [firstRunDemoThreadId, setFirstRunDemoThreadId] = useState<string>();
  const [firstRunRetryDemo, setFirstRunRetryDemo] = useState(false);
  const observedInitialProjects = useRef(false);
  const [hostSnapshot, setHostSnapshot] = useState<HostsSnapshot>();
  const [projectError, setProjectError] = useState<string>();
  const [switchingProject, setSwitchingProject] = useState(false);
  const [remoteRuntimeOpen, setRemoteRuntimeOpen] = useState(false);
  const [remoteProjectPathOpen, setRemoteProjectPathOpen] = useState(false);
  const [remoteRuntimeBusy, setRemoteRuntimeBusy] = useState(false);
  const [remoteRuntimeError, setRemoteRuntimeError] = useState<string>();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] =
    useState<CommandPaletteMode>("all");
  const [pendingSearchJump, setPendingSearchJump] = useState<{
    threadId: string;
    messageId?: string;
    activityId?: string;
  }>();
  const [pendingDelete, setPendingDelete] = useState<{
    projectId: string;
    conversation: ConversationSummary;
    mode?: "delete" | "discard";
  }>();
  const [deleteError, setDeleteError] = useState<string>();
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceInputStatus>("idle");
  const [voiceError, setVoiceError] = useState<string>();
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [preparingAttachments, setPreparingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [computerShareSnapshot, setComputerShareSnapshot] =
    useState<ComputerShareSnapshot>();
  const [computerShareError, setComputerShareError] = useState<string>();
  const [computerPermissionSnapshot, setComputerPermissionSnapshot] =
    useState<ComputerPermissionSnapshot>();
  const [computerPermissionBusy, setComputerPermissionBusy] = useState<
    ComputerPermissionCapability | "refresh" | "relaunch"
  >();
  const [computerPermissionError, setComputerPermissionError] =
    useState<string>();
  const [showingComputerShare, setShowingComputerShare] = useState(false);
  const [stoppingComputerShare, setStoppingComputerShare] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const workspacePanelMounted = useRef(false);
  if (workspacePanelOpen) workspacePanelMounted.current = true;
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState<number>();
  const [workspaceReviewRequest, setWorkspaceReviewRequest] = useState(0);
  const [workspaceDeliveryRequest, setWorkspaceDeliveryRequest] = useState(0);
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] =
    useState<WorkspaceFileOpenRequest>();
  const [conversationChanges, setConversationChanges] =
    useState<ConversationChangesSnapshot>();
  const [conversationChangesLoading, setConversationChangesLoading] =
    useState(false);
  const [conversationChangesError, setConversationChangesError] =
    useState<string>();
  const [automaticDeliveries, setAutomaticDeliveries] = useState<
    Record<string, AutomaticDeliveryState>
  >({});
  const [suggestedQuestions, setSuggestedQuestions] =
    useState<SuggestedQuestionsState>();
  const [suggestionRetry, setSuggestionRetry] = useState(0);
  const [projectOpeners, setProjectOpeners] = useState<
    readonly ProjectOpenerOption[]
  >([]);
  const conversationChangesRequest = useRef(0);
  const conversationChangesScope = useRef("");
  const activePlanDocument = useRef<string | undefined>(undefined);
  const deliveryAwaitingScopes = useRef(new Set<string>());
  const composerRoot = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const commandPaletteTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaRecorder = useRef<MediaRecorder | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const recordedChunks = useRef<Blob[]>([]);
  const voiceOperation = useRef(0);
  const dragDepth = useRef(0);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const conversation = useRef<HTMLElement>(null);
  const workspaceRoot = useRef<HTMLElement>(null);
  const followOutput = useRef(true);
  const projectSnapshotRef = useRef<ProjectsSnapshot | undefined>(undefined);
  const activeThreadIdRef = useRef<string | undefined>(undefined);
  const viewRef = useRef(view);
  const currentProject = activeProject(projectSnapshot);
  const currentHost = hostSnapshot?.hosts.find(
    (host) => host.id === hostSnapshot.activeHostId,
  );
  const currentConversation = currentProject?.conversations.find(
    (conversation) => conversation.id === state.threadId,
  );
  const automaticDeliveryScope =
    currentProject && state.threadId
      ? `${currentProject.id}\u0000${state.threadId}`
      : undefined;
  const automaticDelivery = automaticDeliveryScope
    ? automaticDeliveries[automaticDeliveryScope]
    : undefined;
  const currentWorkspacePath =
    currentConversation?.workspace?.path ?? currentProject?.basePath;
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
  const defaultTerminalWorkspace =
    currentConversation?.workspace?.mode === "worktree" ? "task" : "original";
  const defaultTerminalContext = terminalWorkspaceContextLabel(
    defaultTerminalWorkspace,
    defaultTerminalWorkspace === "task"
      ? taskTerminalBranch
      : originalTerminalBranch,
    t,
  );
  projectSnapshotRef.current = projectSnapshot;
  activeThreadIdRef.current = state.threadId;
  viewRef.current = view;
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
    if (!settings) return;
    let active = true;
    void settings
      .load()
      .then((snapshot) => {
        if (active) setRuntimeSettings(snapshot);
      })
      .catch(() => {
        // The settings page and Composer gate provide the actionable retry.
      });
    return () => {
      active = false;
    };
  }, [settings]);

  useEffect(() => {
    if (!projectSnapshot || observedInitialProjects.current) return;
    observedInitialProjects.current = true;
    const existingUser = projectSnapshot.projects.some((project) =>
      project.conversations.some(
        (conversation) =>
          conversation.status === "completed" ||
          conversation.status === undefined,
      ),
    );
    if (existingUser) completeFirstRun(setFirstRunCompleted);
  }, [projectSnapshot]);

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

  useEffect(() => {
    const storeDelivery = (
      delivery: {
        projectId: string;
        threadId: string;
        revision?: string;
        result?: AutomaticDeliveryState["result"];
        preflight?: AutomaticDeliveryState["preflight"];
        error?: string;
      },
      status: "syncing" | "synced" | "conflict" | "failed",
    ) => {
      const scope = `${delivery.projectId}\u0000${delivery.threadId}`;
      deliveryAwaitingScopes.current.delete(scope);
      setAutomaticDeliveries((current) => ({
        ...current,
        [scope]: {
          scope,
          revision: delivery.revision ?? current[scope]?.revision ?? "",
          status,
          ...(delivery.result ? { result: delivery.result } : {}),
          ...(delivery.preflight ? { preflight: delivery.preflight } : {}),
          ...(delivery.error ? { error: delivery.error } : {}),
        },
      }));
      setProjectSnapshot((snapshot) =>
        projectsWithDeliveryStatus(
          snapshot,
          delivery.projectId,
          delivery.threadId,
          status,
        ),
      );
      if (status !== "syncing" && projects) {
        void projects
          .load()
          .then(setProjectSnapshot)
          .catch(() => undefined);
      }
    };
    const unsubscribes = [
      client.on("delivery/syncing", (delivery) => {
        storeDelivery(delivery, "syncing");
      }),
      client.on("delivery/synced", (delivery) => {
        storeDelivery(delivery, "synced");
      }),
      client.on("delivery/conflict", (delivery) => {
        storeDelivery(delivery, "conflict");
      }),
      client.on("delivery/failed", (delivery) => {
        storeDelivery(delivery, "failed");
      }),
    ];
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [client, projects]);

  useEffect(() => {
    if (!state.isRunning || !automaticDeliveryScope) return;
    deliveryAwaitingScopes.current.add(automaticDeliveryScope);
    setAutomaticDeliveries((current) => {
      if (!current[automaticDeliveryScope]) return current;
      const next = { ...current };
      delete next[automaticDeliveryScope];
      return next;
    });
  }, [automaticDeliveryScope, state.isRunning]);

  useEffect(() => {
    if (
      state.isRunning ||
      !automaticDeliveryScope ||
      automaticDelivery ||
      deliveryAwaitingScopes.current.has(automaticDeliveryScope) ||
      !workspace?.getDeliveryHistory ||
      !currentProject ||
      !state.threadId ||
      currentConversation?.workspace?.mode !== "worktree"
    ) {
      return;
    }
    let active = true;
    void workspace
      .getDeliveryHistory(currentProject.id, state.threadId)
      .then((history) => {
        if (!active) return;
        const restored = automaticDeliveryFromHistory(
          automaticDeliveryScope,
          history,
        );
        if (!restored) return;
        setAutomaticDeliveries((current) =>
          current[automaticDeliveryScope]
            ? current
            : { ...current, [automaticDeliveryScope]: restored },
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    automaticDelivery,
    automaticDeliveryScope,
    currentConversation?.workspace?.mode,
    currentProject,
    state.isRunning,
    state.threadId,
    workspace,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setMobileSidebar(event.matches);
      setSidebarOpen(
        sidebarStartsOpen(event.matches, storedSidebarVisibility()),
      );
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (mobileSidebar || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_VISIBILITY_KEY, String(sidebarOpen));
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }, [mobileSidebar, sidebarOpen]);

  useEffect(() => {
    if (!mobileSidebar || !sidebarOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarOpen(false);
      requestAnimationFrame(() => sidebarOpenButton.current?.focus());
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobileSidebar, sidebarOpen]);

  useEffect(() => {
    if (!onThreadChange || !projectSnapshot) return;
    const navigableThreadId =
      !newTaskDraft &&
      activeState.threadId &&
      currentProject?.conversations.some(
        (item) => item.id === activeState.threadId,
      )
        ? activeState.threadId
        : undefined;
    onThreadChange(navigableThreadId);
  }, [
    activeState.threadId,
    currentProject?.conversations,
    newTaskDraft,
    onThreadChange,
    projectSnapshot,
  ]);

  useEffect(() => {
    return automations?.subscribeOpen?.((target) => {
      void selectConversation(target.projectId, target.id);
    });
  }, [automations, projectSnapshot, switchingProject, voiceStatus]);
  conversationChangesScope.current =
    currentProject && state.threadId
      ? `${currentProject.id}\u0000${state.threadId}`
      : "";
  const hasConversationChanges = Boolean(
    workspace &&
    currentProject &&
    conversationChanges &&
    conversationChanges.files.length > 0,
  );
  const suggestionKey = state.threadId
    ? `${state.threadId}\u0000${language}`
    : "";
  const selectedCapabilityIds = new Set(
    selectedCapabilities.flatMap(({ id, connectorRef }) =>
      connectorRef ? [id, connectorRef] : [id],
    ),
  );
  const filteredCapabilities = filterCapabilities(
    capabilities,
    capabilityQuery?.query ?? "",
    selectedCapabilityIds,
  );
  const addActions = filterComposerAddActions(
    attachmentStage && pendingAttachments.length < MAX_COMPOSER_ATTACHMENTS
      ? [
          {
            id: "attachment" as const,
            name: t("addAttachment"),
            description: t("addAttachmentDescription"),
            icon: "attachment" as const,
          },
        ]
      : [],
    capabilityQuery?.query ?? "",
  );
  const composerMenuItemCount = addActions.length + filteredCapabilities.length;
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

  useEffect(() => {
    if (!projects) return;
    let active = true;
    const refreshCompletedTask = (threadId: string) => {
      void projects
        .load()
        .then(async (snapshot) => {
          const project = snapshot.projects.find((candidate) =>
            candidate.conversations.some(
              (conversation) => conversation.id === threadId,
            ),
          );
          if (
            project &&
            projects.markConversationRead &&
            activeThreadIdRef.current === threadId &&
            viewRef.current === "thread" &&
            document.hasFocus()
          ) {
            return projects.markConversationRead({
              projectId: project.id,
              id: threadId,
            });
          }
          return snapshot;
        })
        .then((snapshot) => {
          if (active) setProjectSnapshot(snapshot);
        })
        .catch(() => {
          // The persisted marker will be reflected by the next project refresh.
        });
    };
    const unsubscribes = [
      client.on("thread/title", ({ threadId }) => {
        refreshCompletedTask(threadId);
      }),
      client.on("turn/completed", ({ threadId }) => {
        refreshCompletedTask(threadId);
      }),
      client.on("turn/failed", ({ threadId }) => {
        refreshCompletedTask(threadId);
      }),
    ];
    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [client, projects]);

  useEffect(() => {
    const markConversationRead = projects?.markConversationRead;
    if (!markConversationRead) return;
    const markVisibleConversationRead = () => {
      if (viewRef.current !== "thread") return;
      const threadId = activeThreadIdRef.current;
      const snapshot = projectSnapshotRef.current;
      const project = snapshot?.projects.find((candidate) =>
        candidate.conversations.some(
          (conversation) => conversation.id === threadId && conversation.unread,
        ),
      );
      if (!project || !threadId) return;
      void markConversationRead({ projectId: project.id, id: threadId })
        .then(setProjectSnapshot)
        .catch(() => {
          // A later project refresh can retry clearing the persisted marker.
        });
    };
    window.addEventListener("focus", markVisibleConversationRead);
    return () =>
      window.removeEventListener("focus", markVisibleConversationRead);
  }, [projects]);

  useEffect(() => {
    setSelectedCapabilities([]);
    setCapabilityQuery(undefined);
    setAddMenuOpen(false);
    setActiveCapabilityIndex(0);
    setConnectorSetup(undefined);
    setConnectorBusy(false);
    setConnectorError(undefined);
    if (state.connection !== "ready" || !state.threadId) {
      setCapabilities([]);
      setCapabilitiesLoading(false);
      return;
    }
    let active = true;
    setCapabilitiesLoading(true);
    void client
      .listCapabilities(state.threadId)
      .then(({ capabilities: next }) => {
        if (active) setCapabilities(next);
      })
      .catch(() => {
        if (active) setCapabilities([]);
      })
      .finally(() => {
        if (active) setCapabilitiesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, state.connection, state.threadId]);

  useEffect(() => {
    if (!capabilityQuery && !addMenuOpen) return;
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      if (!composerRoot.current?.contains(event.target as Node)) {
        setCapabilityQuery(undefined);
        setAddMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeFromOutside);
    return () => window.removeEventListener("pointerdown", closeFromOutside);
  }, [addMenuOpen, capabilityQuery]);

  useEffect(() => {
    if ((!capabilityQuery && !addMenuOpen) || composerMenuItemCount === 0) {
      return;
    }
    document
      .getElementById(
        `composer-capability-${Math.min(
          activeCapabilityIndex,
          composerMenuItemCount - 1,
        )}`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [
    addMenuOpen,
    activeCapabilityIndex,
    capabilityQuery,
    composerMenuItemCount,
  ]);

  const workspaceChangeRefreshKey = conversationChangesRefreshKey(
    state.progress,
  );

  useEffect(() => {
    if (!projectOpener) return;
    if (currentProject?.scope === "standalone") {
      setProjectOpeners([]);
      return;
    }
    let active = true;
    void projectOpener
      .load(currentProject?.id)
      .then((openers) => {
        if (active) setProjectOpeners(openers);
      })
      .catch(() => {
        if (active) setProjectOpeners([]);
      });
    return () => {
      active = false;
    };
  }, [currentProject?.id, currentProject?.scope, projectOpener]);

  useEffect(() => {
    const next = planDocumentOpenRequest(
      state.plan,
      state.threadId,
      activePlanDocument.current,
      (workspaceFileOpenRequest?.id ?? 0) + 1,
    );
    if (!next) {
      activePlanDocument.current = undefined;
      return;
    }
    if (!workspace || !currentProject || !state.threadId) return;

    activePlanDocument.current = next.documentKey;
    if (next.openPanel) setWorkspacePanelOpen(true);
    setWorkspaceFileOpenRequest(next.request);
  }, [
    currentProject?.id,
    state.plan?.documentPath,
    state.plan?.documentVersion,
    state.threadId,
    workspace,
  ]);

  useEffect(() => {
    if (
      state.connection !== "ready" ||
      !state.threadId ||
      state.messages.length > 0
    ) {
      return;
    }

    const key = `${state.threadId}\u0000${language}`;
    let active = true;
    setSuggestedQuestions({
      key,
      status: "loading",
      suggestions: [],
    });
    void client
      .suggestQuestions(state.threadId, language)
      .then(({ suggestions }) => {
        if (active) {
          setSuggestedQuestions({
            key,
            status: "ready",
            suggestions,
          });
        }
      })
      .catch(() => {
        if (active) {
          setSuggestedQuestions({
            key,
            status: "error",
            suggestions: [],
          });
        }
      });
    return () => {
      active = false;
    };
  }, [
    client,
    language,
    state.connection,
    state.messages.length,
    state.threadId,
    suggestionRetry,
  ]);

  const refreshConversationChanges = useCallback(
    async ({
      background = false,
    }: {
      background?: boolean;
    } = {}) => {
      const request = ++conversationChangesRequest.current;
      if (!workspace || !currentProject || !state.threadId) {
        setConversationChanges(undefined);
        setConversationChangesError(undefined);
        setConversationChangesLoading(false);
        return;
      }
      const projectId = currentProject.id;
      const threadId = state.threadId;
      const scope = `${projectId}\u0000${threadId}`;
      if (!background) {
        setConversationChangesLoading(true);
        setConversationChangesError(undefined);
      }
      try {
        const snapshot = await workspace.getChanges(projectId, threadId);
        if (
          request === conversationChangesRequest.current &&
          scope === conversationChangesScope.current
        ) {
          setConversationChanges(snapshot);
        }
      } catch (error) {
        if (
          !background &&
          request === conversationChangesRequest.current &&
          scope === conversationChangesScope.current
        ) {
          setConversationChangesError(errorMessage(error));
        }
      } finally {
        if (
          request === conversationChangesRequest.current &&
          scope === conversationChangesScope.current
        ) {
          setConversationChangesLoading(false);
        }
      }
    },
    [currentProject, state.threadId, workspace],
  );

  const restoreConversationChanges = useCallback(
    async (paths: readonly string[] | undefined, revision: string) => {
      if (
        !workspace?.restoreChanges ||
        !currentProject ||
        !state.threadId ||
        state.isRunning
      ) {
        throw new Error(t("restoreUnavailableWhileRunning"));
      }
      setConversationChangesLoading(true);
      setConversationChangesError(undefined);
      try {
        const snapshot = await workspace.restoreChanges(
          currentProject.id,
          state.threadId,
          revision,
          paths,
        );
        setConversationChanges(snapshot);
      } catch (error) {
        if (errorMessage(error).includes("workspace changed after this Diff")) {
          throw new Error(t("restoreConflict"));
        }
        throw error;
      } finally {
        setConversationChangesLoading(false);
      }
    },
    [currentProject, state.isRunning, state.threadId, t, workspace],
  );

  useEffect(() => {
    void refreshConversationChanges();
  }, [refreshConversationChanges, state.isRunning, state.messages.length]);

  const retryAutomaticDelivery = useCallback(async () => {
    if (
      !workspace?.applyDelivery ||
      !currentProject ||
      !state.threadId ||
      !automaticDelivery
    ) {
      return;
    }
    const scope = `${currentProject.id}\u0000${state.threadId}`;
    let revision = automaticDelivery.revision;
    try {
      const changes = await workspace.getChanges(
        currentProject.id,
        state.threadId,
      );
      revision = changes.revision;
      if (conversationChangesScope.current === scope) {
        setConversationChanges(changes);
      }
      await workspace.applyDelivery(
        currentProject.id,
        state.threadId,
        revision,
      );
    } catch (reason) {
      setAutomaticDeliveries((current) => ({
        ...current,
        [scope]: {
          ...(current[scope] ?? automaticDelivery),
          scope,
          revision,
          status: "failed",
          error: errorMessage(reason),
        },
      }));
    }
  }, [automaticDelivery, currentProject, state.threadId, workspace]);

  const undoAutomaticDelivery = useCallback(async () => {
    if (
      !workspace?.undoDelivery ||
      !currentProject ||
      !state.threadId ||
      !automaticDelivery ||
      automaticDelivery.status !== "synced"
    ) {
      return;
    }
    const current = automaticDelivery;
    const scope = current.scope;
    setAutomaticDeliveries((deliveries) => ({
      ...deliveries,
      [scope]: { ...current, status: "undoing" },
    }));
    try {
      await workspace.undoDelivery(
        currentProject.id,
        state.threadId,
        current.revision,
      );
      setAutomaticDeliveries((deliveries) => ({
        ...deliveries,
        [scope]: { ...current, status: "undone", result: undefined },
      }));
    } catch (reason) {
      setAutomaticDeliveries((deliveries) => ({
        ...deliveries,
        [scope]: {
          ...current,
          status: "failed",
          error: errorMessage(reason),
        },
      }));
    }
  }, [automaticDelivery, currentProject, state.threadId, workspace]);

  useEffect(() => {
    if (!workspaceChangeRefreshKey) return;
    void refreshConversationChanges({ background: true });
  }, [refreshConversationChanges, workspaceChangeRefreshKey]);

  useEffect(() => {
    if (!workspace) return;
    const handleFocus = () => void refreshConversationChanges();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshConversationChanges, workspace]);

  useEffect(() => {
    if (!terminal || !currentProject) return;
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (isTogglePanelShortcut(event)) {
        event.preventDefault();
        setTerminalOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [currentProject, terminal]);

  useEffect(() => {
    if (!workspace || !currentProject) return;
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (isTogglePanelShortcut(event, { shiftKey: true })) {
        event.preventDefault();
        setWorkspacePanelOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [currentProject, workspace]);

  useEffect(() => {
    if (!search || !currentProject) return;
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const mode = isCommandPaletteShortcut(event)
        ? "all"
        : isFileSearchShortcut(event)
          ? "files"
          : undefined;
      if (!mode) return;
      event.preventDefault();
      if (!switchingProject && voiceStatus === "idle") {
        openCommandPalette(mode);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [currentProject, search, switchingProject, voiceStatus]);

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);

  useEffect(
    () => () => {
      for (const attachment of pendingAttachmentsRef.current) {
        if (attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!computerShare) return;
    let active = true;
    const unsubscribe = computerShare.subscribe((snapshot) => {
      if (!active) return;
      setComputerShareSnapshot(snapshot);
      setComputerShareError(undefined);
    });
    void computerShare
      .load()
      .then((snapshot) => {
        if (!active) return;
        setComputerShareSnapshot(snapshot);
        setComputerShareError(undefined);
      })
      .catch((error) => {
        if (active) setComputerShareError(errorMessage(error));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [computerShare]);

  useEffect(() => {
    if (!computerPermissions) return;
    let active = true;
    const unsubscribe = computerPermissions.subscribe((snapshot) => {
      if (!active) return;
      setComputerPermissionSnapshot(snapshot);
      setComputerPermissionError(undefined);
    });
    void computerPermissions
      .load()
      .then((snapshot) => {
        if (!active) return;
        setComputerPermissionSnapshot(snapshot);
      })
      .catch((error) => {
        if (active) setComputerPermissionError(errorMessage(error));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [computerPermissions]);

  const requestComputerPermission = useCallback(
    async (capability: ComputerPermissionCapability) => {
      if (!computerPermissions) return;
      setComputerPermissionBusy(capability);
      setComputerPermissionError(undefined);
      try {
        setComputerPermissionSnapshot(
          await computerPermissions.request(capability),
        );
      } catch (error) {
        setComputerPermissionError(errorMessage(error));
      } finally {
        setComputerPermissionBusy(undefined);
      }
    },
    [computerPermissions],
  );

  const refreshComputerPermissions = useCallback(async () => {
    if (!computerPermissions) return;
    setComputerPermissionBusy("refresh");
    setComputerPermissionError(undefined);
    try {
      setComputerPermissionSnapshot(await computerPermissions.load());
    } catch (error) {
      setComputerPermissionError(errorMessage(error));
    } finally {
      setComputerPermissionBusy(undefined);
    }
  }, [computerPermissions]);

  const relaunchForComputerPermissions = useCallback(async () => {
    if (!computerPermissions) return;
    setComputerPermissionBusy("relaunch");
    setComputerPermissionError(undefined);
    try {
      const resumeThreadId =
        computerPermissionSnapshot?.ownerThreadId ?? state.threadId;
      if (resumeThreadId) {
        window.localStorage.setItem(
          COMPUTER_PERMISSION_RESUME_KEY,
          JSON.stringify({
            threadId: resumeThreadId,
            expiresAt: Date.now() + COMPUTER_PERMISSION_RESUME_TTL_MS,
          }),
        );
      }
      await computerPermissions.relaunch();
    } catch (error) {
      window.localStorage.removeItem(COMPUTER_PERMISSION_RESUME_KEY);
      setComputerPermissionError(errorMessage(error));
      setComputerPermissionBusy(undefined);
    }
  }, [
    computerPermissionSnapshot?.ownerThreadId,
    computerPermissions,
    state.threadId,
  ]);

  useEffect(() => {
    if (state.connection !== "ready" || state.isRunning || !state.threadId) {
      return;
    }
    const pending = pendingComputerPermissionResume(
      window.localStorage.getItem(COMPUTER_PERMISSION_RESUME_KEY),
      Date.now(),
    );
    if (!pending) {
      window.localStorage.removeItem(COMPUTER_PERMISSION_RESUME_KEY);
      return;
    }
    if (pending.threadId !== state.threadId) return;
    window.localStorage.removeItem(COMPUTER_PERMISSION_RESUME_KEY);
    void send(t("computerPermissionResumePrompt"));
  }, [send, state.connection, state.isRunning, state.threadId, t]);

  const stopComputerShare = useCallback(async (): Promise<boolean> => {
    if (!computerShare || !computerShareSnapshot?.active) return true;
    setStoppingComputerShare(true);
    setComputerShareError(undefined);
    try {
      setComputerShareSnapshot(await computerShare.stop());
      return true;
    } catch (error) {
      setComputerShareError(errorMessage(error));
      return false;
    } finally {
      setStoppingComputerShare(false);
    }
  }, [computerShare, computerShareSnapshot?.active]);

  const releaseVoiceCapture = useCallback(() => {
    const recorder = mediaRecorder.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    mediaRecorder.current = undefined;
    for (const track of mediaStream.current?.getTracks() ?? []) track.stop();
    mediaStream.current = undefined;
    recordedChunks.current = [];
  }, []);

  const cancelVoiceInput = useCallback(() => {
    voiceOperation.current += 1;
    releaseVoiceCapture();
    setVoiceStatus("idle");
    setVoiceError(undefined);
  }, [releaseVoiceCapture]);

  const connectProject = useCallback(
    async (snapshot: ProjectsSnapshot, preferredThreadId?: string) => {
      if (!projects) return;
      const project = activeProject(snapshot);
      if (!project) return;

      const requestedThreadId =
        preferredThreadId ??
        project.conversations.find((conversation) => !conversation.archivedAt)
          ?.id;
      const openedThreadId = await openThread(requestedThreadId);
      if (
        openedThreadId &&
        projects.markConversationRead &&
        project.conversations.some(
          (conversation) => conversation.id === openedThreadId,
        )
      ) {
        setProjectSnapshot(
          await projects.markConversationRead({
            projectId: project.id,
            id: openedThreadId,
          }),
        );
      }
    },
    [openThread, projects],
  );

  useEffect(() => {
    if (!projects) return;
    let active = true;
    void projects
      .loadHosts?.()
      .then((hosts) => {
        if (active) setHostSnapshot(hosts);
      })
      .catch(() => {
        // The project error below still leaves the connect form available.
      });
    void projects
      .load()
      .then(async (snapshot) => {
        if (!active) return;
        let nextSnapshot = snapshot;
        let preferredThreadId: string | undefined;
        const initialProject = projectContainingThread(
          snapshot,
          initialThreadId,
        );
        if (initialProject) {
          preferredThreadId = initialThreadId;
          if (initialProject.id !== snapshot.activeProjectId) {
            nextSnapshot = await projects.activate(initialProject.id);
          }
        }
        if (!active) return;
        setProjectSnapshot(nextSnapshot);
        await connectProject(nextSnapshot, preferredThreadId);
      })
      .catch((error) => {
        if (active) setProjectError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [connectProject, initialThreadId, projects]);

  useEffect(() => {
    const element = conversation.current;
    if (element && followOutput.current)
      element.scrollTop = element.scrollHeight;
  }, [state.messages.length, state.progress, state.streamingText]);

  useEffect(() => {
    if (
      !pendingSearchJump ||
      state.threadId !== pendingSearchJump.threadId ||
      (pendingSearchJump.messageId &&
        !state.messages.some(
          (message) => message.id === pendingSearchJump.messageId,
        ))
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target =
        (pendingSearchJump.activityId
          ? document.getElementById(`activity-${pendingSearchJump.activityId}`)
          : undefined) ??
        (pendingSearchJump.messageId
          ? document.getElementById(`message-${pendingSearchJump.messageId}`)
          : undefined);
      if (!target) return;
      followOutput.current = false;
      const details = target.closest("details");
      if (details instanceof HTMLDetailsElement) details.open = true;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      setPendingSearchJump(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingSearchJump, state.messages, state.threadId]);

  useEffect(
    () => () => {
      voiceOperation.current += 1;
      releaseVoiceCapture();
    },
    [releaseVoiceCapture],
  );

  async function startVoiceInput() {
    if (!voiceInput || voiceStatus !== "idle") return;
    const operation = ++voiceOperation.current;
    setVoiceError(undefined);
    setVoiceStatus("requesting");

    try {
      await voiceInput.prepare?.();
      if (operation !== voiceOperation.current) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(t("microphoneRecordingUnsupported"));
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error(t("voiceInputUnsupported"));
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (operation !== voiceOperation.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      mediaStream.current = stream;
      const mimeType = preferredRecordingMimeType((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorder.current = recorder;
      recordedChunks.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.current.push(event.data);
      };
      recorder.onerror = () => {
        if (operation !== voiceOperation.current) return;
        releaseVoiceCapture();
        setVoiceStatus("idle");
        setVoiceError(t("recordingInterrupted"));
      };
      recorder.onstop = () => {
        void finishVoiceInput(recorder, operation);
      };
      recorder.start();
      setVoiceStatus("recording");
    } catch (error) {
      if (operation !== voiceOperation.current) return;
      releaseVoiceCapture();
      setVoiceStatus("idle");
      setVoiceError(voiceInputErrorMessage(error, t));
    }
  }

  function stopVoiceInput() {
    const recorder = mediaRecorder.current;
    if (!recorder || voiceStatus !== "recording") return;
    setVoiceStatus("transcribing");
    if (recorder.state === "inactive") {
      void finishVoiceInput(recorder, voiceOperation.current);
    } else {
      recorder.stop();
    }
  }

  async function finishVoiceInput(recorder: MediaRecorder, operation: number) {
    if (
      !voiceInput ||
      operation !== voiceOperation.current ||
      recorder !== mediaRecorder.current
    ) {
      return;
    }
    setVoiceStatus("transcribing");
    const chunks = recordedChunks.current;
    const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
    mediaRecorder.current = undefined;
    for (const track of mediaStream.current?.getTracks() ?? []) track.stop();
    mediaStream.current = undefined;
    recordedChunks.current = [];

    try {
      const recording = new Blob(chunks, { type: mimeType });
      if (recording.size === 0) throw new Error(t("emptyRecording"));
      if (recording.size > MAX_VOICE_AUDIO_BYTES) {
        throw new Error(t("recordingTooLarge"));
      }
      const transcript = await voiceInput.transcribe({
        audio: await recording.arrayBuffer(),
        mimeType,
      });
      if (operation !== voiceOperation.current) return;
      setInput((value) => appendVoiceTranscript(value, transcript));
      requestAnimationFrame(() => {
        const element = textarea.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
        element.focus();
      });
    } catch (error) {
      if (operation === voiceOperation.current) {
        setVoiceError(voiceInputErrorMessage(error, t));
      }
    } finally {
      if (operation === voiceOperation.current) setVoiceStatus("idle");
    }
  }

  function addAttachments(files: readonly File[]) {
    if (
      !attachmentStage ||
      view !== "thread" ||
      state.isRunning ||
      preparingAttachments ||
      files.length === 0
    ) {
      return;
    }
    const available = Math.max(
      0,
      MAX_COMPOSER_ATTACHMENTS - pendingAttachmentsRef.current.length,
    );
    const additions = files.slice(0, available).map(
      (file) =>
        ({
          id: createBrowserUuid(),
          file,
          ...(file.type.startsWith("image/")
            ? { previewUrl: URL.createObjectURL(file) }
            : {}),
        }) satisfies PendingAttachment,
    );
    if (additions.length === 0) return;
    setAttachmentError(undefined);
    const next = [...pendingAttachmentsRef.current, ...additions];
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
  }

  function removeAttachment(id: string) {
    const attachment = pendingAttachmentsRef.current.find(
      (candidate) => candidate.id === id,
    );
    if (attachment?.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    const next = pendingAttachmentsRef.current.filter(
      (candidate) => candidate.id !== id,
    );
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    addAttachments(files);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!attachmentStage || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!attachmentStage || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFiles(false);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!attachmentStage || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingFiles(false);
    addAttachments([...event.dataTransfer.files]);
  }

  async function submit(
    value = input,
    followUpDelivery: "inject" | "queued" = "inject",
  ) {
    if (voiceStatus !== "idle" || preparingAttachments) return;
    if (!providerReady) {
      setView(firstRunRequired ? "thread" : "settings");
      return;
    }
    followOutput.current = true;
    if (state.isRunning) {
      if (await addFollowUp(value, followUpDelivery)) {
        setInput("");
        setCapabilityQuery(undefined);
        if (textarea.current) textarea.current.style.height = "auto";
      }
      return;
    }
    const draftAttachments = [...pendingAttachmentsRef.current];
    let stagedAttachments: AttachmentData[] = [];
    if (draftAttachments.length > 0) {
      if (!attachmentStage) return;
      setPreparingAttachments(true);
      setAttachmentError(undefined);
      try {
        stagedAttachments = await Promise.all(
          draftAttachments.map((attachment) =>
            attachmentStage.stage(attachment.file),
          ),
        );
      } catch (error) {
        setAttachmentError(errorMessage(error));
        return;
      } finally {
        setPreparingAttachments(false);
      }
    }
    let submittedThreadId: string | undefined;
    if (newTaskDraft) {
      const result = await sendNewThread(
        value,
        stagedAttachments,
        composerMode,
        selectedCapabilities,
        "approval",
      );
      if (result) {
        if ("error" in result) {
          setNewTaskDraftError(result.error);
        } else {
          setNewTaskDraft(false);
          setNewTaskDraftError(undefined);
          if (result.sent) submittedThreadId = result.threadId;
        }
      }
    } else if (
      await send(
        value,
        stagedAttachments,
        composerMode,
        selectedCapabilities,
        currentConversation?.accessMode ?? "approval",
      )
    ) {
      submittedThreadId = state.threadId;
    }
    if (submittedThreadId) {
      for (const attachment of draftAttachments) {
        if (attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      setInput("");
      setComposerMode("default");
      setSelectedCapabilities([]);
      setCapabilityQuery(undefined);
      setAttachmentError(undefined);
      pendingAttachmentsRef.current = [];
      setPendingAttachments([]);
      if (textarea.current) textarea.current.style.height = "auto";
      if (projects && currentProject) {
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
  }

  function rewriteQuestion(value: string) {
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

  function showSidebar() {
    setSidebarOpen(true);
    requestAnimationFrame(() => sidebarCloseButton.current?.focus());
  }

  function hideSidebar(restoreFocus = false) {
    setSidebarOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => sidebarOpenButton.current?.focus());
    }
  }

  function closeSidebarForNavigation() {
    if (mobileSidebar) hideSidebar();
  }

  async function createThread() {
    if (!currentProject || voiceStatus !== "idle") return;
    closeSidebarForNavigation();
    setView("thread");
    if (newTaskDraft || !hasUserInput(activeState.messages)) {
      textarea.current?.focus();
      return;
    }
    closeConversationPanels();
    setNewTaskDraftError(undefined);
    setNewTaskDraft(true);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  async function createProjectThread(projectId: string) {
    if (projectId === currentProject?.id) {
      await createThread();
      return;
    }
    if (!projects || switchingProject || voiceStatus !== "idle") return;
    closeSidebarForNavigation();
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      const snapshot = await projects.activate(projectId);
      setProjectSnapshot(snapshot);
      closeConversationPanels();
      setView("thread");
      setNewTaskDraftError(undefined);
      setNewTaskDraft(true);
      requestAnimationFrame(() => textarea.current?.focus());
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function createStandaloneThread() {
    if (
      !projects?.createStandalone ||
      switchingProject ||
      voiceStatus !== "idle"
    ) {
      return;
    }
    closeSidebarForNavigation();
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      const snapshot = await projects.createStandalone();
      const standalone = snapshot.projects.find(
        (project) => project.scope === "standalone",
      );
      setProjectSnapshot(snapshot);
      closeConversationPanels();
      setView("thread");
      await connectProject(snapshot);
      if (
        standalone?.conversations.some(
          (conversation) => !conversation.archivedAt,
        )
      ) {
        await newThread();
      }
      requestAnimationFrame(() => textarea.current?.focus());
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function openProjectView(
    projectId: string,
    nextView: "memory" | "diagnostics" | "security",
  ) {
    cancelVoiceInput();
    if (projectId !== currentProject?.id) {
      if (!(await selectConversation(projectId))) return;
    }
    setView(nextView);
    closeSidebarForNavigation();
  }

  async function toggleProjectPinned(project: ProjectSummary) {
    if (!projects?.updateProject) return;
    setProjectError(undefined);
    try {
      setProjectSnapshot(
        await projects.updateProject({
          id: project.id,
          pinned: !project.pinnedAt,
        }),
      );
    } catch (error) {
      setProjectError(errorMessage(error));
      throw error;
    }
  }

  async function revealProjectInFinder(project: ProjectSummary) {
    if (project.runtime?.kind === "remote" || !workspace?.revealSystemFile) {
      return;
    }
    setProjectError(undefined);
    try {
      await workspace.revealSystemFile(project.basePath);
    } catch (error) {
      setProjectError(errorMessage(error));
      throw error;
    }
  }

  function openCommandPalette(mode: CommandPaletteMode = "all") {
    if (
      !search ||
      !currentProject ||
      switchingProject ||
      voiceStatus !== "idle"
    ) {
      return;
    }
    setCommandPaletteMode(mode);
    setCommandPaletteOpen(true);
  }

  function closeCommandPalette(restoreFocus = true) {
    setCommandPaletteOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => commandPaletteTrigger.current?.focus());
    }
  }

  async function selectCommandPaletteEntry(entry: CommandPaletteEntry) {
    closeCommandPalette(false);
    if (entry.kind === "action") {
      if (entry.actionId === "new-task") {
        await createThread();
      } else if (entry.actionId === "memory") {
        setView("memory");
      } else if (entry.actionId === "review") {
        setView("thread");
        openReviewPanel();
      } else if (entry.actionId === "workspace") {
        setWorkspacePanelOpen((open) => !open);
      } else if (entry.actionId === "terminal") {
        setTerminalOpen((open) => !open);
      } else if (entry.actionId === "diagnostics") {
        setView("diagnostics");
      } else if (entry.actionId === "automations") {
        setView("automations");
      } else if (entry.actionId === "settings") {
        setView("settings");
      }
      return;
    }
    if (entry.kind === "file" && entry.path) {
      setView("thread");
      setWorkspacePanelOpen(true);
      setWorkspaceFileOpenRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        path: entry.path!,
        source: "workspace",
        activate: true,
        ...(entry.line ? { line: entry.line } : {}),
      }));
      return;
    }
    if (entry.kind === "memory") {
      setView("memory");
      return;
    }
    if (entry.kind === "task" && entry.threadId && entry.projectId) {
      await selectConversation(entry.projectId, entry.threadId);
      return;
    }
    if (entry.threadId && entry.projectId) {
      setPendingSearchJump({
        threadId: entry.threadId,
        ...(entry.messageId ? { messageId: entry.messageId } : {}),
        ...(entry.activityId ? { activityId: entry.activityId } : {}),
      });
      await selectConversation(entry.projectId, entry.threadId);
    }
  }

  function closeConversationPanels() {
    setTerminalOpen(false);
    setWorkspacePanelOpen(false);
  }

  async function openProjectFolder(path?: string) {
    if (!projects || switchingProject || voiceStatus !== "idle") {
      return;
    }
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      if (currentHost?.kind === "remote" && !path) {
        setRemoteProjectPathOpen(true);
        return;
      }
      const snapshot = await projects.openFolder(path);
      setRemoteProjectPathOpen(false);
      setProjectSnapshot(snapshot);
      setView("thread");
      if (snapshot.activeProjectId === projectSnapshot?.activeProjectId) return;
      closeConversationPanels();
      await connectProject(snapshot);
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function runFirstDemoTask(accessMode: ConversationAccessMode) {
    if (!projects || !currentProject || !providerReady) {
      throw new Error(t("waitingForRuntime"));
    }
    const result = await sendNewThread(
      t("firstRunDemoPrompt"),
      [],
      "default",
      [],
      accessMode,
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
        projectId: currentProject.id,
        id: result.threadId,
        title: t("demoTask"),
      }),
    );
  }

  async function connectRemoteRuntime(input: {
    endpoint: string;
    token: string;
    name?: string;
  }) {
    if (!projects?.connectRemote || remoteRuntimeBusy) return;
    setRemoteRuntimeBusy(true);
    setRemoteRuntimeError(undefined);
    setProjectError(undefined);
    try {
      const hosts = await projects.connectRemote(input);
      setHostSnapshot(hosts);
      await refreshHostSettings();
      const snapshot = await projects.load();
      setProjectSnapshot(snapshot);
      setRemoteRuntimeOpen(false);
      setView("thread");
      closeConversationPanels();
      await connectProject(snapshot);
    } catch (error) {
      setRemoteRuntimeError(errorMessage(error));
    } finally {
      setRemoteRuntimeBusy(false);
    }
  }

  async function activateHost(hostId: string) {
    if (!projects?.activateHost || switchingProject) return;
    setSwitchingProject(true);
    setProjectError(undefined);
    setRemoteRuntimeError(undefined);
    try {
      const hosts = await projects.activateHost(hostId);
      await refreshHostSettings();
      const snapshot = await projects.load();
      setHostSnapshot(hosts);
      setProjectSnapshot(snapshot);
      setRemoteRuntimeOpen(false);
      setView("thread");
      closeConversationPanels();
      await connectProject(snapshot);
    } catch (error) {
      setRemoteRuntimeError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function updateRemoteHost(input: {
    hostId: string;
    endpoint: string;
    token?: string;
    name?: string;
  }) {
    if (!projects?.updateRemoteHost || remoteRuntimeBusy) return;
    const updatingActiveHost = hostSnapshot?.activeHostId === input.hostId;
    setRemoteRuntimeBusy(true);
    setRemoteRuntimeError(undefined);
    setProjectError(undefined);
    try {
      const hosts = await projects.updateRemoteHost(input);
      setHostSnapshot(hosts);
      if (updatingActiveHost) {
        await refreshHostSettings();
        const snapshot = await projects.load();
        setProjectSnapshot(snapshot);
        closeConversationPanels();
        await connectProject(snapshot);
      }
      setRemoteRuntimeOpen(false);
    } catch (error) {
      setRemoteRuntimeError(errorMessage(error));
    } finally {
      setRemoteRuntimeBusy(false);
    }
  }

  async function deleteRemoteHost(hostId: string) {
    if (!projects?.deleteRemoteHost || switchingProject) return;
    const deletingActiveHost = hostSnapshot?.activeHostId === hostId;
    setSwitchingProject(true);
    setProjectError(undefined);
    setRemoteRuntimeError(undefined);
    try {
      const hosts = await projects.deleteRemoteHost(hostId);
      setHostSnapshot(hosts);
      if (deletingActiveHost) {
        await refreshHostSettings();
        const snapshot = await projects.load();
        setProjectSnapshot(snapshot);
        setView("thread");
        closeConversationPanels();
        await connectProject(snapshot);
      }
    } catch (error) {
      setRemoteRuntimeError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function refreshHostSettings() {
    if (!settings) return;
    const snapshot = await settings.load();
    setRuntimeSettings(snapshot);
    if (isLanguage(snapshot.language)) onLanguageChange(snapshot.language);
    if (isThemePreference(snapshot.theme)) onThemeChange(snapshot.theme);
    onPreferredProjectOpenerChange(snapshot.preferredProjectOpener);
  }

  async function updateConversationMetadata(
    projectId: string,
    conversation: ConversationSummary,
    update: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      accessMode?: ConversationAccessMode;
    },
  ) {
    if (!projects) return;
    setProjectError(undefined);
    try {
      const snapshot = await projects.updateConversation({
        projectId,
        id: conversation.id,
        ...update,
      });
      setProjectSnapshot(snapshot);
      if (
        update.archived === true &&
        projectId === projectSnapshot?.activeProjectId &&
        conversation.id === state.threadId
      ) {
        closeConversationPanels();
        setView("thread");
        await connectProject(snapshot);
      }
    } catch (error) {
      setProjectError(errorMessage(error));
      throw error;
    }
  }

  async function updateConversationAccessMode(
    accessMode: ConversationAccessMode,
  ) {
    if (!projects || !currentProject || !state.threadId) return;
    setProjectError(undefined);
    try {
      let snapshot = projectSnapshot;
      if (!currentConversation) {
        snapshot = await projects.upsertConversation({
          projectId: currentProject.id,
          id: state.threadId,
          title: t("task"),
        });
      }
      if (!snapshot) return;
      setProjectSnapshot(
        await projects.updateConversation({
          projectId: currentProject.id,
          id: state.threadId,
          accessMode,
        }),
      );
    } catch (error) {
      setProjectError(errorMessage(error));
      throw error;
    }
  }

  async function selectConversation(projectId: string, threadId?: string) {
    if (!projects || switchingProject || voiceStatus !== "idle") {
      return false;
    }
    closeSidebarForNavigation();
    setNewTaskDraftError(undefined);
    setNewTaskDraft(false);
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      let snapshot = projectSnapshot;
      if (projectId !== projectSnapshot?.activeProjectId) {
        snapshot = await projects.activate(projectId);
        setProjectSnapshot(snapshot);
      }
      if (!snapshot) return false;
      const nextProject = activeProject(snapshot);
      const nextThreadId =
        threadId ??
        nextProject?.conversations.find(
          (conversation) => !conversation.archivedAt,
        )?.id;
      if (
        conversationContextChanged(
          currentProject?.id,
          state.threadId,
          nextProject?.id,
          nextThreadId,
        )
      ) {
        closeConversationPanels();
      }
      setView("thread");
      await connectProject(snapshot, threadId);
      return true;
    } catch (error) {
      setProjectError(errorMessage(error));
      return false;
    } finally {
      setSwitchingProject(false);
    }
  }

  async function confirmDeleteConversation() {
    if (!projects || !pendingDelete || deletingConversation) return;
    const target = pendingDelete;
    if (runningThreadIds.includes(target.conversation.id)) return;
    const deletingActiveConversation =
      target.projectId === projectSnapshot?.activeProjectId &&
      target.conversation.id === state.threadId;
    setDeletingConversation(true);
    setDeleteError(undefined);

    try {
      if (deletingActiveConversation && !(await stopComputerShare())) {
        return;
      }
      if (target.mode === "discard" && !target.conversation.archivedAt) {
        await projects.updateConversation({
          projectId: target.projectId,
          id: target.conversation.id,
          archived: true,
        });
      }
      if (target.projectId === projectSnapshot?.activeProjectId) {
        await deleteThread(target.conversation.id);
      }
      const snapshot = await projects.deleteConversation({
        projectId: target.projectId,
        id: target.conversation.id,
      });
      setProjectSnapshot(snapshot);
      setPendingDelete(undefined);
      if (deletingActiveConversation) {
        closeConversationPanels();
        setView("thread");
        await connectProject(snapshot);
      }
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeletingConversation(false);
    }
  }

  async function reconnectRuntime() {
    if (currentProject || !projects) await retry();
  }

  async function showComputerSharePreview() {
    if (!computerShare || showingComputerShare) return;
    setShowingComputerShare(true);
    setComputerShareError(undefined);
    try {
      setComputerShareSnapshot(await computerShare.showPictureInPicture());
    } catch (error) {
      setComputerShareError(errorMessage(error));
    } finally {
      setShowingComputerShare(false);
    }
  }

  function stopRunningTurn() {
    void interrupt();
  }

  function openReviewPanel() {
    setWorkspacePanelOpen(true);
    setWorkspaceReviewRequest((request) => request + 1);
    void refreshConversationChanges();
  }

  function openDeliveryCenter() {
    setWorkspacePanelOpen(true);
    setWorkspaceDeliveryRequest((request) => request + 1);
  }

  function openLocalFile(reference: LocalFileReference) {
    if (!workspace || !currentProject || !currentWorkspacePath) return;
    const file = fileReaderReference(reference, currentWorkspacePath);
    if (!file) return;
    if (file.source === "system" && !workspace.readSystemFile) return;
    setWorkspacePanelOpen(true);
    setWorkspaceFileOpenRequest((current) => ({
      ...file,
      id: (current?.id ?? 0) + 1,
    }));
  }

  async function revealLocalFile(reference: LocalFileReference) {
    if (!workspace || !currentProject || !currentWorkspacePath) return;
    const file = fileReaderReference(reference, currentWorkspacePath);
    if (!file) throw new Error(t("fileOutsideProject"));
    if (file.source === "system") {
      if (!workspace.revealSystemFile) {
        throw new Error(t("systemFileAccessUnavailable"));
      }
      await workspace.revealSystemFile(file.path);
      return;
    }
    if (!workspace.reveal) {
      throw new Error(t("systemFileAccessUnavailable"));
    }
    await workspace.reveal(currentProject.id, file.path, state.threadId);
  }

  function beginWorkspacePanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const workspaceElement = workspaceRoot.current;
    if (!workspaceElement || event.button !== 0) return;

    event.preventDefault();
    const handle = event.currentTarget;
    const bounds = workspaceElement.getBoundingClientRect();
    let nextWidth = clampWorkspacePanelWidth(
      bounds.right - event.clientX,
      bounds.width,
    );

    const updateWidth = (clientX: number) => {
      nextWidth = clampWorkspacePanelWidth(
        bounds.right - clientX,
        bounds.width,
      );
      workspaceElement.style.gridTemplateColumns = `minmax(360px, 1fr) ${nextWidth}px`;
    };
    const handleMove = (pointerEvent: globalThis.PointerEvent) => {
      updateWidth(pointerEvent.clientX);
    };
    const finish = () => {
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-resizing-workspace");
      setWorkspacePanelWidth(nextWidth);
    };

    updateWidth(event.clientX);
    document.body.classList.add("is-resizing-workspace");
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", finish, { once: true });
    handle.addEventListener("pointercancel", finish, { once: true });
  }

  function resizeWorkspacePanelBy(delta: number) {
    const workspaceElement = workspaceRoot.current;
    const panelElement =
      workspaceElement?.querySelector<HTMLElement>(".workspace-panel");
    if (!workspaceElement || !panelElement) return;
    const nextWidth = clampWorkspacePanelWidth(
      panelElement.getBoundingClientRect().width + delta,
      workspaceElement.getBoundingClientRect().width,
    );
    setWorkspacePanelWidth(nextWidth);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      voiceStatus === "idle"
    ) {
      event.preventDefault();
      void submit(input, composerSubmitDelivery(event, state.isRunning));
    }
  }

  function updateCapabilityQuery(value: string, cursor: number | null) {
    const nextQuery = capabilityQueryAt(value, cursor);
    setCapabilityQuery(nextQuery);
    if (nextQuery) setAddMenuOpen(false);
    setActiveCapabilityIndex(0);
  }

  function selectAddAction(action: ComposerAddAction) {
    setAddMenuOpen(false);
    setActiveCapabilityIndex(0);
    if (capabilityQuery) {
      const next = removeCapabilityQuery(input, capabilityQuery);
      setInput(next.value);
      setCapabilityQuery(undefined);
      requestAnimationFrame(() => {
        textarea.current?.setSelectionRange(next.cursor, next.cursor);
      });
    }
    fileInput.current?.click();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function selectCapability(capability: CapabilityDescriptor) {
    const next = capabilityQuery
      ? removeCapabilityQuery(input, capabilityQuery)
      : {
          value: input,
          cursor: textarea.current?.selectionStart ?? input.length,
        };
    if (capabilityQuery) setInput(next.value);
    setCapabilityQuery(undefined);
    setAddMenuOpen(false);
    setActiveCapabilityIndex(0);
    const connector = connectorCapabilityForSelection(capability, capabilities);
    if (connector && connector.status !== "ready") {
      void prepareConnector(capability, connector, next.cursor);
      return;
    }
    commitCapabilitySelection(capability, next.cursor);
  }

  function selectComposerMenuItem(index: number) {
    const action = addActions[index];
    if (action) {
      selectAddAction(action);
      return;
    }
    const capability = filteredCapabilities[index - addActions.length];
    if (capability) selectCapability(capability);
  }

  function commitCapabilitySelection(
    capability: CapabilityDescriptor,
    cursor?: number,
  ) {
    setSelectedCapabilities((current) =>
      current.some(({ id }) => id === capability.id)
        ? current
        : [...current, capability],
    );
    if (capability.id === "tool:plan") setComposerMode("plan");
    requestAnimationFrame(() => {
      textarea.current?.focus();
      if (cursor !== undefined) {
        textarea.current?.setSelectionRange(cursor, cursor);
      }
    });
  }

  async function prepareConnector(
    selection: CapabilityDescriptor,
    capability: CapabilityDescriptor,
    cursor: number,
    openWhenReady = false,
  ) {
    if (!state.threadId) return;
    setConnectorError(undefined);
    try {
      const status = await client.connectorStatus(
        state.threadId,
        capability.id,
      );
      const updated = { ...capability, status: status.status };
      updateCapabilityStatus(capability.id, status.status);
      if (status.status === "ready" && !openWhenReady) {
        commitCapabilitySelection({ ...selection, status: "ready" }, cursor);
        return;
      }
      setConnectorSetup({ capability: updated, selection, status });
    } catch (error) {
      setConnectorSetup({
        capability,
        selection,
        status: {
          capabilityId: capability.id,
          connectorId: capability.id.replace(/^mcp:/, ""),
          name: capability.name,
          status:
            capability.status === "needs_authorization"
              ? "needs_authorization"
              : "needs_configuration",
          configured: capability.status === "needs_authorization",
          authorized: false,
          redirectUrl: "",
        },
      });
      setConnectorError(errorMessage(error));
    }
  }

  function manageConnector(selection: CapabilityDescriptor) {
    const connector = connectorCapabilityForSelection(selection, capabilities);
    if (!connector) return;
    void prepareConnector(
      selection,
      connector,
      textarea.current?.selectionStart ?? input.length,
      true,
    );
  }

  function updateCapabilityStatus(
    capabilityId: string,
    status: CapabilityDescriptor["status"],
  ) {
    setCapabilities((current) =>
      current.map((capability) =>
        capability.id === capabilityId ? { ...capability, status } : capability,
      ),
    );
  }

  async function connectConnector(clientId: string, clientSecret: string) {
    if (!state.threadId || !connectorSetup) return;
    const { capability, selection } = connectorSetup;
    setConnectorBusy(true);
    setConnectorError(undefined);
    try {
      const authorize = async () => {
        let status = connectorSetup.status;
        if (!status.configured) {
          status = await client.configureConnector(
            state.threadId!,
            capability.id,
            clientId,
            clientSecret,
          );
          setConnectorSetup({
            capability: { ...capability, status: status.status },
            selection,
            status,
          });
          updateCapabilityStatus(capability.id, status.status);
        }
        status = await client.authorizeConnector(
          state.threadId!,
          capability.id,
        );
        const connected = { ...capability, status: status.status };
        updateCapabilityStatus(capability.id, status.status);
        if (status.status !== "ready") {
          setConnectorSetup({ capability: connected, selection, status });
          throw new Error(t("capabilityNeedsAuthorization"));
        }
        setConnectorSetup(undefined);
        commitCapabilitySelection({
          ...selection,
          status: "ready",
        });
      };
      if (connectorAuthorization) {
        await connectorAuthorization.authorize(authorize);
      } else {
        await authorize();
      }
    } catch (error) {
      setConnectorError(errorMessage(error));
    } finally {
      setConnectorBusy(false);
    }
  }

  async function disconnectConnector() {
    if (!state.threadId || !connectorSetup) return;
    const { capability, selection } = connectorSetup;
    setConnectorBusy(true);
    setConnectorError(undefined);
    try {
      const status = await client.disconnectConnector(
        state.threadId,
        capability.id,
      );
      updateCapabilityStatus(capability.id, status.status);
      setSelectedCapabilities((current) =>
        current.filter(({ id }) => id !== capability.id && id !== selection.id),
      );
      setConnectorSetup({
        capability: { ...capability, status: status.status },
        selection,
        status,
      });
    } catch (error) {
      setConnectorError(errorMessage(error));
    } finally {
      setConnectorBusy(false);
    }
  }

  const globalActions = currentProject ? (
    <>
      {currentProject.scope !== "standalone" &&
        projectOpener &&
        projectOpeners.length > 0 && (
          <ProjectOpenControl
            adapter={projectOpener}
            projectId={currentProject.id}
            threadId={state.threadId}
            preferred={preferredProjectOpener}
            openers={projectOpeners}
          />
        )}
      {terminal && (
        <button
          type="button"
          className={`header-terminal-button pressable ${terminalOpen ? "active" : ""}`}
          aria-label={`${terminalOpen ? t("closeTerminal") : t("openTerminal")} — ${defaultTerminalContext}`}
          aria-pressed={terminalOpen}
          title={`${terminalOpen ? t("closeTerminal") : t("openTerminal")} — ${defaultTerminalContext}（⌘J）`}
          onClick={() => setTerminalOpen((open) => !open)}
        >
          <Terminal size={16} />
        </button>
      )}
      {workspace && (
        <button
          type="button"
          className={`header-terminal-button pressable ${workspacePanelOpen ? "active" : ""}`}
          aria-label={
            workspacePanelOpen ? t("closeRightPanel") : t("openRightPanel")
          }
          aria-pressed={workspacePanelOpen}
          title={`${workspacePanelOpen ? t("closeRightPanel") : t("openRightPanel")}（⇧⌘J）`}
          onClick={() => setWorkspacePanelOpen((open) => !open)}
        >
          <PanelRight size={16} />
        </button>
      )}
    </>
  ) : null;
  const globalActionsInPanel = Boolean(
    workspacePanelOpen && workspace && currentProject,
  );

  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-hidden"}`}
    >
      {mobileSidebar && sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t("hideSidebar")}
          onClick={() => hideSidebar(true)}
        />
      )}
      <aside id="app-sidebar" className="sidebar" aria-hidden={!sidebarOpen}>
        <div className="window-drag-region" />
        <button
          ref={sidebarCloseButton}
          type="button"
          className="sidebar-collapse-button pressable"
          aria-label={t("hideSidebar")}
          title={t("hideSidebar")}
          onClick={() => hideSidebar(true)}
        >
          <PanelLeftClose size={16} />
        </button>
        <button
          className="new-thread-button project-row pressable"
          onClick={() => void createThread()}
          disabled={
            !currentProject ||
            state.connection !== "ready" ||
            switchingProject ||
            voiceStatus !== "idle"
          }
        >
          <SquarePen size={16} />
          <span>{t("newTask")}</span>
        </button>
        {automations &&
          currentProject &&
          currentProject.scope !== "standalone" && (
            <div className="sidebar-primary-nav">
              <button
                type="button"
                className={`scheduled-button project-row pressable ${view === "automations" ? "active" : ""}`}
                aria-current={view === "automations" ? "page" : undefined}
                disabled={switchingProject || voiceStatus !== "idle"}
                onClick={() => {
                  cancelVoiceInput();
                  setView("automations");
                  closeSidebarForNavigation();
                }}
              >
                <CalendarClock size={16} />
                <span>{t("scheduled")}</span>
              </button>
            </div>
          )}

        <nav className="thread-list" aria-label={t("projectsAndTasks")}>
          {projects ? (
            <>
              <ProjectListHeading
                searchTriggerRef={commandPaletteTrigger}
                searchDisabled={
                  !search ||
                  !currentProject ||
                  switchingProject ||
                  voiceStatus !== "idle"
                }
                addDisabled={switchingProject || voiceStatus !== "idle"}
                onSearch={() => openCommandPalette("all")}
                onAdd={() => void openProjectFolder()}
              />
              <div className="project-list-scroll">
                {sidebarProjects.map((project) => (
                  <ProjectGroup
                    key={project.id}
                    project={project}
                    active={project.id === projectSnapshot?.activeProjectId}
                    activeThreadId={state.threadId}
                    runningThreadIds={runningThreadIds}
                    computerThreadId={computerShareSnapshot?.ownerThreadId}
                    disabled={switchingProject || voiceStatus !== "idle"}
                    onNewTask={() => createProjectThread(project.id)}
                    onOpenMemory={
                      memory
                        ? () => openProjectView(project.id, "memory")
                        : undefined
                    }
                    onOpenSecurity={
                      executionPolicy
                        ? () => openProjectView(project.id, "security")
                        : undefined
                    }
                    onRevealInFinder={
                      project.runtime?.kind !== "remote" &&
                      workspace?.revealSystemFile
                        ? () => revealProjectInFinder(project)
                        : undefined
                    }
                    onToggleProjectPinned={
                      projects.updateProject
                        ? () => toggleProjectPinned(project)
                        : undefined
                    }
                    onOpenDiagnostics={
                      diagnostics
                        ? () => openProjectView(project.id, "diagnostics")
                        : undefined
                    }
                    onSelect={(threadId) =>
                      void selectConversation(project.id, threadId)
                    }
                    onRename={(conversation, title) =>
                      updateConversationMetadata(project.id, conversation, {
                        title,
                      })
                    }
                    onTogglePinned={(conversation) =>
                      updateConversationMetadata(project.id, conversation, {
                        pinned: !conversation.pinnedAt,
                      })
                    }
                    onArchive={(conversation, archived) =>
                      updateConversationMetadata(project.id, conversation, {
                        archived,
                      })
                    }
                    onDelete={(conversation) => {
                      setDeleteError(undefined);
                      setPendingDelete({ projectId: project.id, conversation });
                    }}
                  />
                ))}
                {standaloneProject &&
                  standaloneProject.conversations.some(
                    (conversation) => !conversation.archivedAt,
                  ) && (
                    <RecentTasksGroup
                      project={standaloneProject}
                      active={
                        standaloneProject.id ===
                        projectSnapshot?.activeProjectId
                      }
                      activeThreadId={state.threadId}
                      runningThreadIds={runningThreadIds}
                      computerThreadId={computerShareSnapshot?.ownerThreadId}
                      disabled={switchingProject || voiceStatus !== "idle"}
                      onSelect={(threadId) =>
                        void selectConversation(standaloneProject.id, threadId)
                      }
                      onRename={(conversation, title) =>
                        updateConversationMetadata(
                          standaloneProject.id,
                          conversation,
                          { title },
                        )
                      }
                      onTogglePinned={(conversation) =>
                        updateConversationMetadata(
                          standaloneProject.id,
                          conversation,
                          { pinned: !conversation.pinnedAt },
                        )
                      }
                      onArchive={(conversation, archived) =>
                        updateConversationMetadata(
                          standaloneProject.id,
                          conversation,
                          { archived },
                        )
                      }
                      onDelete={(conversation) => {
                        setDeleteError(undefined);
                        setPendingDelete({
                          projectId: standaloneProject.id,
                          conversation,
                        });
                      }}
                    />
                  )}
                {sidebarProjects.length === 0 &&
                !standaloneProject?.conversations.some(
                  (conversation) => !conversation.archivedAt,
                ) ? (
                  <div className="thread-placeholder">
                    {t("openFolderToStart")}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="section-label">{t("current")}</p>
              {state.threadId ? (
                <div className="thread-item active" aria-current="page">
                  <span className="thread-title">
                    {state.messages[0]?.text || t("task")}
                  </span>
                  <span className="thread-id">{shortId(state.threadId)}</span>
                </div>
              ) : (
                <div className="thread-placeholder">{t("preparingTask")}</div>
              )}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          {settings && (
            <button
              type="button"
              className={`settings-nav-button pressable ${view === "settings" ? "active" : ""}`}
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => {
                cancelVoiceInput();
                setView("settings");
                closeSidebarForNavigation();
              }}
            >
              <Settings size={15} />
              {t("settings")}
            </button>
          )}
          <RuntimeStatusControl
            status={currentProject || !projects ? state.connection : "idle"}
            label={
              currentHost?.name ??
              (currentProject || !projects
                ? connectionLabel(state.connection, t)
                : t("noProjectOpen"))
            }
            mode={`${currentHost?.kind === "remote" ? t("remoteHost") : t("local")} · ${
              currentProject || !projects
                ? connectionLabel(state.connection, t)
                : t("noProjectOpen")
            }`}
            disabled={switchingProject || voiceStatus !== "idle"}
            title={t("connectRemoteRuntime")}
            onOpen={
              projects?.connectRemote
                ? () => {
                    setRemoteRuntimeError(undefined);
                    setRemoteRuntimeOpen(true);
                  }
                : undefined
            }
          />
        </div>
      </aside>

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
                connectionReady={state.connection === "ready"}
                initialStep={firstRunRetryDemo ? "demo" : undefined}
                onSettingsSaved={setRuntimeSettings}
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
              <header className="workspace-header">
                <div
                  className="workspace-header-drag-region"
                  aria-hidden="true"
                />
                <div className="workspace-header-title">
                  <h1>{state.messages[0]?.text || t("task")}</h1>
                  <p>
                    {currentProject?.scope === "standalone"
                      ? t("notInProject")
                      : currentProject?.runtime?.kind === "remote"
                        ? `${t("remoteRuntime")} · ${currentProject.runtime.workspacePath}`
                        : (currentProject?.basePath ?? "Agent runtime")}{" "}
                    · {shortId(state.threadId)}
                  </p>
                </div>
                <div className="workspace-header-actions">
                  {state.isRunning && (
                    <span className="running-badge">
                      <LoaderCircle size={13} /> {t("running")}
                    </span>
                  )}
                </div>
              </header>

              <section
                ref={conversation}
                className={`conversation ${hasConversationChanges ? "has-conversation-changes" : ""}`}
                aria-live="polite"
                onScroll={(event) => {
                  followOutput.current = isNearBottom(event.currentTarget);
                }}
              >
                <div className="conversation-inner">
                  {state.connection === "error" && (
                    <ConnectionError
                      message={
                        state.connectionError ?? t("appServerConnectionFailed")
                      }
                      onRetry={() => void retry()}
                      onOpenSettings={
                        settings ? () => setView("settings") : undefined
                      }
                    />
                  )}

                  {state.messages.length === 0 &&
                  state.connection !== "error" ? (
                    <EmptyState
                      connecting={state.connection === "connecting"}
                      project={currentProject}
                      projects={(projectSnapshot?.projects ?? []).filter(
                        (project) => project.scope !== "standalone",
                      )}
                      suggestions={
                        suggestedQuestions?.key === suggestionKey
                          ? suggestedQuestions.suggestions
                          : []
                      }
                      suggestionsLoading={
                        state.connection === "ready" &&
                        (suggestedQuestions?.key !== suggestionKey ||
                          suggestedQuestions.status === "loading")
                      }
                      suggestionsFailed={
                        suggestedQuestions?.key === suggestionKey &&
                        suggestedQuestions.status === "error"
                      }
                      onRetrySuggestions={() =>
                        setSuggestionRetry((retry) => retry + 1)
                      }
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

                      {automaticDelivery && !state.isRunning && (
                        <DeliveryTurnStatus
                          delivery={automaticDelivery}
                          disabled={
                            automaticDelivery.status === "syncing" ||
                            automaticDelivery.status === "undoing"
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
                {(state.plan ||
                  (hasConversationChanges && conversationChanges)) && (
                  <TurnStatusPill
                    plan={state.plan}
                    changes={
                      hasConversationChanges ? conversationChanges : undefined
                    }
                    onOpenChanges={openReviewPanel}
                  />
                )}
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
                  className={`composer ${voiceStatus === "recording" ? "is-recording" : ""}`}
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
                    <div
                      className="composer-queue"
                      aria-label={t("queuedMessages")}
                    >
                      {state.queuedTurns.map((item, index) => (
                        <div className="composer-queue-item" key={item.id}>
                          <span
                            className={`composer-queue-badge ${item.delivery}`}
                          >
                            {t(
                              item.delivery === "inject"
                                ? "injectSoon"
                                : "afterCurrent",
                            )}
                          </span>
                          <span className="composer-queue-copy">
                            {item.input}
                          </span>
                          <div className="composer-queue-actions">
                            <button
                              type="button"
                              className="pressable"
                              disabled={index === 0}
                              onClick={() =>
                                void reorderQueuedTurn(
                                  item.id,
                                  state.queuedTurns[index - 1]?.id,
                                )
                              }
                              aria-label={t("moveQueuedMessageUp")}
                              title={t("moveUp")}
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="pressable"
                              disabled={index === state.queuedTurns.length - 1}
                              onClick={() =>
                                void reorderQueuedTurn(
                                  item.id,
                                  state.queuedTurns[index + 2]?.id,
                                )
                              }
                              aria-label={t("moveQueuedMessageDown")}
                              title={t("moveDown")}
                            >
                              <ChevronDown size={14} />
                            </button>
                            <button
                              type="button"
                              className="pressable cancel"
                              onClick={() => void cancelQueuedTurn(item.id)}
                              aria-label={t("cancelQueuedMessage")}
                              title={t("cancel")}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
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
                      setInput(value);
                      if (state.isRunning) {
                        setCapabilityQuery(undefined);
                      } else {
                        updateCapabilityQuery(
                          value,
                          event.target.selectionStart,
                        );
                      }
                      setVoiceError(undefined);
                    }}
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
                        onPointerDown={(event) => {
                          event.preventDefault();
                          setCapabilityQuery(undefined);
                          setAddMenuOpen((open) => !open);
                          setActiveCapabilityIndex(0);
                          requestAnimationFrame(() =>
                            textarea.current?.focus(),
                          );
                        }}
                        disabled={
                          state.connection !== "ready" ||
                          !providerReady ||
                          state.isRunning ||
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
                      {executionPolicy &&
                        projects &&
                        currentProject &&
                        state.threadId && (
                          <ConversationAccessControl
                            mode={currentConversation?.accessMode ?? "approval"}
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
                            onChange={updateConversationAccessMode}
                          />
                        )}
                    </div>
                    <div className="composer-toolbar-end">
                      {voiceInput && !state.isRunning && (
                        <button
                          type="button"
                          className={`composer-action voice pressable ${voiceStatus === "recording" ? "recording" : ""}`}
                          onClick={() => {
                            if (voiceStatus === "recording") stopVoiceInput();
                            else void startVoiceInput();
                          }}
                          disabled={
                            state.connection !== "ready" ||
                            !providerReady ||
                            voiceStatus === "requesting" ||
                            voiceStatus === "transcribing"
                          }
                          aria-label={
                            voiceStatus === "recording"
                              ? t("stopRecording")
                              : voiceStatus === "requesting"
                                ? t("requestingMicrophone")
                                : voiceStatus === "transcribing"
                                  ? t("transcribingVoice")
                                  : t("voiceInput")
                          }
                          aria-pressed={voiceStatus === "recording"}
                          title={
                            voiceStatus === "recording"
                              ? t("stopRecording")
                              : t("voiceInput")
                          }
                        >
                          {voiceStatus === "requesting" ||
                          voiceStatus === "transcribing" ? (
                            <LoaderCircle className="spin" size={17} />
                          ) : voiceStatus === "recording" ? (
                            <Square
                              size={12}
                              fill="currentColor"
                              strokeWidth={0}
                            />
                          ) : (
                            <Mic size={17} />
                          )}
                        </button>
                      )}
                      {state.isRunning && (
                        <button
                          type="button"
                          className="composer-action send pressable"
                          onClick={() => void submit(input, "inject")}
                          disabled={!input.trim()}
                          aria-label={t("injectMessage")}
                          title={t("injectMessage")}
                        >
                          <ArrowUp size={18} strokeWidth={2.4} />
                        </button>
                      )}
                      {state.isRunning ? (
                        <button
                          type="button"
                          className="composer-action stop pressable"
                          onClick={stopRunningTurn}
                          aria-label={t("stopRun")}
                          title={t("stop")}
                        >
                          <CircleStop size={18} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="composer-action send pressable"
                          onClick={() => void submit()}
                          disabled={
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
                          <ArrowUp size={18} strokeWidth={2.4} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <p
                  id="composer-hint"
                  className={`composer-hint ${voiceError || attachmentError || state.submissionError ? "error" : ""}`}
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
                    t,
                  )}
                </p>
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
              taskWorkspaceAvailable={defaultTerminalWorkspace === "task"}
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
              defaultWorkspace={defaultTerminalWorkspace}
              taskWorkspaceAvailable={defaultTerminalWorkspace === "task"}
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
          busy={switchingProject}
          error={projectError}
          hostName={currentHost?.name ?? t("remoteHost")}
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
          onCancel={() => {
            if (connectorBusy) return;
            setConnectorSetup(undefined);
            setConnectorError(undefined);
            requestAnimationFrame(() => textarea.current?.focus());
          }}
          onConnect={(clientId, clientSecret) =>
            void connectConnector(clientId, clientSecret)
          }
          onDisconnect={() => void disconnectConnector()}
        />
      )}
      {executionPolicy && <ExecutionApprovalGate adapter={executionPolicy} />}
    </div>
  );
}
