import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type {
  AgentPlanData,
  AttachmentData,
  TurnMode,
} from "@threadlight/protocol";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleStop,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  FileDiff,
  FileText,
  LoaderCircle,
  ListTodo,
  Mic,
  Monitor,
  NotebookText,
  Paperclip,
  PanelRight,
  PencilLine,
  PictureInPicture2,
  RotateCcw,
  Settings,
  Sparkles,
  SquarePen,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import {
  useThreadlightSession,
  type ConversationProgress,
  type ToolActivity,
} from "./session.js";
import {
  MarkdownContent,
  workspaceFileReference,
  type LocalFileReference,
} from "./markdown.js";
import {
  ProjectMemoryPage,
  type ProjectMemoryAdapter,
} from "./memory.js";
import { isNearBottom } from "./scroll.js";
import { isTogglePanelShortcut } from "./keyboard-shortcuts.js";
import { SettingsPage, type SettingsAdapter } from "./settings.js";
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

export interface ThreadlightAppProps {
  client: ThreadlightClient;
  clipboard?: ClipboardAdapter;
  settings?: SettingsAdapter;
  projects?: ProjectsAdapter;
  memory?: ProjectMemoryAdapter;
  voiceInput?: VoiceInputAdapter;
  attachmentStage?: AttachmentStageAdapter;
  attachmentPreview?: AttachmentPreviewAdapter;
  computerShare?: ComputerShareAdapter;
  terminal?: TerminalAdapter;
  workspace?: WorkspaceAdapter;
  projectOpener?: ProjectOpenerAdapter;
}

export interface ClipboardAdapter {
  writeText(text: string): Promise<void>;
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

export interface AttachmentStageAdapter {
  stage(file: File): Promise<AttachmentData>;
}

export interface AttachmentPreviewAdapter {
  imageUrl(attachment: AttachmentData): string | undefined;
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
  projects,
  memory,
  voiceInput,
  attachmentStage,
  attachmentPreview,
  computerShare,
  terminal,
  workspace,
  projectOpener,
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
    state,
    retry,
    openThread,
    newThread,
    deleteThread,
    send,
    interrupt,
    terminateProcess,
    runningThreadIds,
  } = useThreadlightSession(client, { autoConnect: !projects });
  const [view, setView] = useState<"thread" | "memory" | "settings">("thread");
  const [input, setInput] = useState("");
  const [composerMode, setComposerMode] = useState<TurnMode>("default");
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectsSnapshot>();
  const [projectError, setProjectError] = useState<string>();
  const [switchingProject, setSwitchingProject] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    projectId: string;
    conversation: ConversationSummary;
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
  const textarea = useRef<HTMLTextAreaElement>(null);
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
  const currentProject = activeProject(projectSnapshot);
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

  const workspaceChangeRefreshKey =
    conversationChangesRefreshKey(state.progress);

