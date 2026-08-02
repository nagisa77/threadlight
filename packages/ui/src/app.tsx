import {
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
import type { ThreadlightClient } from "@threadlight/client";
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
  LoaderCircle,
  MoreHorizontal,
  Mic,
  Monitor,
  NotebookText,
  Paperclip,
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
import {
  ProjectMemoryPage,
  type ProjectMemoryAdapter,
} from "./memory.js";
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
import { SettingsPage, type SettingsAdapter } from "./settings.js";
import {
  ConversationAccessControl,
  ExecutionApprovalGate,
  ExecutionPolicyPage,
  type ExecutionPolicyAdapter,
} from "./execution-policy.js";
import {
  DiagnosticsPage,
  type DiagnosticsAdapter,
} from "./diagnostics.js";
import {
  AutomationsPage,
  type AutomationAdapter,
} from "./automations.js";
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
import { TerminalPanel, type TerminalAdapter } from "./terminal.js";
import {
  WorkspacePanel,
  type ConversationChangesSnapshot,
  type WorkspaceAdapter,
  type WorkspaceFileOpenRequest,
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
  type ConversationSummary,
  type HostSummary,
  type HostsSnapshot,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "./projects.js";
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
  authorize<Result>(
    action: () => Promise<Result>,
  ): Promise<Result>;
}

export const WORKSPACE_CHANGE_REFRESH_TOOL_NAMES = [
  "exec_command",
  "process_status",
  "process_read",
  "process_wait",
  "process_kill",
  "apply_patch",
  "write_file",
  "edit_file",
] as const;

const workspaceChangeRefreshTools = new Set<string>(
  WORKSPACE_CHANGE_REFRESH_TOOL_NAMES,
);
const COMPUTER_PERMISSION_RESUME_KEY =
  "threadlight:computer-permission-resume";
const COMPUTER_PERMISSION_RESUME_TTL_MS = 5 * 60 * 1_000;

export interface AttachmentStageAdapter {
  stage(file: File): Promise<AttachmentData>;
}

export interface AttachmentPreviewAdapter {
  imageUrl(attachment: AttachmentData): string | undefined;
  loadImageUrl?(
    attachment: AttachmentData,
  ): Promise<string | undefined>;
}

export type ComputerPermissionCapability =
  | "screen_recording"
  | "accessibility";

export interface ComputerPermissionSnapshot {
  required: boolean;
  blockingCapability?: ComputerPermissionCapability;
  ownerThreadId?: string;
  screenRecording:
    | "not-determined"
    | "granted"
    | "denied"
    | "restricted"
    | "unknown";
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
  subscribe(
    listener: (snapshot: ComputerShareSnapshot) => void,
  ): () => void;
}

interface PendingAttachment {
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

type VoiceInputStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

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
        if (active && isLanguage(snapshot.language)) setLanguage(snapshot.language);
        if (active && isThemePreference(snapshot.theme)) setTheme(snapshot.theme);
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
  const [capabilityQuery, setCapabilityQuery] =
    useState<CapabilityQuery>();
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
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState<number>();
  const [workspaceReviewRequest, setWorkspaceReviewRequest] = useState(0);
  const [workspaceFileOpenRequest, setWorkspaceFileOpenRequest] =
    useState<WorkspaceFileOpenRequest>();
  const [conversationChanges, setConversationChanges] =
    useState<ConversationChangesSnapshot>();
  const [conversationChangesLoading, setConversationChangesLoading] =
    useState(false);
  const [conversationChangesError, setConversationChangesError] =
    useState<string>();
  const [suggestedQuestions, setSuggestedQuestions] =
    useState<SuggestedQuestionsState>();
  const [suggestionRetry, setSuggestionRetry] = useState(0);
  const [projectOpeners, setProjectOpeners] = useState<
    readonly ProjectOpenerOption[]
  >([]);
  const conversationChangesRequest = useRef(0);
  const conversationChangesScope = useRef("");
  const activePlanDocument = useRef<string | undefined>(undefined);
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
  const currentWorkspacePath =
    currentConversation?.workspace?.path ?? currentProject?.basePath;
  projectSnapshotRef.current = projectSnapshot;
  activeThreadIdRef.current = state.threadId;
  viewRef.current = view;

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
    attachmentStage &&
      pendingAttachments.length < MAX_COMPOSER_ATTACHMENTS
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
  const composerMenuItemCount =
    addActions.length + filteredCapabilities.length;
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
      ? [{
          id: "action:memory",
          kind: "action" as const,
          actionId: "memory",
          title: t("projectMemory"),
          subtitle: t("commandMemoryDescription"),
          keywords: "memory context",
        }]
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
      ? [{
          id: "action:terminal",
          kind: "action" as const,
          actionId: "terminal",
          title: terminalOpen ? t("closeTerminal") : t("openTerminal"),
          subtitle: t("commandTerminalDescription"),
          keywords: "shell command terminal",
        }]
      : []),
    ...(diagnostics
      ? [{
          id: "action:diagnostics",
          kind: "action" as const,
          actionId: "diagnostics",
          title: t("usageDiagnostics"),
          subtitle: t("commandDiagnosticsDescription"),
          keywords: "usage diagnostics tokens",
        }]
      : []),
    ...(automations && currentProject?.scope !== "standalone"
      ? [{
          id: "action:automations",
          kind: "action" as const,
          actionId: "automations",
          title: t("automations"),
          subtitle: t("commandAutomationsDescription"),
          keywords: "automation schedule recurring cron tests dependencies issues",
        }]
      : []),
    ...(settings
      ? [{
          id: "action:settings",
          kind: "action" as const,
          actionId: "settings",
          title: t("settings"),
          subtitle: t("commandSettingsDescription"),
          keywords: "preferences provider model theme language",
        }]
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
          project.scope === "standalone"
            ? t("notInProject")
            : project.name
        } · ${
          item.archivedAt
            ? t("archivedTasks")
            : runningThreadIds.includes(item.id)
              ? t("runningTasks")
              : item.status === "pending"
                ? t("pendingTasks")
                : t("completedTasks")
        }`,
        keywords: `${project.name} ${
          project.scope === "standalone"
            ? "standalone not in project 不在项目中 不在專案中 プロジェクト外 프로젝트"
            : ""
        } ${
          item.archivedAt ? "archived" : item.status
        }`,
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
          (conversation) =>
            conversation.id === threadId && conversation.unread,
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
    return () =>
      window.removeEventListener("pointerdown", closeFromOutside);
  }, [addMenuOpen, capabilityQuery]);

  useEffect(() => {
    if (
      (!capabilityQuery && !addMenuOpen) ||
      composerMenuItemCount === 0
    ) {
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

  const workspaceChangeRefreshKey =
    conversationChangesRefreshKey(state.progress);

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
    async (
      paths: readonly string[] | undefined,
      revision: string,
    ) => {
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
        if (
          errorMessage(error).includes(
            "workspace changed after this Diff",
          )
        ) {
          throw new Error(t("restoreConflict"));
        }
        throw error;
      } finally {
        setConversationChangesLoading(false);
      }
    },
    [
      currentProject,
      state.isRunning,
      state.threadId,
      t,
      workspace,
    ],
  );

  useEffect(() => {
    void refreshConversationChanges();
  }, [refreshConversationChanges, state.isRunning, state.messages.length]);

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
    if (
      state.connection !== "ready" ||
      state.isRunning ||
      !state.threadId
    ) {
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
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [
    state.messages.length,
    state.progress,
    state.streamingText,
  ]);

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
          ? document.getElementById(
              `activity-${pendingSearchJump.activityId}`,
            )
          : undefined) ??
        (pendingSearchJump.messageId
          ? document.getElementById(
              `message-${pendingSearchJump.messageId}`,
            )
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

  async function finishVoiceInput(
    recorder: MediaRecorder,
    operation: number,
  ) {
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
          id: crypto.randomUUID(),
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

  async function createThread() {
    if (!currentProject || voiceStatus !== "idle") return;
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
      if (standalone?.conversations.some(
        (conversation) => !conversation.archivedAt,
      )) {
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
    if (
      !projects ||
      switchingProject ||
      voiceStatus !== "idle"
    ) {
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
    if (
      !projects ||
      switchingProject ||
      voiceStatus !== "idle"
    ) {
      return false;
    }
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
      if (
        deletingActiveConversation &&
        !(await stopComputerShare())
      ) {
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

  function beginWorkspacePanelResize(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
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
      workspaceElement.style.gridTemplateColumns =
        `minmax(360px, 1fr) ${nextWidth}px`;
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
    const connector = connectorCapabilityForSelection(
      capability,
      capabilities,
    );
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
        commitCapabilitySelection(
          { ...selection, status: "ready" },
          cursor,
        );
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
    const connector = connectorCapabilityForSelection(
      selection,
      capabilities,
    );
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
        capability.id === capabilityId
          ? { ...capability, status }
          : capability,
      ),
    );
  }

  async function connectConnector(
    clientId: string,
    clientSecret: string,
  ) {
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
        current.filter(
          ({ id }) => id !== capability.id && id !== selection.id,
        ),
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
        projectOpener && projectOpeners.length > 0 && (
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
          aria-label={terminalOpen ? t("closeTerminal") : t("openTerminal")}
          aria-pressed={terminalOpen}
          title={`${terminalOpen ? t("closeTerminal") : t("openTerminal")}（⌘J）`}
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag-region" />
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
                addDisabled={
                  switchingProject || voiceStatus !== "idle"
                }
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
                    disabled={
                      switchingProject ||
                      voiceStatus !== "idle"
                    }
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
                      disabled={
                        switchingProject || voiceStatus !== "idle"
                      }
                      onSelect={(threadId) =>
                        void selectConversation(
                          standaloneProject.id,
                          threadId,
                        )
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
                  <div className="thread-placeholder">{t("openFolderToStart")}</div>
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
              }}
            >
              <Settings size={15} />
              {t("settings")}
            </button>
          )}
          <RuntimeStatusControl
            status={
              currentProject || !projects ? state.connection : "idle"
            }
            label={
              currentHost?.name ??
              (currentProject || !projects
                ? connectionLabel(state.connection, t)
                : t("noProjectOpen"))
            }
            mode={
              `${currentHost?.kind === "remote" ? t("remoteHost") : t("local")} · ${
                currentProject || !projects
                  ? connectionLabel(state.connection, t)
                  : t("noProjectOpen")
              }`
            }
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
        <div className="workspace-primary">
        {view === "memory" &&
        memory &&
        currentProject &&
        currentProject.scope !== "standalone" ? (
          <ProjectMemoryPage
            adapter={memory}
            projectId={currentProject.id}
            projectName={currentProject.name}
          />
        ) : view === "diagnostics" &&
          diagnostics &&
          currentProject ? (
          <DiagnosticsPage
            adapter={diagnostics}
            projectId={currentProject.id}
            projectName={currentProject.name}
          />
        ) : view === "automations" &&
          automations &&
          currentProject ? (
          <AutomationsPage
            adapter={automations}
            projectId={currentProject.id}
            projectName={currentProject.name}
            onOpenThread={(threadId) =>
              void selectConversation(currentProject.id, threadId)
            }
          />
        ) : view === "settings" && settings ? (
          <SettingsPage
            adapter={settings}
            onRuntimeRestart={reconnectRuntime}
            onLanguageChange={onLanguageChange}
            onThemeChange={onThemeChange}
            projectOpeners={projectOpeners}
            onPreferredProjectOpenerChange={onPreferredProjectOpenerChange}
          />
        ) : view === "security" &&
          executionPolicy &&
          currentProject ? (
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
              <div>
                <h1>{state.messages[0]?.text || t("task")}</h1>
                <p>
                  {currentProject?.scope === "standalone"
                    ? t("notInProject")
                    : currentProject?.runtime?.kind === "remote"
                    ? `${t("remoteRuntime")} · ${currentProject.runtime.workspacePath}`
                    : (currentProject?.basePath ?? "Agent runtime")} ·{" "}
                  {shortId(state.threadId)}
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
                    onOpenSettings={settings ? () => setView("settings") : undefined}
                  />
                )}

                {state.messages.length === 0 && state.connection !== "error" ? (
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
                    onCreateStandalone={() =>
                      void createStandaloneThread()
                    }
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
                            {message.progress && message.progress.length > 0 && (
                              <ProgressList
                                progress={message.progress}
                                onTerminateProcess={terminateProcess}
                                onOpenLocalFile={openLocalFile}
                                onRevealLocalFile={
                                  workspace?.reveal || workspace?.revealSystemFile
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
                                  workspace?.reveal || workspace?.revealSystemFile
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
                                workspace?.reveal || workspace?.revealSystemFile
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
                      onRelaunch={() =>
                        void relaunchForComputerPermissions()
                      }
                    />
                  )}
                {ownsActiveComputerShare(
                  computerShareSnapshot,
                  state.threadId,
                ) && (
                  <ComputerShareStatus
                    snapshot={computerShareSnapshot}
                    busy={
                      showingComputerShare || stoppingComputerShare
                    }
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
                            disabled={
                              index === state.queuedTurns.length - 1
                            }
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
                            onClick={() =>
                              void cancelQueuedTurn(item.id)
                            }
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
                      : t("askThreadlight")
                  }
                  disabled={state.connection !== "ready"}
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
                        requestAnimationFrame(() => textarea.current?.focus());
                      }}
                      disabled={
                        state.connection !== "ready" ||
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
                          mode={
                            currentConversation?.accessMode ?? "approval"
                          }
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
          <div className="workspace-global-actions">
            {globalActions}
          </div>
        )}
        {workspace && currentProject && (
          <WorkspacePanel
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
            toolbarActions={
              globalActionsInPanel ? globalActions : undefined
            }
          />
        )}
        {terminalOpen && terminal && currentProject && (
          <TerminalPanel
            key={currentProject.id}
            adapter={terminal}
            workspace={workspace}
            projectId={currentProject.id}
            threadId={state.threadId}
            projectName={currentProject.name}
            onClose={() => setTerminalOpen(false)}
          />
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
      {executionPolicy && (
        <ExecutionApprovalGate adapter={executionPolicy} />
      )}
    </div>
  );
}

export function MessageActions({
  role,
  text,
  copyText,
  onRewrite,
}: {
  role: "user" | "assistant";
  text: string;
  copyText?(text: string): Promise<void>;
  onRewrite?(): void;
}) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const copyStatusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(
    () => () => {
      if (copyStatusTimer.current) clearTimeout(copyStatusTimer.current);
    },
    [],
  );

  async function copyMessage() {
    try {
      await writeClipboardText(text, copyText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    if (copyStatusTimer.current) clearTimeout(copyStatusTimer.current);
    copyStatusTimer.current = setTimeout(() => setCopyStatus("idle"), 1600);
  }

  const copyLabel =
    copyStatus === "copied"
      ? t("copied")
      : copyStatus === "failed"
        ? t("copyFailed")
        : t("copyMessage");

  return (
    <div
      className={`message-actions ${role}`}
      aria-label={t("messageActions")}
      aria-live="polite"
    >
      <button
        type="button"
        className={`message-action pressable ${copyStatus}`}
        onClick={() => void copyMessage()}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copyStatus === "copied" ? (
          <Check size={14} />
        ) : copyStatus === "failed" ? (
          <X size={14} />
        ) : (
          <Copy size={14} />
        )}
      </button>
      {role === "user" && onRewrite && (
        <button
          type="button"
          className="message-action pressable"
          onClick={onRewrite}
          aria-label={t("rewriteQuestion")}
          title={t("rewriteQuestion")}
        >
          <PencilLine size={14} />
        </button>
      )}
    </div>
  );
}

export async function writeClipboardText(
  text: string,
  desktopWriteText?: (text: string) => Promise<void>,
): Promise<void> {
  if (desktopWriteText) {
    try {
      await desktopWriteText(text);
      return;
    } catch {
      // Continue through the browser fallbacks.
    }
  }

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Clipboard API can exist but reject writes in Electron or non-secure contexts.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard write is unavailable");
  }
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  fallback.style.top = "0";
  document.body.append(fallback);
  fallback.focus();
  fallback.select();
  fallback.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  fallback.remove();
  previousFocus?.focus({ preventScroll: true });
  if (!copied) throw new Error("Clipboard write failed");
}

export function ConversationChangesButton({
  changes,
  onOpen,
}: {
  changes: ConversationChangesSnapshot;
  onOpen(): void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="conversation-changes-button pressable"
      onClick={onOpen}
    >
      <FileDiff size={14} />
      <span>{t("filesChanged", { count: changes.files.length })}</span>
      <span className="change-additions">+{changes.additions}</span>
      <span className="change-deletions">-{changes.deletions}</span>
    </button>
  );
}

export function TurnStatusPill({
  plan,
  changes,
  onOpenChanges,
}: {
  plan?: AgentPlanData;
  changes?: ConversationChangesSnapshot;
  onOpenChanges(): void;
}) {
  const { t } = useI18n();
  const step = plan ? currentPlanStep(plan) : undefined;
  const completed =
    !!plan?.items.length &&
    plan.items.every((item) => item.status === "completed");

  return (
    <div className="turn-status-float">
      <div className="turn-status-pill">
        {plan && (
          <div className="plan-status">
            <button
              type="button"
              className="plan-status-trigger"
              aria-label={
                plan.items.length
                  ? t("planStep", {
                      current: step ?? 1,
                      total: plan.items.length,
                    })
                  : t("planning")
              }
            >
              {completed ? (
                <span className="plan-status-icon completed">
                  <Check size={11} strokeWidth={2.5} />
                </span>
              ) : (
                <LoaderCircle
                  className="plan-status-icon spin"
                  size={15}
                  strokeWidth={2.2}
                />
              )}
              <strong>
                {plan.items.length
                  ? t("planStep", {
                      current: step ?? 1,
                      total: plan.items.length,
                    })
                  : t("planning")}
              </strong>
            </button>
            {plan.items.length > 0 && (
              <div
                className="plan-status-popover"
                role="list"
                aria-label={t("plan")}
              >
                {plan.items.map((item, index) => (
                  <div
                    className={`plan-status-item ${item.status}`}
                    role="listitem"
                    data-current={index + 1 === step || undefined}
                    key={`${index}:${item.step}`}
                  >
                    {item.status === "completed" ? (
                      <span className="plan-item-icon completed">
                        <Check size={11} strokeWidth={2.5} />
                      </span>
                    ) : (
                      <LoaderCircle
                        className={`plan-item-icon ${item.status === "in_progress" ? "spin" : ""}`}
                        size={15}
                        strokeWidth={2}
                      />
                    )}
                    <span title={item.step}>{item.step}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {plan && changes && <span className="turn-status-separator">·</span>}
        {changes && (
          <ConversationChangesButton
            changes={changes}
            onOpen={onOpenChanges}
          />
        )}
      </div>
    </div>
  );
}

export function currentPlanStep(plan: AgentPlanData): number | undefined {
  if (plan.items.length === 0) return;
  const active = plan.items.findIndex(
    (item) => item.status === "in_progress",
  );
  if (active >= 0) return active + 1;
  const pending = plan.items.findIndex((item) => item.status === "pending");
  return pending >= 0 ? pending + 1 : plan.items.length;
}

export function planDocumentOpenRequest(
  plan: AgentPlanData | undefined,
  threadId: string | undefined,
  activeDocumentKey: string | undefined,
  requestId: number,
):
  | {
      documentKey: string;
      openPanel: boolean;
      request: WorkspaceFileOpenRequest;
    }
  | undefined {
  if (
    !threadId ||
    !plan?.documentPath ||
    !plan.documentVersion
  ) {
    return;
  }
  const documentKey = `${threadId}\u0000${plan.documentPath}`;
  const openPanel = activeDocumentKey !== documentKey;
  return {
    documentKey,
    openPanel,
    request: {
      id: requestId,
      path: plan.documentPath,
      activate: openPanel,
    },
  };
}

export function conversationChangesRefreshKey(
  progress: readonly ConversationProgress[],
): string {
  return progress
    .flatMap((step) => step.activities)
    .filter(
      (activity) =>
        workspaceChangeRefreshTools.has(activity.name) &&
        (activity.status !== "running" || activity.process !== undefined),
    )
    .map(
      (activity) =>
        `${activity.id}:${activity.status}:${activity.process?.sessionId ?? ""}`,
    )
    .join("\u0000");
}

export function clampWorkspacePanelWidth(
  requestedWidth: number,
  workspaceWidth: number,
): number {
  const minimumWidth = Math.min(420, workspaceWidth / 2);
  const maximumWidth = Math.max(minimumWidth, workspaceWidth - 360);
  return Math.round(
    Math.min(maximumWidth, Math.max(minimumWidth, requestedWidth)),
  );
}

export function ComputerPermissionCard({
  snapshot,
  busy,
  error,
  onRequest,
  onRefresh,
  onRelaunch,
}: {
  snapshot: ComputerPermissionSnapshot;
  busy?: ComputerPermissionCapability | "refresh" | "relaunch";
  error?: string;
  onRequest(capability: ComputerPermissionCapability): void;
  onRefresh(): void;
  onRelaunch(): void;
}) {
  const { t } = useI18n();
  const screenReady = snapshot.screenRecording === "granted";
  const accessibilityReady = snapshot.accessibility === "granted";
  const ready = screenReady && accessibilityReady;

  return (
    <section className="computer-permission-card" aria-live="polite">
      <div className="computer-permission-heading">
        <span className="computer-permission-icon" aria-hidden="true">
          <ShieldAlert size={16} />
        </span>
        <span>
          <strong>
            {ready
              ? t("computerPermissionReady")
              : t("computerPermissionTitle")}
          </strong>
          <small>
            {ready
              ? t("computerPermissionRestartHint")
              : t("computerPermissionDescription")}
          </small>
        </span>
      </div>
      <div className="computer-permission-list">
        <ComputerPermissionRow
          label={t("screenRecordingPermission")}
          ready={screenReady}
          busy={busy === "screen_recording"}
          disabled={!!busy}
          onRequest={() => onRequest("screen_recording")}
        />
        <ComputerPermissionRow
          label={t("accessibilityPermission")}
          ready={accessibilityReady}
          busy={busy === "accessibility"}
          disabled={!!busy}
          onRequest={() => onRequest("accessibility")}
        />
      </div>
      {error && <p className="computer-permission-error">{error}</p>}
      <div className="computer-permission-actions">
        {ready ? (
          <button
            type="button"
            className="computer-permission-primary pressable"
            disabled={!!busy}
            onClick={onRelaunch}
          >
            {busy === "relaunch" && <LoaderCircle className="spin" size={13} />}
            {t("restartThreadlight")}
          </button>
        ) : (
          <button
            type="button"
            className="computer-permission-refresh pressable"
            disabled={!!busy}
            onClick={onRefresh}
          >
            {busy === "refresh" ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
            {t("recheckPermissions")}
          </button>
        )}
      </div>
    </section>
  );
}

export function pendingComputerPermissionResume(
  value: string | null,
  now: number,
): { threadId: string; expiresAt: number } | undefined {
  if (!value) return;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const resume = parsed as Record<string, unknown>;
    if (
      typeof resume.threadId !== "string" ||
      !resume.threadId ||
      typeof resume.expiresAt !== "number" ||
      !Number.isFinite(resume.expiresAt) ||
      resume.expiresAt <= now
    ) {
      return;
    }
    return {
      threadId: resume.threadId,
      expiresAt: resume.expiresAt,
    };
  } catch {
    return;
  }
}

function ComputerPermissionRow({
  label,
  ready,
  busy,
  disabled,
  onRequest,
}: {
  label: string;
  ready: boolean;
  busy: boolean;
  disabled: boolean;
  onRequest(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="computer-permission-row">
      <span className={ready ? "permission-dot granted" : "permission-dot"} />
      <strong>{label}</strong>
      <span className={ready ? "permission-state granted" : "permission-state"}>
        {ready ? t("permissionGranted") : t("permissionRequired")}
      </span>
      {!ready && (
        <button
          type="button"
          className="computer-permission-grant pressable"
          disabled={disabled}
          onClick={onRequest}
        >
          {busy && <LoaderCircle className="spin" size={12} />}
          {t("grantPermission")}
        </button>
      )}
    </div>
  );
}

export function ComputerShareStatus({
  snapshot,
  busy,
  stopping,
  error,
  onShow,
  onStop,
}: {
  snapshot: ComputerShareSnapshot;
  busy: boolean;
  stopping: boolean;
  error?: string;
  onShow(): void;
  onStop(): void;
}) {
  const { t } = useI18n();
  const applications = [
    ...new Set(
      snapshot.targets.map(
        (target) => target.applicationName ?? target.name,
      ),
    ),
  ];
  const targetLabel =
    applications.length > 0
      ? applications.join("、")
      : t("windowsCount", { count: snapshot.targets.length });

  return (
    <div className="composer-share" aria-live="polite">
      <span className="composer-share-icon" aria-hidden="true">
        <PictureInPicture2 size={14} />
        <span />
      </span>
      <span className="composer-share-copy">
        <strong>
          {t("sharing")}
          {snapshot.targets.length > 1
            ? ` ${t("windowsCount", { count: snapshot.targets.length })}`
            : ""}
        </strong>
        <small title={targetLabel}>{error ?? targetLabel}</small>
      </span>
      <button
        type="button"
        className="composer-share-action pressable"
        disabled={busy}
        onClick={onShow}
      >
        {busy && !stopping && <LoaderCircle className="spin" size={12} />}
        {snapshot.pictureInPicture ? t("showPictureInPicture") : t("reopen")}
      </button>
      <button
        type="button"
        className="composer-share-stop pressable"
        disabled={busy}
        onClick={onStop}
        aria-label={t("stopSharing")}
        title={t("stopSharing")}
      >
        {stopping ? (
          <LoaderCircle className="spin" size={12} />
        ) : (
          <X size={13} />
        )}
      </button>
    </div>
  );
}

export type TaskListFilter =
  | "all"
  | "running"
  | "pending"
  | "completed"
  | "archived";

export function filterProjectsForTaskList(
  projects: readonly ProjectSummary[],
  query: string,
  filter: TaskListFilter,
  runningThreadIds: readonly string[],
): ProjectSummary[] {
  const normalizedQuery = query.trim().toLowerCase();
  const running = new Set(runningThreadIds);
  return projects.flatMap((project) => {
    const projectMatches = [
      project.name,
      ...(project.scope === "standalone"
        ? [
            "standalone",
            "not in project",
            "不在项目中",
            "不在專案中",
            "プロジェクト外",
            "프로젝트에 속하지 않음",
          ]
        : []),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
    const conversations = project.conversations.filter((conversation) => {
      const archived = Boolean(conversation.archivedAt);
      if (filter === "archived") {
        if (!archived) return false;
      } else {
        if (archived) return false;
        if (filter === "running" && !running.has(conversation.id)) return false;
        if (
          filter === "pending" &&
          (running.has(conversation.id) ||
            conversation.status !== "pending")
        ) {
          return false;
        }
        if (
          filter === "completed" &&
          (running.has(conversation.id) ||
            (conversation.status ?? "completed") !== "completed")
        ) {
          return false;
        }
      }
      return (
        !normalizedQuery ||
        projectMatches ||
        conversation.title.toLowerCase().includes(normalizedQuery)
      );
    });
    const filterActive = filter !== "all";
    if (
      conversations.length === 0 &&
      (filterActive || (normalizedQuery && !projectMatches))
    ) {
      return [];
    }
    return [{ ...project, conversations }];
  });
}

export function TaskSearchDialog({
  projects,
  query,
  filter,
  runningThreadIds,
  activeThreadId,
  onQueryChange,
  onFilterChange,
  onSelect,
  onClose,
}: {
  projects: readonly ProjectSummary[];
  query: string;
  filter: TaskListFilter;
  runningThreadIds: readonly string[];
  activeThreadId?: string;
  onQueryChange(query: string): void;
  onFilterChange(filter: TaskListFilter): void;
  onSelect(projectId: string, threadId: string): void;
  onClose(): void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const filteredProjects = filterProjectsForTaskList(
    projects,
    query,
    filter,
    runningThreadIds,
  );
  const resultCount = filteredProjects.reduce(
    (count, project) => count + project.conversations.length,
    0,
  );
  const running = new Set(runningThreadIds);
  const filters: readonly TaskListFilter[] = [
    "all",
    "running",
    "pending",
    "completed",
    "archived",
  ];

  useEffect(() => {
    input.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      className="task-search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="task-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-search-title"
      >
        <h2 id="task-search-title" className="sr-only">
          {t("searchTasks")}
        </h2>
        <div className="task-search-dialog-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            value={query}
            placeholder={t("searchTasks")}
            aria-label={t("searchTasks")}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button
              type="button"
              className="task-search-dialog-clear pressable"
              aria-label={t("clearSearch")}
              title={t("clearSearch")}
              onClick={() => {
                onQueryChange("");
                input.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            className="task-search-dialog-close pressable"
            aria-label={t("closeTaskSearch")}
            title={t("closeTaskSearch")}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div
          className="task-search-filters"
          role="tablist"
          aria-label={t("filterTasks")}
        >
          {filters.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === filter}
              className={`task-search-filter pressable ${candidate === filter ? "active" : ""}`}
              onClick={() => onFilterChange(candidate)}
            >
              {taskFilterLabel(candidate, t)}
            </button>
          ))}
        </div>
        <div
          className="task-search-results"
          aria-label={t("taskSearchResults", { count: resultCount })}
        >
          {resultCount === 0 ? (
            <div className="task-search-empty">
              <Search size={20} aria-hidden="true" />
              <span>{t("noMatchingTasks")}</span>
            </div>
          ) : (
            filteredProjects.map((project) => (
              <section className="task-search-project" key={project.id}>
                <h3>
                  {project.scope === "standalone" ? (
                    <X size={14} aria-hidden="true" />
                  ) : (
                    <Folder size={14} aria-hidden="true" />
                  )}
                  <span>
                    {project.scope === "standalone"
                      ? t("notInProject")
                      : project.name}
                  </span>
                  <small>{project.conversations.length}</small>
                </h3>
                {project.conversations.map((conversation) => {
                  const isRunning = running.has(conversation.id);
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`task-search-result pressable ${conversation.id === activeThreadId ? "active" : ""}`}
                      aria-current={
                        conversation.id === activeThreadId ? "page" : undefined
                      }
                      onClick={() => onSelect(project.id, conversation.id)}
                    >
                      <span className="task-search-result-icon">
                        {isRunning ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : conversation.archivedAt ? (
                          <Archive size={14} />
                        ) : conversation.pinnedAt ? (
                          <Pin size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                      </span>
                      <span className="task-search-result-copy">
                        <strong>{conversation.title}</strong>
                        <small>
                          {isRunning
                            ? t("runningTasks")
                            : conversation.archivedAt
                              ? t("archivedTasks")
                              : conversation.status === "pending"
                                ? t("pendingTasks")
                                : t("completedTasks")}
                        </small>
                      </span>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function taskFilterLabel(filter: TaskListFilter, t: Translate): string {
  if (filter === "running") return t("runningTasks");
  if (filter === "pending") return t("pendingTasks");
  if (filter === "completed") return t("completedTasks");
  if (filter === "archived") return t("archivedTasks");
  return t("allTasks");
}

export function ProjectListHeading({
  searchTriggerRef,
  searchDisabled,
  addDisabled,
  onSearch,
  onAdd,
}: {
  searchTriggerRef?: RefObject<HTMLButtonElement | null>;
  searchDisabled: boolean;
  addDisabled: boolean;
  onSearch(): void;
  onAdd(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="project-list-heading">
      <p className="section-label">{t("projects")}</p>
      <div className="project-heading-actions">
        <button
          ref={searchTriggerRef}
          type="button"
          className="icon-button pressable"
          aria-label={t("commandPalette")}
          title={`${t("commandPalette")}（⌘K）`}
          disabled={searchDisabled}
          onClick={onSearch}
        >
          <Search size={15} />
        </button>
        <button
          className="icon-button pressable"
          type="button"
          title={t("addProject")}
          aria-label={t("addProject")}
          disabled={addDisabled}
          onClick={onAdd}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

export function RuntimeStatusControl({
  status,
  label,
  mode,
  disabled,
  title,
  onOpen,
}: {
  status: "idle" | "connecting" | "ready" | "error";
  label: string;
  mode: string;
  disabled?: boolean;
  title?: string;
  onOpen?(): void;
}) {
  const content = (
    <>
      <span className={`status-dot ${status}`} aria-hidden="true" />
      <span className="runtime-status-label" title={label}>
        {label}
      </span>
      <span className="status-mode" title={mode}>
        {mode}
      </span>
      {onOpen ? (
        <ChevronRight
          className="runtime-status-chevron"
          size={13}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return onOpen ? (
    <button
      type="button"
      className="runtime-status-control pressable"
      disabled={disabled}
      aria-label={`${label} · ${mode}`}
      title={title}
      onClick={onOpen}
    >
      {content}
    </button>
  ) : (
    <div
      className="runtime-status-control static"
      role="status"
      aria-label={`${label} · ${mode}`}
    >
      {content}
    </div>
  );
}

export function RecentTasksGroup({
  project,
  active,
  activeThreadId,
  runningThreadIds = [],
  computerThreadId,
  disabled,
  onSelect,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  runningThreadIds?: readonly string[];
  computerThreadId?: string;
  disabled: boolean;
  onSelect(threadId: string): void;
  onRename?(
    conversation: ConversationSummary,
    title: string,
  ): Promise<void>;
  onTogglePinned?(conversation: ConversationSummary): Promise<void>;
  onArchive?(
    conversation: ConversationSummary,
    archived: boolean,
  ): Promise<void>;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const conversations = project.conversations.filter(
    (conversation) => !conversation.archivedAt,
  );

  return (
    <section className="recent-tasks-group" aria-label={t("recent")}>
      <button
        type="button"
        className="recent-tasks-heading pressable"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{t("recent")}</span>
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {expanded && (
        <div className="recent-task-list">
          {conversations.map((conversation) => (
            <ProjectConversationItem
              key={conversation.id}
              conversation={conversation}
              active={active && conversation.id === activeThreadId}
              running={runningThreadIds.includes(conversation.id)}
              computerActive={conversation.id === computerThreadId}
              disabled={disabled}
              onSelect={() => onSelect(conversation.id)}
              onRename={
                onRename
                  ? (title) => onRename(conversation, title)
                  : undefined
              }
              onTogglePinned={
                onTogglePinned
                  ? () => onTogglePinned(conversation)
                  : undefined
              }
              onArchive={
                onArchive
                  ? (archived) => onArchive(conversation, archived)
                  : undefined
              }
              onDelete={onDelete ? () => onDelete(conversation) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ProjectGroup({
  project,
  active,
  activeThreadId,
  runningThreadIds = [],
  computerThreadId,
  disabled,
  forceExpanded = false,
  onNewTask,
  onOpenMemory,
  onOpenSecurity,
  onRevealInFinder,
  onToggleProjectPinned,
  onOpenDiagnostics,
  onSelect,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  runningThreadIds?: readonly string[];
  computerThreadId?: string;
  disabled: boolean;
  forceExpanded?: boolean;
  onNewTask?(): void | Promise<void>;
  onOpenMemory?(): void | Promise<void>;
  onOpenSecurity?(): void | Promise<void>;
  onRevealInFinder?(): void | Promise<void>;
  onToggleProjectPinned?(): Promise<void>;
  onOpenDiagnostics?(): void | Promise<void>;
  onSelect(threadId?: string): void;
  onRename?(
    conversation: ConversationSummary,
    title: string,
  ): Promise<void>;
  onTogglePinned?(conversation: ConversationSummary): Promise<void>;
  onArchive?(
    conversation: ConversationSummary,
    archived: boolean,
  ): Promise<void>;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<PopoverPosition>({
    top: 0,
    left: 0,
    transformOrigin: "top right",
  });
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState<string>();
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const visibleExpanded = expanded || forceExpanded;
  const projectRunning = project.conversations.some((conversation) =>
    runningThreadIds.includes(conversation.id),
  );
  const projectUsingComputer = project.conversations.some(
    (conversation) => conversation.id === computerThreadId,
  );
  const projectUnread = project.conversations.some(
    (conversation) => conversation.unread,
  );
  const projectActionCount = [
    onNewTask,
    onOpenMemory,
    onOpenSecurity,
    onRevealInFinder,
    onToggleProjectPinned,
    onOpenDiagnostics,
  ].filter(Boolean).length;

  function toggleExpanded() {
    const nextExpanded = !visibleExpanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !active) onSelect(project.conversations[0]?.id);
  }

  const closeProjectMenu = useCallback(() => setMenuOpen(false), []);

  async function runProjectAction(
    action: () => void | Promise<void>,
  ) {
    if (menuBusy) return;
    setMenuBusy(true);
    setMenuError(undefined);
    try {
      await action();
      setMenuOpen(false);
    } catch (error) {
      setMenuError(errorMessage(error));
    } finally {
      setMenuBusy(false);
    }
  }

  return (
    <section
      className="project-group"
      aria-label={project.name}
      title={menuError}
    >
      {menuError && (
        <span className="sr-only" role="alert">
          {menuError}
        </span>
      )}
      <div className="project-row">
        <button
          type="button"
          className="project-row-select pressable"
          aria-current={active ? "location" : undefined}
          aria-expanded={visibleExpanded}
          disabled={disabled}
          title={
            project.runtime?.kind === "remote"
              ? `${project.runtime.endpoint} · ${project.runtime.workspacePath}`
              : project.basePath
          }
          onClick={toggleExpanded}
        >
          {project.runtime?.kind === "remote" ? (
            <Server size={16} />
          ) : visibleExpanded ? (
            <FolderOpen size={16} />
          ) : (
            <Folder size={16} />
          )}
          <span className="project-name">{project.name}</span>
          {(showsProjectLevelActivity(visibleExpanded, projectRunning) ||
            showsProjectLevelActivity(visibleExpanded, projectUsingComputer) ||
            showsProjectLevelActivity(visibleExpanded, projectUnread)) && (
            <span className="project-live-indicators">
              {showsProjectLevelActivity(visibleExpanded, projectRunning) && (
                <LoaderCircle
                  className="project-runtime-indicator spin"
                  size={13}
                  aria-label={t("projectTaskRunning", {
                    project: project.name,
                  })}
                />
              )}
              {showsProjectLevelActivity(
                visibleExpanded,
                projectUsingComputer,
              ) && (
                <ComputerUseIndicator
                  label={t("projectTaskUsingComputer", {
                    project: project.name,
                  })}
                />
              )}
              {showsProjectLevelActivity(visibleExpanded, projectUnread) && (
                <span
                  className="project-unread-indicator"
                  aria-label={t("projectTaskUnread", {
                    project: project.name,
                  })}
                />
              )}
            </span>
          )}
        </button>
        {projectActionCount > 0 && (
          <div className={`project-row-actions ${menuOpen ? "open" : ""}`}>
            <button
              ref={menuTrigger}
              type="button"
              className="project-row-action pressable"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("projectActions", { project: project.name })}
              title={t("projectActions", { project: project.name })}
              disabled={disabled || menuBusy}
              onClick={(event) => {
                const open = !menuOpen;
                if (open) {
                  setMenuError(undefined);
                  setMenuPosition(
                    anchoredPopoverPosition(
                      event.currentTarget.getBoundingClientRect(),
                      {
                        width: 218,
                        height: 10 + projectActionCount * 36,
                      },
                    ),
                  );
                }
                setMenuOpen(open);
              }}
            >
              {menuBusy ? (
                <LoaderCircle className="spin" size={13} />
              ) : (
                <MoreHorizontal size={15} />
              )}
            </button>
            <button
              type="button"
              className="project-row-action pressable"
              aria-label={t("newTask")}
              title={t("newTask")}
              disabled={disabled || !onNewTask}
              onClick={onNewTask}
            >
              <SquarePen size={14} />
            </button>
          </div>
        )}
      </div>
      {menuOpen && (
        <ProjectActionPopover
          project={project}
          busy={menuBusy}
          position={menuPosition}
          returnFocusRef={menuTrigger}
          onClose={closeProjectMenu}
          onNewTask={
            onNewTask
              ? () => void runProjectAction(onNewTask)
              : undefined
          }
          onOpenMemory={
            onOpenMemory
              ? () => void runProjectAction(onOpenMemory)
              : undefined
          }
          onOpenSecurity={
            onOpenSecurity
              ? () => void runProjectAction(onOpenSecurity)
              : undefined
          }
          onRevealInFinder={
            onRevealInFinder
              ? () => void runProjectAction(onRevealInFinder)
              : undefined
          }
          onToggleProjectPinned={
            onToggleProjectPinned
              ? () => void runProjectAction(onToggleProjectPinned)
              : undefined
          }
          onOpenDiagnostics={
            onOpenDiagnostics
              ? () => void runProjectAction(onOpenDiagnostics)
              : undefined
          }
        />
      )}
      {visibleExpanded && (
        <div className="project-conversations">
          {project.conversations.map((conversation) => (
            <ProjectConversationItem
              key={conversation.id}
              conversation={conversation}
              active={active && conversation.id === activeThreadId}
              running={runningThreadIds.includes(conversation.id)}
              computerActive={conversation.id === computerThreadId}
              disabled={disabled}
              onSelect={() => onSelect(conversation.id)}
              onRename={
                onRename
                  ? (title) => onRename(conversation, title)
                  : undefined
              }
              onTogglePinned={
                onTogglePinned
                  ? () => onTogglePinned(conversation)
                  : undefined
              }
              onArchive={
                onArchive
                  ? (archived) => onArchive(conversation, archived)
                  : undefined
              }
              onDelete={onDelete ? () => onDelete(conversation) : undefined}
            />
          ))}
          {project.conversations.length === 0 && (
            <span className="project-empty-label">{t("noTasks")}</span>
          )}
        </div>
      )}
    </section>
  );
}

export function ProjectActionPopover({
  project,
  busy,
  position,
  returnFocusRef,
  onClose,
  onNewTask,
  onOpenMemory,
  onOpenSecurity,
  onRevealInFinder,
  onToggleProjectPinned,
  onOpenDiagnostics,
}: {
  project: ProjectSummary;
  busy: boolean;
  position: PopoverPosition;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onNewTask?(): void;
  onOpenMemory?(): void;
  onOpenSecurity?(): void;
  onRevealInFinder?(): void;
  onToggleProjectPinned?(): void;
  onOpenDiagnostics?(): void;
}) {
  const { t } = useI18n();
  return (
    <ActionPopover
      label={t("projectActions", { project: project.name })}
      position={position}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      {onNewTask && (
        <ActionPopoverItem
          icon={<SquarePen size={15} />}
          disabled={busy}
          onSelect={onNewTask}
        >
          {t("newTask")}
        </ActionPopoverItem>
      )}
      {onOpenMemory && (
        <ActionPopoverItem
          icon={<NotebookText size={15} />}
          disabled={busy}
          onSelect={onOpenMemory}
        >
          {t("manageProjectMemory")}
        </ActionPopoverItem>
      )}
      {onOpenSecurity && (
        <ActionPopoverItem
          icon={<ShieldCheck size={15} />}
          disabled={busy}
          onSelect={onOpenSecurity}
        >
          {t("safeExecution")}
        </ActionPopoverItem>
      )}
      {onRevealInFinder && (
        <ActionPopoverItem
          icon={<FolderOpen size={15} />}
          disabled={busy}
          onSelect={onRevealInFinder}
        >
          {t("revealInFinder")}
        </ActionPopoverItem>
      )}
      {onToggleProjectPinned && (
        <ActionPopoverItem
          icon={project.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
          disabled={busy}
          onSelect={onToggleProjectPinned}
        >
          {project.pinnedAt ? t("unpinProject") : t("pinProject")}
        </ActionPopoverItem>
      )}
      {onOpenDiagnostics && (
        <ActionPopoverItem
          icon={<Activity size={15} />}
          disabled={busy}
          onSelect={onOpenDiagnostics}
        >
          {t("usageDiagnostics")}
        </ActionPopoverItem>
      )}
    </ActionPopover>
  );
}

export function ProjectConversationItem({
  conversation,
  active,
  running = false,
  computerActive = false,
  disabled,
  onSelect,
  onRename,
  onTogglePinned,
  onArchive,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  running?: boolean;
  computerActive?: boolean;
  disabled: boolean;
  onSelect(): void;
  onRename?(title: string): Promise<void>;
  onTogglePinned?(): Promise<void>;
  onArchive?(archived: boolean): Promise<void>;
  onDelete?(): void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const menuRoot = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const manageable = Boolean(onRename || onTogglePinned || onArchive || onDelete);

  useEffect(() => {
    if (!editing) setDraftTitle(conversation.title);
  }, [conversation.title, editing]);

  useEffect(() => {
    if (!editing) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event: globalThis.PointerEvent) {
      if (
        event.target instanceof Node &&
        !menuRoot.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function runAction(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setActionError(undefined);
    try {
      await action();
      setMenuOpen(false);
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmRename() {
    const title = draftTitle.trim();
    if (!onRename || !title || busy) return;
    if (title === conversation.title) {
      setEditing(false);
      return;
    }
    if (await runAction(() => onRename(title))) setEditing(false);
  }

  return (
    <div
      className={`thread-item ${active ? "active" : ""} ${conversation.archivedAt ? "archived" : ""}`}
      title={actionError}
    >
      {actionError && (
        <span className="sr-only" role="alert">
          {actionError}
        </span>
      )}
      {editing ? (
        <form
          className="thread-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmRename();
          }}
        >
          <input
            ref={titleInput}
            value={draftTitle}
            maxLength={160}
            aria-label={t("renameTask")}
            disabled={busy}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraftTitle(conversation.title);
                setEditing(false);
              }
            }}
          />
          <button
            type="submit"
            className="thread-inline-action pressable"
            aria-label={t("saveRename")}
            title={t("saveRename")}
            disabled={busy || !draftTitle.trim()}
          >
            {busy ? <LoaderCircle className="spin" size={12} /> : <Check size={12} />}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="thread-item-select pressable"
          aria-current={active ? "page" : undefined}
          disabled={disabled}
          title={conversation.title}
          onClick={onSelect}
        >
          {conversation.pinnedAt && (
            <Pin
              className="thread-pinned-indicator"
              size={11}
              aria-label={t("pinnedTask")}
            />
          )}
          {conversation.archivedAt && (
            <Archive
              className="thread-archived-indicator"
              size={11}
              aria-label={t("archivedTask")}
            />
          )}
          <span className="thread-title">{conversation.title}</span>
          {(running || computerActive || conversation.unread) && (
            <span className="thread-live-indicators">
              {running && (
                <LoaderCircle
                  className="thread-runtime-indicator spin"
                  size={13}
                  aria-label={t("taskRunning", { title: conversation.title })}
                />
              )}
              {computerActive && (
                <ComputerUseIndicator
                  label={t("taskUsingComputer", { title: conversation.title })}
                />
              )}
              {conversation.unread && (
                <span
                  className="thread-unread-indicator"
                  aria-label={t("taskUnread", { title: conversation.title })}
                />
              )}
            </span>
          )}
        </button>
      )}
      {manageable && !editing && !running && !computerActive && (
        <div ref={menuRoot} className="thread-actions">
          <button
            type="button"
            className="thread-action-button pressable"
            disabled={disabled || busy}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("taskActions", { title: conversation.title })}
            title={t("taskActions", { title: conversation.title })}
            onClick={(event) => {
              setActionError(undefined);
              const open = !menuOpen;
              if (open) {
                const bounds = event.currentTarget.getBoundingClientRect();
                const menuHeight = conversation.archivedAt ? 132 : 103;
                const top =
                  window.innerHeight - bounds.bottom >= menuHeight + 8
                    ? bounds.bottom + 4
                    : Math.max(8, bounds.top - menuHeight - 4);
                setMenuPosition({
                  top,
                  left: Math.max(8, bounds.right - 154),
                });
              }
              setMenuOpen(open);
            }}
          >
            {busy ? <LoaderCircle className="spin" size={13} /> : <MoreHorizontal size={14} />}
          </button>
          {menuOpen && (
            <div
              className="thread-action-menu"
              role="menu"
              style={menuPosition}
            >
              {onRename && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                >
                  <PencilLine size={13} />
                  {t("renameTask")}
                </button>
              )}
              {onTogglePinned && !conversation.archivedAt && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runAction(onTogglePinned)}
                >
                  {conversation.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />}
                  {conversation.pinnedAt ? t("unpinTask") : t("pinTask")}
                </button>
              )}
              {onArchive && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void runAction(() =>
                      onArchive(!conversation.archivedAt),
                    )
                  }
                >
                  {conversation.archivedAt ? (
                    <ArchiveRestore size={13} />
                  ) : (
                    <Archive size={13} />
                  )}
                  {conversation.archivedAt
                    ? t("restoreArchivedTask")
                    : t("archiveTask")}
                </button>
              )}
              {onDelete && conversation.archivedAt && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={13} />
                  {t("deletePermanently")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function showsProjectLevelActivity(
  expanded: boolean,
  active: boolean,
): boolean {
  return active && !expanded;
}

export function conversationContextChanged(
  currentProjectId: string | undefined,
  currentThreadId: string | undefined,
  nextProjectId: string | undefined,
  nextThreadId: string | undefined,
): boolean {
  return (
    currentProjectId !== nextProjectId ||
    currentThreadId !== nextThreadId
  );
}

export function ownsActiveComputerShare(
  snapshot: ComputerShareSnapshot | undefined,
  threadId: string | undefined,
): snapshot is ComputerShareSnapshot {
  return !!snapshot?.active && snapshot.ownerThreadId === threadId;
}

function ComputerUseIndicator({ label }: { label: string }) {
  return (
    <span
      className="computer-use-indicator"
      role="img"
      aria-label={label}
      title={label}
    >
      <Monitor size={13} aria-hidden="true" />
      <span aria-hidden="true" />
    </span>
  );
}

export function DeleteConversationDialog({
  conversation,
  discard = false,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  conversation: ConversationSummary;
  discard?: boolean;
  deleting: boolean;
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t } = useI18n();
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [deleting, onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <section
        className="delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <span className="delete-dialog-icon" aria-hidden="true">
          <Trash2 size={18} />
        </span>
        <div className="delete-dialog-copy">
          <h2 id="delete-dialog-title">
            {discard ? t("discardTaskQuestion") : t("deleteTaskQuestion")}
          </h2>
          <p id="delete-dialog-description">
            {discard
              ? t("discardTaskConfirmDescription", {
                  title: conversation.title,
                })
              : t("deleteTaskDescription", { title: conversation.title })}
          </p>
          {error && <p className="delete-dialog-error">{error}</p>}
        </div>
        <div className="delete-dialog-actions">
          <button
            ref={cancelButton}
            type="button"
            className="dialog-button secondary pressable"
            disabled={deleting}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="dialog-button danger pressable"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting && <LoaderCircle className="spin" size={14} />}
            {deleting
              ? discard
                ? t("discardingTask")
                : t("deleting")
              : discard
                ? t("discardTask")
                : t("deleteTask")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ProjectEmptyState({
  error,
  opening,
  onOpen,
  onCreateStandalone,
  onConnectRemote,
}: {
  error?: string;
  opening: boolean;
  onOpen(): void;
  onCreateStandalone?(): void;
  onConnectRemote?(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="project-empty-state">
      <span className="project-empty-icon" aria-hidden="true">
        <FolderOpen size={23} />
      </span>
      <h1>{t("openProject")}</h1>
      <p>{t("openProjectDescription")}</p>
      {error && <p className="project-open-error">{error}</p>}
      <button
        type="button"
        className="project-open-button pressable"
        disabled={opening}
        onClick={onOpen}
      >
        {opening ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <FolderPlus size={15} />
        )}
        {opening ? t("opening") : t("openViaFolder")}
      </button>
      {onCreateStandalone && (
        <button
          type="button"
          className="project-remote-button pressable"
          disabled={opening}
          onClick={onCreateStandalone}
        >
          <X size={15} />
          {t("notInProject")}
        </button>
      )}
      {onConnectRemote && (
        <button
          type="button"
          className="project-remote-button pressable"
          disabled={opening}
          onClick={onConnectRemote}
        >
          <Server size={15} />
          {t("connectRemoteRuntime")}
        </button>
      )}
    </div>
  );
}

export function RemoteRuntimeDialog({
  hosts,
  activeHostId,
  busy,
  error,
  onCancel,
  onActivate,
  onUpdate,
  onDelete,
  onConnect,
  onResetError,
}: {
  hosts?: HostsSnapshot;
  activeHostId?: string;
  busy: boolean;
  error?: string;
  onCancel(): void;
  onActivate(hostId: string): void;
  onUpdate?(input: {
    hostId: string;
    endpoint: string;
    token?: string;
    name?: string;
  }): void;
  onDelete?(hostId: string): void;
  onConnect(input: { endpoint: string; token: string; name?: string }): void;
  onResetError?(): void;
}) {
  const { t } = useI18n();
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:7432");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [editingHostId, setEditingHostId] = useState<string>();
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (editingHostId && onUpdate) {
      onUpdate({
        hostId: editingHostId,
        endpoint: endpoint.trim(),
        ...(token.trim() ? { token } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      return;
    }
    onConnect({
      endpoint: endpoint.trim(),
      token,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
  }

  function editHost(host: HostSummary) {
    if (host.kind !== "remote" || !host.endpoint) return;
    setEditingHostId(host.id);
    setEndpoint(host.endpoint);
    setToken("");
    setName(host.name);
    onResetError?.();
    requestAnimationFrame(() => firstField.current?.focus());
  }

  function cancelEditing() {
    setEditingHostId(undefined);
    setEndpoint("http://127.0.0.1:7432");
    setToken("");
    setName("");
    onResetError?.();
    requestAnimationFrame(() => firstField.current?.focus());
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="connector-dialog remote-runtime-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-runtime-title"
        aria-describedby="remote-runtime-description"
      >
        <div className="connector-dialog-heading">
          <span className="connector-dialog-icon" aria-hidden="true">
            <Server size={18} />
          </span>
          <div>
            <h2 id="remote-runtime-title">{t("connectRemoteRuntime")}</h2>
            <p id="remote-runtime-description">
              {t("remoteRuntimeDescription")}
            </p>
          </div>
        </div>
        {hosts && hosts.hosts.length > 0 && (
          <div className="host-connection-list" aria-label={t("savedHosts")}>
            <p className="connector-section-label">{t("savedHosts")}</p>
            {hosts.hosts.map((host) => {
              const active = host.id === activeHostId;
              return (
                <div
                  key={host.id}
                  className={`host-connection-row ${active ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="host-connection-select pressable"
                    disabled={busy || active}
                    onClick={() => onActivate(host.id)}
                  >
                    <span className="host-connection-icon" aria-hidden="true">
                      {host.kind === "local" ? (
                        <Monitor size={15} />
                      ) : (
                        <Server size={15} />
                      )}
                    </span>
                    <span className="host-connection-copy">
                      <strong>{host.name}</strong>
                      <small>
                        {host.kind === "local"
                          ? t("localHost")
                          : host.endpoint}
                      </small>
                    </span>
                    {active && <Check size={14} aria-label={t("current")} />}
                  </button>
                  {host.kind === "remote" && (onUpdate || onDelete) && (
                    <span className="host-connection-actions">
                      {onUpdate && (
                        <button
                          type="button"
                          className="host-connection-edit pressable"
                          aria-label={t("editHost", { name: host.name })}
                          title={t("editHost", { name: host.name })}
                          disabled={busy}
                          onClick={() => editHost(host)}
                        >
                          <PencilLine size={14} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          className="host-connection-remove pressable"
                          aria-label={t("removeHost", { name: host.name })}
                          title={t("removeHost", { name: host.name })}
                          disabled={busy}
                          onClick={() => {
                            if (editingHostId === host.id) cancelEditing();
                            onDelete(host.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <form onSubmit={submit}>
          <p className="connector-section-label">
            {editingHostId ? t("editSavedHost") : t("connectNewHost")}
          </p>
          <div className="connector-fields">
            <label>
              <span>{t("remoteRuntimeEndpoint")}</span>
              <input
                ref={firstField}
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                required
                disabled={busy}
              />
            </label>
            <label>
              <span>{t("remoteRuntimeToken")}</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                required={!editingHostId}
                disabled={busy}
                placeholder={
                  editingHostId ? t("remoteRuntimeTokenKeep") : undefined
                }
              />
            </label>
            <label>
              <span>{t("remoteRuntimeName")}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                disabled={busy}
                placeholder={t("remoteRuntimeNameOptional")}
              />
            </label>
          </div>
          <p className="remote-runtime-security">
            <ShieldAlert size={14} />
            {t("remoteRuntimeSecurity")}
          </p>
          {error && <p className="connector-dialog-error">{error}</p>}
          <div className="connector-dialog-actions">
            <button
              type="button"
              className="dialog-button secondary pressable"
              disabled={busy}
              onClick={editingHostId ? cancelEditing : onCancel}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="dialog-button primary pressable"
              disabled={
                busy ||
                !endpoint.trim() ||
                (!editingHostId && !token.trim())
              }
            >
              {busy && <LoaderCircle className="spin" size={14} />}
              {busy
                ? editingHostId
                  ? t("saving")
                  : t("connectingRuntime")
                : editingHostId
                  ? t("saveChanges")
                  : t("connect")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RemoteProjectPathDialog({
  busy,
  error,
  hostName,
  onBrowse,
  onCancel,
  onOpen,
}: {
  busy: boolean;
  error?: string;
  hostName: string;
  onBrowse?(path: string): Promise<HostDirectoryListing>;
  onCancel(): void;
  onOpen(path: string): void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [directories, setDirectories] = useState<
    readonly HostDirectoryEntry[]
  >([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string>();
  const [directoryPosition, setDirectoryPosition] =
    useState<PopoverPosition>();
  const [directoryDismissed, setDirectoryDismissed] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const firstDirectory = useRef<HTMLButtonElement>(null);
  const browseRequest = useRef(0);

  useEffect(() => {
    firstField.current?.focus();
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, onCancel]);

  useEffect(() => {
    if (
      !onBrowse ||
      directoryDismissed ||
      (!path.startsWith("/") && path !== "~" && !path.startsWith("~/"))
    ) {
      setDirectoryPosition(undefined);
      setDirectories([]);
      setDirectoryError(undefined);
      setDirectoryLoading(false);
      return;
    }

    const request = ++browseRequest.current;
    const timeout = window.setTimeout(() => {
      const bounds = firstField.current?.getBoundingClientRect();
      if (!bounds) return;
      setDirectoryPosition(
        anchoredPopoverPosition(bounds, {
          width: Math.min(440, Math.max(320, bounds.width)),
          height: 260,
          align: "start",
          gap: 5,
        }),
      );
      setDirectoryLoading(true);
      setDirectoryError(undefined);
      void onBrowse(path)
        .then((listing) => {
          if (browseRequest.current !== request) return;
          setDirectories(listing.directories);
        })
        .catch((browseError) => {
          if (browseRequest.current !== request) return;
          setDirectories([]);
          setDirectoryError(errorMessage(browseError));
        })
        .finally(() => {
          if (browseRequest.current === request) {
            setDirectoryLoading(false);
          }
        });
    }, 120);
    return () => {
      window.clearTimeout(timeout);
      if (browseRequest.current === request) browseRequest.current += 1;
    };
  }, [directoryDismissed, onBrowse, path]);

  function selectDirectory(directory: HostDirectoryEntry) {
    setPath(
      directory.path.endsWith("/") ? directory.path : `${directory.path}/`,
    );
    setDirectoryDismissed(false);
    requestAnimationFrame(() => firstField.current?.focus());
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="connector-dialog remote-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-project-title"
      >
        <div className="connector-dialog-heading">
          <span className="connector-dialog-icon" aria-hidden="true">
            <FolderPlus size={18} />
          </span>
          <div>
            <h2 id="remote-project-title">{t("addRemoteProject")}</h2>
            <p>{t("addRemoteProjectDescription", { host: hostName })}</p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && path.trim()) onOpen(path.trim());
          }}
        >
          <div className="connector-fields">
            <label>
              <span>{t("remoteProjectPath")}</span>
              <input
                ref={firstField}
                value={path}
                onChange={(event) => {
                  setPath(event.target.value);
                  setDirectoryDismissed(false);
                }}
                onFocus={() => setDirectoryDismissed(false)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && directoryPosition) {
                    event.preventDefault();
                    firstDirectory.current?.focus();
                  } else if (event.key === "Escape" && directoryPosition) {
                    event.preventDefault();
                    event.stopPropagation();
                    setDirectoryDismissed(true);
                  }
                }}
                placeholder="/home/user/projects/example"
                autoComplete="off"
                spellCheck={false}
                required
                disabled={busy}
              />
            </label>
          </div>
          {directoryPosition && (
            <ActionPopover
              label={t("remoteFolders")}
              className="remote-directory-popover"
              role="dialog"
              position={directoryPosition}
              initialFocusRef={firstField}
              returnFocusRef={firstField}
              onClose={() => setDirectoryDismissed(true)}
            >
              <div
                className="remote-directory-list"
                role="listbox"
                aria-label={t("remoteFolders")}
              >
                {directoryLoading ? (
                  <p className="remote-directory-status" role="status">
                    <LoaderCircle className="spin" size={14} />
                    {t("loadingFolders")}
                  </p>
                ) : directoryError ? (
                  <p className="remote-directory-status error" role="status">
                    <TriangleAlert size={14} />
                    {directoryError}
                  </p>
                ) : directories.length === 0 ? (
                  <p className="remote-directory-status" role="status">
                    {t("noMatchingFolders")}
                  </p>
                ) : (
                  directories.map((directory, index) => (
                    <button
                      key={directory.path}
                      ref={index === 0 ? firstDirectory : undefined}
                      type="button"
                      role="option"
                      data-popover-item
                      aria-selected={false}
                      onClick={() => selectDirectory(directory)}
                    >
                      <span
                        className="remote-directory-option-icon"
                        aria-hidden="true"
                      >
                        <Folder size={15} />
                      </span>
                      <span className="remote-directory-option-copy">
                        <strong>{directory.name}</strong>
                        <small>{directory.path}</small>
                      </span>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  ))
                )}
              </div>
            </ActionPopover>
          )}
          {error && <p className="connector-dialog-error">{error}</p>}
          <div className="connector-dialog-actions">
            <button
              type="button"
              className="dialog-button secondary pressable"
              disabled={busy}
              onClick={onCancel}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="dialog-button primary pressable"
              disabled={busy || !path.trim()}
            >
              {busy && <LoaderCircle className="spin" size={14} />}
              {busy ? t("opening") : t("openProject")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function EmptyState({
  connecting,
  project,
  projects = [],
  suggestions,
  suggestionsLoading,
  suggestionsFailed,
  onRetrySuggestions,
  onSelectProject,
  onOpenProject,
  onCreateStandalone,
  onSelect,
}: {
  connecting: boolean;
  project?: ProjectSummary;
  projects?: readonly ProjectSummary[];
  suggestions: readonly string[];
  suggestionsLoading: boolean;
  suggestionsFailed: boolean;
  onRetrySuggestions(): void;
  onSelectProject?(projectId: string): void | Promise<void>;
  onOpenProject?(): void;
  onCreateStandalone?(): void;
  onSelect(value: string): void;
}) {
  const { t } = useI18n();
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      {connecting ? (
        <h2>{t("connectingRuntime")}</h2>
      ) : project &&
        project.scope !== "standalone" &&
        onSelectProject ? (
        <NewTaskProjectPrompt
          project={project}
          projects={projects}
          onSelectProject={onSelectProject}
          onOpenProject={onOpenProject}
          onCreateStandalone={onCreateStandalone}
        />
      ) : (
        <h2>{t("whatToDo")}</h2>
      )}
      {!connecting && (
        <div
          className="suggestions"
          aria-busy={suggestionsLoading || undefined}
        >
          {suggestionsLoading ? (
            <>
              <span className="visually-hidden" role="status">
                {t("generatingSuggestions")}
              </span>
              {[0, 1, 2].map((placeholder) => (
                <div
                  key={placeholder}
                  className="suggestion suggestion-placeholder"
                  aria-hidden="true"
                >
                  <span />
                </div>
              ))}
            </>
          ) : suggestionsFailed ? (
            <button
              type="button"
              className="suggestion suggestion-retry pressable"
              onClick={onRetrySuggestions}
            >
              <span>
                <strong>{t("suggestionsUnavailable")}</strong>
                {t("retrySuggestions")}
              </span>
              <RotateCcw size={14} />
            </button>
          ) : (
            suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion pressable"
                onClick={() => onSelect(suggestion)}
              >
                {suggestion}
                <ArrowUp size={14} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function filterProjectsForPicker(
  projects: readonly ProjectSummary[],
  query: string,
): readonly ProjectSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  const projectScoped = projects.filter(
    (project) => project.scope !== "standalone",
  );
  if (!normalized) return projectScoped;
  return projectScoped.filter((project) =>
    [project.name, project.basePath, project.runtime?.workspacePath]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function NewTaskProjectPrompt({
  project,
  projects,
  onSelectProject,
  onOpenProject,
  onCreateStandalone,
}: {
  project: ProjectSummary;
  projects: readonly ProjectSummary[];
  onSelectProject(projectId: string): void | Promise<void>;
  onOpenProject?(): void;
  onCreateStandalone?(): void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [pickerPosition, setPickerPosition] = useState<PopoverPosition>();
  const [query, setQuery] = useState("");
  const [selectingProjectId, setSelectingProjectId] = useState<string>();

  function openPicker() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    setQuery("");
    setPickerPosition(
      anchoredPopoverPosition(bounds, {
        width: 320,
        height: Math.min(
          470,
          72 +
            projects.length * 40 +
            (onOpenProject || onCreateStandalone ? 84 : 0),
        ),
        align: "start",
      }),
    );
  }

  function closePicker() {
    setPickerPosition(undefined);
    setQuery("");
  }

  async function selectProject(projectId: string) {
    closePicker();
    setSelectingProjectId(projectId);
    try {
      await onSelectProject(projectId);
    } finally {
      setSelectingProjectId(undefined);
    }
  }

  return (
    <>
      <h2 className="new-task-project-prompt">
        <span>{t("newTaskPromptBeforeProject")}</span>
        <button
          ref={trigger}
          type="button"
          className="new-task-project-trigger pressable"
          aria-haspopup="dialog"
          aria-expanded={Boolean(pickerPosition)}
          disabled={Boolean(selectingProjectId)}
          onClick={() =>
            pickerPosition ? closePicker() : openPicker()
          }
        >
          <span>{project.name}</span>
          {selectingProjectId ? (
            <LoaderCircle className="spin" size={16} />
          ) : null}
        </button>
        <span>{t("newTaskPromptAfterProject")}</span>
      </h2>
      {pickerPosition && (
        <ProjectPickerPopover
          projects={projects}
          currentProjectId={project.id}
          query={query}
          position={pickerPosition}
          triggerRef={trigger}
          searchInputRef={searchInput}
          selectingProjectId={selectingProjectId}
          onQueryChange={setQuery}
          onClose={closePicker}
          onSelect={(projectId) => void selectProject(projectId)}
          onOpenProject={onOpenProject}
          onCreateStandalone={onCreateStandalone}
        />
      )}
    </>
  );
}

export function ProjectPickerPopover({
  projects,
  currentProjectId,
  query,
  position,
  triggerRef,
  searchInputRef,
  selectingProjectId,
  onQueryChange,
  onClose,
  onSelect,
  onOpenProject,
  onCreateStandalone,
}: {
  projects: readonly ProjectSummary[];
  currentProjectId: string;
  query: string;
  position: PopoverPosition;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  selectingProjectId?: string;
  onQueryChange(value: string): void;
  onClose(): void;
  onSelect(projectId: string): void;
  onOpenProject?(): void;
  onCreateStandalone?(): void;
}) {
  const { t } = useI18n();
  const visibleProjects = filterProjectsForPicker(projects, query);

  return (
    <ActionPopover
      label={t("selectProject")}
      className="project-picker-popover"
      role="dialog"
      position={position}
      initialFocusRef={searchInputRef}
      returnFocusRef={triggerRef}
      onClose={onClose}
    >
      <label className="project-picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          aria-label={t("searchProjects")}
          placeholder={t("searchProjects")}
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visibleProjects[0]) {
              event.preventDefault();
              onSelect(visibleProjects[0].id);
            }
          }}
        />
      </label>
      <div
        className="project-picker-list"
        role="listbox"
        aria-label={t("selectProject")}
      >
        {visibleProjects.length === 0 ? (
          <p className="project-picker-empty" role="status">
            {t("noMatchingProjects")}
          </p>
        ) : (
          visibleProjects.map((candidate) => {
            const current = candidate.id === currentProjectId;
            const selecting = candidate.id === selectingProjectId;
            return (
              <button
                key={candidate.id}
                type="button"
                className={`project-picker-option${current ? " current" : ""}`}
                role="option"
                aria-selected={current}
                data-popover-item
                disabled={Boolean(selectingProjectId)}
                onClick={() => onSelect(candidate.id)}
              >
                <span className="project-picker-option-icon" aria-hidden="true">
                  {candidate.runtime?.kind === "remote" ? (
                    <Server size={17} />
                  ) : (
                    <Folder size={17} />
                  )}
                </span>
                <span className="project-picker-option-name">
                  {candidate.name}
                </span>
                {selecting ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : current ? (
                  <Check size={17} aria-hidden="true" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
      {(onOpenProject || onCreateStandalone) && (
        <div className="project-picker-actions">
          {onOpenProject && (
            <ActionPopoverItem
              icon={<Plus size={16} />}
              onSelect={() => {
                onClose();
                onOpenProject();
              }}
            >
              {t("newProject")}
            </ActionPopoverItem>
          )}
          {onCreateStandalone && (
            <ActionPopoverItem
              icon={<X size={16} />}
              onSelect={() => {
                onClose();
                onCreateStandalone();
              }}
            >
              {t("notInProject")}
            </ActionPopoverItem>
          )}
        </div>
      )}
    </ActionPopover>
  );
}

export function ProgressList({
  progress,
  live = false,
  onTerminateProcess,
  onOpenLocalFile,
  onRevealLocalFile,
}: {
  progress: readonly ConversationProgress[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
  onOpenLocalFile?(reference: LocalFileReference): void;
  onRevealLocalFile?(
    reference: LocalFileReference,
  ): void | Promise<void>;
}) {
  return (
    <div className="progress-list">
      {progress.map((step, index) => (
        <div className="progress-step" key={index}>
          {step.text.trim() && (
            <div className="progress-copy">
              <MarkdownContent
                onOpenLocalFile={onOpenLocalFile}
                onRevealLocalFile={onRevealLocalFile}
              >
                {step.text}
              </MarkdownContent>
            </div>
          )}
          {step.activities.length > 0 && (
            <ActivityList
              activities={step.activities}
              live={live}
              onTerminateProcess={onTerminateProcess}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function ActivityList({
  activities,
  live = false,
  onTerminateProcess,
}: {
  activities: readonly ToolActivity[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const hasAttentionActivity = activities.some(
    (activity) =>
      activity.status === "failed" ||
      activity.status === "terminated" ||
      activity.status === "completed_with_warnings",
  );
  const [expanded, setExpanded] = useState(live || hasAttentionActivity);
  const hasRunningActivity = activities.some(
    (activity) => activity.status === "running",
  );

  return (
    <details
      className={live ? "activity-list live" : "activity-list"}
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="activity-heading">
        <Terminal size={14} />
        <span>
          {live
            ? hasRunningActivity
              ? t("executing")
              : t("executed")
            : t("executionLog")}
        </span>
        <span className="activity-count">{activities.length}</span>
        <ChevronRight className="activity-chevron" size={13} aria-hidden="true" />
      </summary>
      <div className="activity-content">
        {activities.map((activity) => (
          <div
            id={`activity-${activity.id}`}
            className="activity-item"
            key={activity.id}
            tabIndex={-1}
          >
            <div className="activity-summary">
              <ActivityStatus status={activity.status} />
              <code>{activity.name}</code>
              {activity.name === "exec_command" &&
                activity.process?.status === "running" &&
                onTerminateProcess && (
                  <TerminateProcessButton
                    sessionId={activity.process.sessionId}
                    onTerminate={onTerminateProcess}
                  />
                )}
            </div>
            {activity.detail && <pre>{activity.detail}</pre>}
            {activity.name === "exec_command" && activity.process && (
              <CommandOutput process={activity.process} />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function ActivityStatus({ status }: Pick<ToolActivity, "status">) {
  if (status === "running") return <LoaderCircle className="spin" size={14} />;
  if (status === "failed") return <X className="failed" size={14} />;
  if (status === "completed_with_warnings") {
    return <TriangleAlert className="warning" size={14} />;
  }
  if (status === "terminated") {
    return <CircleStop className="terminated" size={14} />;
  }
  return <Check className="completed" size={14} />;
}

function CommandOutput({ process }: Pick<ToolActivity, "process">) {
  const { t } = useI18n();
  if (!process) return null;
  const output = [
    process.stdout,
    process.stderr ? `stderr\n${process.stderr}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <details className="command-output">
      <summary>
        <ChevronRight size={12} aria-hidden="true" />
        <span>{t("commandOutput")}</span>
        {process.truncated && <span className="output-note">{t("truncated")}</span>}
      </summary>
      <pre>{output || t("noOutput")}</pre>
    </details>
  );
}

function TerminateProcessButton({
  sessionId,
  onTerminate,
}: {
  sessionId: string;
  onTerminate(sessionId: string): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [terminating, setTerminating] = useState(false);
  const [error, setError] = useState(false);

  return (
    <>
      <button
        type="button"
        className="process-terminate-button pressable"
        disabled={terminating}
        title={t("terminateCommand")}
        aria-label={t("terminateCommand")}
        onClick={() => {
          setTerminating(true);
          setError(false);
          void onTerminate(sessionId).catch(() => {
            setTerminating(false);
            setError(true);
          });
        }}
      >
        {terminating ? (
          <LoaderCircle className="spin" size={12} />
        ) : (
          <CircleStop size={12} />
        )}
        {terminating ? t("terminating") : t("terminate")}
      </button>
      {error && (
        <span className="process-action-error" role="status">
          {t("terminateFailed")}
        </span>
      )}
    </>
  );
}

function ConnectionError({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  onRetry(): void;
  onOpenSettings?(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="connection-error">
      <span className="error-icon">
        <X size={16} />
      </span>
      <div>
        <strong>{t("runtimeConnectionFailed")}</strong>
        <p>{message}</p>
        <p className="error-help">{t("runtimeConnectionHelp")}</p>
        <div className="connection-actions">
          {onOpenSettings && (
            <button className="primary pressable" onClick={onOpenSettings}>
              {t("openSettings")}
            </button>
          )}
          <button className="secondary pressable" onClick={onRetry}>
            {t("reconnect")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MessageAttachments({
  attachments,
  attachmentPreview,
}: {
  attachments: readonly AttachmentData[];
  attachmentPreview?: AttachmentPreviewAdapter;
}) {
  const { t } = useI18n();
  const images = attachments
    .filter(
      (attachment) =>
        attachment.kind === "image" &&
        Boolean(
          attachmentPreview &&
            (previewUrlFor(attachmentPreview, attachment) ||
              attachmentPreview.loadImageUrl),
        ),
    );
  const imageIds = new Set(images.map((attachment) => attachment.id));
  const files = attachments.filter((attachment) => !imageIds.has(attachment.id));
  return (
    <div className="message-attachments" aria-label={t("messageAttachments")}>
      {images.length > 0 && (
        <div className="message-image-grid">
          {images.map((attachment) => (
            <AttachmentImage
              key={attachment.id}
              attachment={attachment}
              attachmentPreview={attachmentPreview!}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="message-file-list">
          {files.map((attachment) => (
            <div className="message-file" key={attachment.id}>
              <span className="attachment-file-icon">
                <FileText size={16} />
              </span>
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatFileSize(attachment.size)}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentImage({
  attachment,
  attachmentPreview,
}: {
  attachment: AttachmentData;
  attachmentPreview: AttachmentPreviewAdapter;
}) {
  const [url, setUrl] = useState(() =>
    previewUrlFor(attachmentPreview, attachment),
  );

  useEffect(() => {
    let active = true;
    const immediate = previewUrlFor(attachmentPreview, attachment);
    setUrl(immediate);
    if (!immediate && attachmentPreview.loadImageUrl) {
      void attachmentPreview
        .loadImageUrl(attachment)
        .then((loaded) => {
          if (active && loaded) setUrl(loaded);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [
    attachment.id,
    attachment.mimeType,
    attachment.path,
    attachmentPreview,
  ]);

  return url ? (
    <img
      src={url}
      alt={attachment.name}
      loading="lazy"
    />
  ) : (
    <div
      className="message-image-placeholder"
      aria-label={attachment.name}
    >
      <FileText size={18} />
      <span>{attachment.name}</span>
    </div>
  );
}

function previewUrlFor(
  attachmentPreview: AttachmentPreviewAdapter | undefined,
  attachment: AttachmentData,
): string | undefined {
  try {
    return attachmentPreview?.imageUrl(attachment);
  } catch {
    return undefined;
  }
}

function ComposerAttachments({
  attachments,
  onRemove,
  disabled,
}: {
  attachments: readonly PendingAttachment[];
  onRemove(id: string): void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="composer-attachments" aria-label={t("pendingAttachments")}>
      {attachments.map((attachment) => {
        const isImage = attachment.file.type.startsWith("image/");
        return (
          <div
            className={`composer-attachment ${isImage ? "image" : "file"}`}
            key={attachment.id}
            title={attachment.file.name}
          >
            {isImage && attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt={attachment.file.name} />
            ) : (
              <span className="attachment-file-icon">
                <FileText size={17} />
              </span>
            )}
            {!isImage && (
              <span className="composer-attachment-copy">
                <strong>{attachment.file.name}</strong>
                <small>{formatFileSize(attachment.file.size)}</small>
              </span>
            )}
            <button
              type="button"
              className="attachment-remove pressable"
              onClick={() => onRemove(attachment.id)}
              disabled={disabled}
              aria-label={t("removeFile", { name: attachment.file.name })}
              title={t("remove")}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function shortId(id?: string): string {
  return id ? id.slice(0, 8) : "—";
}

function connectionLabel(connection: string, t: Translate): string {
  if (connection === "ready") return t("runtimeConnected");
  if (connection === "error") return t("runtimeOffline");
  return t("connectionConnecting");
}

function voiceInputHint(
  status: VoiceInputStatus,
  error: string | undefined,
  t: Translate,
): string {
  if (error) return error;
  if (status === "requesting") return t("microphoneRequestHint");
  if (status === "recording") return t("recordingHint");
  if (status === "transcribing") return t("transcribingHint");
  return t("composerHint");
}

function attachmentHint(
  status: VoiceInputStatus,
  voiceError: string | undefined,
  attachmentError: string | undefined,
  submissionError: string | undefined,
  attachments: readonly PendingAttachment[],
  preparing: boolean,
  isRunning: boolean,
  t: Translate,
): string {
  if (voiceError || status !== "idle") {
    return voiceInputHint(status, voiceError, t);
  }
  if (attachmentError) return attachmentError;
  if (submissionError) return t("sendFailed", { message: submissionError });
  if (preparing) return t("preparingAttachments");
  if (attachments.length > 0) {
    return t("attachmentsAdded", { count: attachments.length });
  }
  if (isRunning) return t("runningComposerHint");
  return voiceInputHint(status, undefined, t);
}

export function composerSubmitDelivery(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, "metaKey" | "ctrlKey">,
  isRunning: boolean,
): "inject" | "queued" {
  return isRunning && (event.metaKey || event.ctrlKey)
    ? "queued"
    : "inject";
}

function hasFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function hasUserInput(
  messages: readonly { role: "user" | "assistant" }[],
): boolean {
  return messages.some((message) => message.role === "user");
}

export function projectContainingThread(
  snapshot: ProjectsSnapshot,
  threadId: string | undefined,
): ProjectSummary | undefined {
  if (!threadId) return;
  return snapshot.projects.find((project) =>
    project.conversations.some((conversation) => conversation.id === threadId),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