  useEffect(() => {
    if (!projectOpener) return;
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
  }, [currentProject?.id, projectOpener]);

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
        preferredThreadId ?? project.conversations[0]?.id;
      await openThread(requestedThreadId);
    },
    [openThread, projects],
  );

  useEffect(() => {
    if (!projects) return;
    let active = true;
    void projects
      .load()
      .then(async (snapshot) => {
        if (!active) return;
        setProjectSnapshot(snapshot);
        await connectProject(snapshot);
      })
      .catch((error) => {
        if (active) setProjectError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [connectProject, projects]);

  useEffect(() => {
    const element = conversation.current;
    if (element && followOutput.current) element.scrollTop = element.scrollHeight;
  }, [
    state.messages.length,
    state.progress,
    state.streamingText,
  ]);

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

  async function submit(value = input) {
    if (voiceStatus !== "idle" || preparingAttachments) return;
    followOutput.current = true;
    const shouldNameConversation = !hasUserInput(state.messages);
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
    if (await send(value, stagedAttachments, composerMode)) {
      for (const attachment of draftAttachments) {
        if (attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      setInput("");
      setComposerMode("default");
      setAttachmentError(undefined);
      pendingAttachmentsRef.current = [];
      setPendingAttachments([]);
      if (textarea.current) textarea.current.style.height = "auto";
      if (projects && currentProject && state.threadId) {
        try {
          const existingTitle = currentProject.conversations.find(
            (conversation) => conversation.id === state.threadId,
          )?.title;
          const snapshot = await projects.upsertConversation({
            projectId: currentProject.id,
            id: state.threadId,
            title: shouldNameConversation
              ? conversationTitle(value || stagedAttachments[0]?.name || t("task"), t)
              : (existingTitle ??
                conversationTitle(
                  state.messages[0]?.text ||
                    value ||
                    stagedAttachments[0]?.name ||
                    t("task"),
                  t,
                )),
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
    if (!hasUserInput(state.messages)) {
      textarea.current?.focus();
      return;
    }
    await newThread();
  }

  async function openProjectFolder() {
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
      const snapshot = await projects.openFolder();
      setProjectSnapshot(snapshot);
      setView("thread");
      if (snapshot.activeProjectId === projectSnapshot?.activeProjectId) return;
      await connectProject(snapshot);
    } catch (error) {
      setProjectError(errorMessage(error));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function selectConversation(projectId: string, threadId?: string) {
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
      let snapshot = projectSnapshot;
      if (projectId !== projectSnapshot?.activeProjectId) {
        snapshot = await projects.activate(projectId);
        setProjectSnapshot(snapshot);
      }
      if (!snapshot) return;
      setView("thread");
      await connectProject(snapshot, threadId);
    } catch (error) {
      setProjectError(errorMessage(error));
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
    if (!workspace || !currentProject) return;
    const file = workspaceFileReference(reference, currentProject.basePath);
    if (!file) return;
    setWorkspacePanelOpen(true);
    setWorkspaceFileOpenRequest((current) => ({
      ...file,
      id: (current?.id ?? 0) + 1,
    }));
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
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      voiceStatus === "idle"
    ) {
      event.preventDefault();
      void submit();
    }
  }

  const globalActions = currentProject ? (
    <>
      {projectOpener && projectOpeners.length > 0 && (
        <ProjectOpenControl
          adapter={projectOpener}
          projectId={currentProject.id}
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

        <nav className="thread-list" aria-label={t("projectsAndTasks")}>
          {projects ? (
            <>
              <div className="project-list-heading">
                <p className="section-label">{t("projects")}</p>
                <div className="project-heading-actions">
                  {memory && currentProject && (
                    <button
                      type="button"
                      className={`icon-button pressable ${view === "memory" ? "active" : ""}`}
                      aria-current={view === "memory" ? "page" : undefined}
                      aria-label={t("projectMemoryFor", {
                        project: currentProject.name,
                      })}
                      disabled={switchingProject || voiceStatus !== "idle"}
                      title={t("projectMemoryFor", {
                        project: currentProject.name,
                      })}
                      onClick={() => {
                        cancelVoiceInput();
                        setView("memory");
                      }}
                    >
                      <NotebookText size={15} />
                    </button>
                  )}
                  <button
                    className="icon-button pressable"
                    type="button"
                    title={t("openProjectFolder")}
                    aria-label={t("openProjectFolder")}
                    disabled={
                      switchingProject ||
                      voiceStatus !== "idle"
                    }
                    onClick={() => void openProjectFolder()}
                  >
                    <FolderPlus size={15} />
                  </button>
                </div>
              </div>
              <div className="project-list-scroll">
                {projectSnapshot?.projects.map((project) => (
                  <ProjectGroup
                    key={project.id}
                    project={project}
                    active={project.id === projectSnapshot.activeProjectId}
                    activeThreadId={state.threadId}
                    runningThreadIds={runningThreadIds}
                    computerThreadId={computerShareSnapshot?.ownerThreadId}
                    disabled={
                      switchingProject ||
                      voiceStatus !== "idle"
                    }
                    onSelect={(threadId) =>
                      void selectConversation(project.id, threadId)
                    }
                    onDelete={(conversation) => {
                      setDeleteError(undefined);
                      setPendingDelete({ projectId: project.id, conversation });
                    }}
                  />
                ))}
                {projectSnapshot?.projects.length === 0 && (
                  <div className="thread-placeholder">{t("openFolderToStart")}</div>
                )}
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
          <div className="sidebar-status">
            <span
              className={`status-dot ${currentProject || !projects ? state.connection : "idle"}`}
            />
            <span>
              {currentProject || !projects
                ? connectionLabel(state.connection, t)
                : t("noProjectOpen")}
            </span>
            <span className="status-mode">{t("local")}</span>
          </div>
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
        {view === "memory" && memory && currentProject ? (
          <ProjectMemoryPage
            adapter={memory}
            projectId={currentProject.id}
            projectName={currentProject.name}
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
        ) : projects && !currentProject ? (
          <ProjectEmptyState
            error={projectError}
            opening={switchingProject}
            onOpen={() => void openProjectFolder()}
          />
        ) : (
          <>
            <header className="workspace-header">
              <div>
                <h1>{state.messages[0]?.text || t("task")}</h1>
                <p>
                  {currentProject?.basePath ?? "Agent runtime"} ·{" "}
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
                    onSelect={(value) => {
                      setInput(value);
                      textarea.current?.focus();
                    }}
                  />
                ) : (
                  <div className="message-list">
                    {state.messages.map((message) => (
                      <article
                        className={`message ${message.role} ${message.error ? "error" : ""}`}
                        key={message.id}
                      >
                        {message.role === "user" &&
                          message.attachments &&
                          message.attachments.length > 0 && (
                            <MessageAttachments
                              attachments={message.attachments}
                              attachmentPreview={attachmentPreview}
                            />
                          )}
                        {(message.text || message.role === "assistant") && (
                          <div className="message-body">
                            {message.progress && message.progress.length > 0 && (
                              <ProgressList
                                progress={message.progress}
                                onTerminateProcess={terminateProcess}
                                onOpenLocalFile={openLocalFile}
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
                              <MarkdownContent onOpenLocalFile={openLocalFile}>
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
                          />
                        )}
                        {state.streamingText.length > 0 && (
                          <div className="streaming-copy" aria-busy="true">
                            <MarkdownContent onOpenLocalFile={openLocalFile}>
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
                <div className="composer-row">
                  {attachmentStage && (
                    <button
                      type="button"
                      className="composer-action attach pressable"
                      onClick={() => fileInput.current?.click()}
                      disabled={
                        state.connection !== "ready" ||
                        state.isRunning ||
                        preparingAttachments ||
                        pendingAttachments.length >= MAX_COMPOSER_ATTACHMENTS
                      }
                      aria-label={t("addAttachment")}
                      title={t("addAttachment")}
                    >
                      <Paperclip size={17} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`composer-action plan-mode pressable ${composerMode === "plan" ? "active" : ""}`}
                    onClick={() =>
                      setComposerMode((mode) =>
                        mode === "plan" ? "default" : "plan",
                      )
                    }
                    disabled={
                      state.connection !== "ready" ||
                      state.isRunning ||
                      preparingAttachments
                    }
                    aria-label={t("planMode")}
                    aria-pressed={composerMode === "plan"}
                    title={
                      composerMode === "plan"
                        ? t("planModeOn")
                        : t("planMode")
                    }
                  >
                    <ListTodo size={16} />
                    <span>{t("plan")}</span>
                  </button>
                  <textarea
                    ref={textarea}
                    value={input}
                    rows={1}
                    placeholder={
                      voiceStatus === "recording"
                        ? t("listening")
                        : t("askThreadlight")
                    }
                    disabled={state.connection !== "ready"}
                    onChange={(event) => {
                      setInput(event.target.value);
                      setVoiceError(undefined);
                    }}
                    onKeyDown={handleKeyDown}
                    onInput={(event) => {
                      event.currentTarget.style.height = "auto";
                      event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
                    }}
                    aria-label={t("message")}
                    aria-describedby="composer-hint"
                  />
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
                      <Square size={12} fill="currentColor" strokeWidth={0} />
                    ) : (
                      <Mic size={17} />
                    )}
                  </button>
                  )}
                  {state.isRunning ? (
                  <button
                    className="composer-action stop pressable"
                    onClick={stopRunningTurn}
                    aria-label={t("stopRun")}
                    title={t("stop")}
                  >
                    <CircleStop size={18} />
                  </button>
                ) : (
                  <button
                    className="composer-action send pressable"
                    onClick={() => void submit()}
                    disabled={
                      (!input.trim() && pendingAttachments.length === 0) ||
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
            projectName={currentProject.name}
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
            projectName={currentProject.name}
            onClose={() => setTerminalOpen(false)}
          />
        )}
      </main>
      {pendingDelete && (
        <DeleteConversationDialog
          conversation={pendingDelete.conversation}
          deleting={deletingConversation}
          error={deleteError}
          onCancel={() => {
            setPendingDelete(undefined);
            setDeleteError(undefined);
          }}
          onConfirm={() => void confirmDeleteConversation()}
        />
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

export function ProjectGroup({
  project,
  active,
  activeThreadId,
  runningThreadIds = [],
  computerThreadId,
  disabled,
  onSelect,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  runningThreadIds?: readonly string[];
  computerThreadId?: string;
  disabled: boolean;
  onSelect(threadId?: string): void;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const projectRunning = project.conversations.some((conversation) =>
    runningThreadIds.includes(conversation.id),
  );
  const projectUsingComputer = project.conversations.some(
    (conversation) => conversation.id === computerThreadId,
  );

  function toggleExpanded() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !active) onSelect(project.conversations[0]?.id);
  }

  return (
    <section className="project-group" aria-label={project.name}>
      <button
        type="button"
        className="project-row pressable"
        aria-current={active ? "location" : undefined}
        aria-expanded={expanded}
        disabled={disabled}
        title={project.basePath}
        onClick={toggleExpanded}
      >
        {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span className="project-name">{project.name}</span>
        {(showsProjectLevelActivity(expanded, projectRunning) ||
          showsProjectLevelActivity(expanded, projectUsingComputer)) && (
          <span className="project-live-indicators">
            {showsProjectLevelActivity(expanded, projectRunning) && (
              <LoaderCircle
                className="project-runtime-indicator spin"
                size={13}
                aria-label={t("projectTaskRunning", { project: project.name })}
              />
            )}
            {showsProjectLevelActivity(expanded, projectUsingComputer) && (
              <ComputerUseIndicator
                label={t("projectTaskUsingComputer", { project: project.name })}
              />
            )}
          </span>
        )}
        <ChevronRight className="project-chevron" size={14} />
      </button>
      {expanded && (
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

export function ProjectConversationItem({
  conversation,
  active,
  running = false,
  computerActive = false,
  disabled,
  onSelect,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  running?: boolean;
  computerActive?: boolean;
  disabled: boolean;
  onSelect(): void;
  onDelete?(): void;
}) {
  const { t } = useI18n();
  return (
    <div className={`thread-item ${active ? "active" : ""}`}>
      <button
        type="button"
        className="thread-item-select pressable"
        aria-current={active ? "page" : undefined}
        disabled={disabled}
        title={conversation.title}
        onClick={onSelect}
      >
        <span className="thread-title">{conversation.title}</span>
        {(running || computerActive) && (
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
          </span>
        )}
      </button>
      {onDelete && !running && !computerActive && (
        <button
          type="button"
          className="thread-delete-button pressable"
          disabled={disabled}
          title={t("deleteNamedTask", { title: conversation.title })}
          aria-label={t("deleteNamedTask", { title: conversation.title })}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
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
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  conversation: ConversationSummary;
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
          <h2 id="delete-dialog-title">{t("deleteTaskQuestion")}</h2>
          <p id="delete-dialog-description">
            {t("deleteTaskDescription", { title: conversation.title })}
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
            {deleting ? t("deleting") : t("deleteTask")}
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
}: {
  error?: string;
  opening: boolean;
  onOpen(): void;
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
    </div>
  );
}

export function EmptyState({
  connecting,
  suggestions,
  suggestionsLoading,
  suggestionsFailed,
  onRetrySuggestions,
  onSelect,
}: {
  connecting: boolean;
  suggestions: readonly string[];
  suggestionsLoading: boolean;
  suggestionsFailed: boolean;
  onRetrySuggestions(): void;
  onSelect(value: string): void;
}) {
  const { t } = useI18n();
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      <h2>{connecting ? t("connectingRuntime") : t("whatToDo")}</h2>
      <p>{t("emptyDescription")}</p>
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

export function ProgressList({
  progress,
  live = false,
  onTerminateProcess,
  onOpenLocalFile,
}: {
  progress: readonly ConversationProgress[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
  onOpenLocalFile?(reference: LocalFileReference): void;
}) {
  return (
    <div className="progress-list">
      {progress.map((step, index) => (
        <div className="progress-step" key={index}>
          {step.text.trim() && (
            <div className="progress-copy">
              <MarkdownContent onOpenLocalFile={onOpenLocalFile}>
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
  const hasFailedActivity = activities.some(
    (activity) =>
      activity.status === "failed" || activity.status === "terminated",
  );
  const [expanded, setExpanded] = useState(live || hasFailedActivity);
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
          <div className="activity-item" key={activity.id}>
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
    .filter((attachment) => attachment.kind === "image")
    .flatMap((attachment) => {
      const url = previewUrlFor(attachmentPreview, attachment);
      return url ? [{ attachment, url }] : [];
    });
  const imageIds = new Set(images.map(({ attachment }) => attachment.id));
  const files = attachments.filter((attachment) => !imageIds.has(attachment.id));
  return (
    <div className="message-attachments" aria-label={t("messageAttachments")}>
      {images.length > 0 && (
        <div className="message-image-grid">
          {images.map(({ attachment, url }) => (
            <img
              key={attachment.id}
              src={url}
              alt={attachment.name}
              loading="lazy"
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
  return voiceInputHint(status, undefined, t);
}

function hasFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function conversationTitle(value: string, t: Translate): string {
  const title = value.trim().replace(/\s+/g, " ");
  return title.length > 56 ? `${title.slice(0, 56)}…` : title || t("task");
}

export function hasUserInput(
  messages: readonly { role: "user" | "assistant" }[],
): boolean {
  return messages.some((message) => message.role === "user");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
