import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type { AttachmentData } from "@threadlight/protocol";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleStop,
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  LoaderCircle,
  Mic,
  NotebookText,
  Paperclip,
  PictureInPicture2,
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
  type PendingApproval,
  type ToolActivity,
} from "./session.js";
import { MarkdownContent } from "./markdown.js";
import {
  ProjectMemoryPage,
  type ProjectMemoryAdapter,
} from "./memory.js";
import { isNearBottom } from "./scroll.js";
import { SettingsPage, type SettingsAdapter } from "./settings.js";
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

export interface ThreadlightAppProps {
  client: ThreadlightClient;
  settings?: SettingsAdapter;
  projects?: ProjectsAdapter;
  memory?: ProjectMemoryAdapter;
  voiceInput?: VoiceInputAdapter;
  attachmentStage?: AttachmentStageAdapter;
  attachmentPreview?: AttachmentPreviewAdapter;
  computerShare?: ComputerShareAdapter;
}

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

type VoiceInputStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing";

const suggestions = [
  "解释这个代码库的架构",
  "运行测试并修复失败",
  "帮我规划下一个功能",
];

export function ThreadlightApp({
  client,
  settings,
  projects,
  memory,
  voiceInput,
  attachmentStage,
  attachmentPreview,
  computerShare,
}: ThreadlightAppProps) {
  const {
    state,
    retry,
    openThread,
    newThread,
    deleteThread,
    send,
    interrupt,
    terminateProcess,
    resolveApproval,
  } = useThreadlightSession(client, { autoConnect: !projects });
  const [view, setView] = useState<"thread" | "memory" | "settings">("thread");
  const [input, setInput] = useState("");
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaRecorder = useRef<MediaRecorder | undefined>(undefined);
  const mediaStream = useRef<MediaStream | undefined>(undefined);
  const recordedChunks = useRef<Blob[]>([]);
  const voiceOperation = useRef(0);
  const dragDepth = useRef(0);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const conversation = useRef<HTMLElement>(null);
  const followOutput = useRef(true);
  const wasRunning = useRef(state.isRunning);
  const currentProject = activeProject(projectSnapshot);

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
    const turnEnded = shouldStopComputerShare(
      wasRunning.current,
      state.isRunning,
    );
    wasRunning.current = state.isRunning;
    if (!turnEnded || !computerShare) return;
    void computerShare
      .stop()
      .then((snapshot) => {
        setComputerShareSnapshot(snapshot);
        setComputerShareError(undefined);
      })
      .catch((error) => setComputerShareError(errorMessage(error)));
  }, [computerShare, state.isRunning]);

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
    state.approval,
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
        throw new Error("当前环境不支持麦克风录音。");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("当前环境不支持语音输入。");
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
        setVoiceError("录音意外中断，请重试。");
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
      setVoiceError(voiceInputErrorMessage(error));
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
      if (recording.size === 0) throw new Error("没有录到声音，请重试。");
      if (recording.size > MAX_VOICE_AUDIO_BYTES) {
        throw new Error("录音超过 25 MB，请缩短后重试。");
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
        setVoiceError(voiceInputErrorMessage(error));
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
    if (await send(value, stagedAttachments)) {
      for (const attachment of draftAttachments) {
        if (attachment.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      setInput("");
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
              ? conversationTitle(value || stagedAttachments[0]?.name || "新任务")
              : (existingTitle ??
                conversationTitle(
                  state.messages[0]?.text || value || stagedAttachments[0]?.name || "新任务",
                )),
          });
          setProjectSnapshot(snapshot);
        } catch (error) {
          setProjectError(errorMessage(error));
        }
      }
    }
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
      state.isRunning ||
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
      state.isRunning ||
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
    const deletingActiveConversation =
      target.projectId === projectSnapshot?.activeProjectId &&
      target.conversation.id === state.threadId;
    setDeletingConversation(true);
    setDeleteError(undefined);

    try {
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
    if (!computerShare) return;
    void computerShare
      .stop()
      .then((snapshot) => {
        setComputerShareSnapshot(snapshot);
        setComputerShareError(undefined);
      })
      .catch((error) => setComputerShareError(errorMessage(error)));
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag-region" />
        <button
          className="new-thread-button project-row pressable"
          onClick={() => void createThread()}
          disabled={
            !currentProject ||
            state.isRunning ||
            state.connection !== "ready" ||
            switchingProject ||
            voiceStatus !== "idle"
          }
        >
          <SquarePen size={16} />
          <span>新建任务</span>
        </button>

        <nav className="thread-list" aria-label="项目与任务列表">
          {projects ? (
            <>
              <div className="project-list-heading">
                <p className="section-label">项目</p>
                <div className="project-heading-actions">
                  {memory && currentProject && (
                    <button
                      type="button"
                      className={`icon-button pressable ${view === "memory" ? "active" : ""}`}
                      aria-current={view === "memory" ? "page" : undefined}
                      aria-label={`${currentProject.name} 的项目记忆`}
                      disabled={switchingProject || voiceStatus !== "idle"}
                      title={`${currentProject.name} 的项目记忆`}
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
                    title="通过文件夹打开项目"
                    aria-label="通过文件夹打开项目"
                    disabled={
                      state.isRunning ||
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
                    disabled={
                      state.isRunning ||
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
                  <div className="thread-placeholder">打开一个文件夹开始</div>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="section-label">当前</p>
              {state.threadId ? (
                <div className="thread-item active" aria-current="page">
                  <span className="thread-title">
                    {state.messages[0]?.text || "新任务"}
                  </span>
                  <span className="thread-id">{shortId(state.threadId)}</span>
                </div>
              ) : (
                <div className="thread-placeholder">正在准备任务…</div>
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
              设置
            </button>
          )}
          <div className="sidebar-status">
            <span
              className={`status-dot ${currentProject || !projects ? state.connection : "idle"}`}
            />
            <span>
              {currentProject || !projects
                ? connectionLabel(state.connection)
                : "未打开项目"}
            </span>
            <span className="status-mode">本地</span>
          </div>
        </div>
      </aside>

      <main
        className={`workspace ${isDraggingFiles ? "is-dragging-files" : ""}`}
        onPaste={handlePaste}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
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
                <h1>{state.messages[0]?.text || "新任务"}</h1>
                <p>
                  {currentProject?.basePath ?? "Agent runtime"} ·{" "}
                  {shortId(state.threadId)}
                </p>
              </div>
              {state.isRunning && (
                <span className="running-badge">
                  <LoaderCircle size={13} /> 正在运行
                </span>
              )}
            </header>

            <section
              ref={conversation}
              className="conversation"
              aria-live="polite"
              onScroll={(event) => {
                followOutput.current = isNearBottom(event.currentTarget);
              }}
            >
              <div className="conversation-inner">
                {state.connection === "error" && (
                  <ConnectionError
                    message={state.connectionError ?? "无法连接 app-server"}
                    onRetry={() => void retry()}
                    onOpenSettings={settings ? () => setView("settings") : undefined}
                  />
                )}

                {state.messages.length === 0 && state.connection !== "error" ? (
                  <EmptyState
                    connecting={state.connection === "connecting"}
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
                              <MarkdownContent>{message.text}</MarkdownContent>
                            ) : (
                              <p>{message.text}</p>
                            )}
                          </div>
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
                          />
                        )}
                        {state.streamingText.length > 0 && (
                          <div className="streaming-copy" aria-busy="true">
                            <MarkdownContent>{state.streamingText}</MarkdownContent>
                          </div>
                        )}
                        {state.isThinking && (
                          <div className="thinking-row">
                            <LoaderCircle size={15} />
                            正在思考…
                          </div>
                        )}
                      </div>
                    )}

                    {state.approval && (
                      <ApprovalCard
                        approval={state.approval}
                        onResolve={(approved) => void resolveApproval(approved)}
                      />
                    )}
                  </div>
                )}
              </div>
            </section>

            <footer className="composer-wrap">
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
                {computerShareSnapshot?.active && (
                  <ComputerShareStatus
                    snapshot={computerShareSnapshot}
                    busy={showingComputerShare}
                    error={computerShareError}
                    onShow={() => void showComputerSharePreview()}
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
                      aria-label="添加图片或文件"
                      title="添加图片或文件"
                    >
                      <Paperclip size={17} />
                    </button>
                  )}
                  <textarea
                    ref={textarea}
                    value={input}
                    rows={1}
                    placeholder={
                      voiceStatus === "recording"
                        ? "正在聆听…"
                        : "向 Threadlight 提问…"
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
                    aria-label="消息"
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
                        ? "结束录音"
                        : voiceStatus === "requesting"
                          ? "正在请求麦克风权限"
                        : voiceStatus === "transcribing"
                          ? "正在转写语音"
                          : "语音输入"
                    }
                    aria-pressed={voiceStatus === "recording"}
                    title={voiceStatus === "recording" ? "结束录音" : "语音输入"}
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
                    aria-label="停止运行"
                    title="停止"
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
                    aria-label="发送消息"
                    title="发送"
                  >
                    <ArrowUp size={18} strokeWidth={2.4} />
                  </button>
                  )}
                </div>
              </div>
              <p
                id="composer-hint"
                className={`composer-hint ${voiceError || attachmentError ? "error" : ""}`}
                aria-live="polite"
              >
                {attachmentHint(
                  voiceStatus,
                  voiceError,
                  attachmentError,
                  pendingAttachments,
                  preparingAttachments,
                )}
              </p>
            </footer>
            {isDraggingFiles && (
              <div className="attachment-drop-overlay" aria-hidden="true">
                <div>
                  <Paperclip size={20} />
                  <span>拖到这里添加到对话</span>
                </div>
              </div>
            )}
          </>
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

export function shouldStopComputerShare(
  wasRunning: boolean,
  isRunning: boolean,
): boolean {
  return wasRunning && !isRunning;
}

export function ComputerShareStatus({
  snapshot,
  busy,
  error,
  onShow,
}: {
  snapshot: ComputerShareSnapshot;
  busy: boolean;
  error?: string;
  onShow(): void;
}) {
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
      : `${snapshot.targets.length} 个窗口`;

  return (
    <div className="composer-share" aria-live="polite">
      <span className="composer-share-icon" aria-hidden="true">
        <PictureInPicture2 size={14} />
        <span />
      </span>
      <span className="composer-share-copy">
        <strong>
          正在共享
          {snapshot.targets.length > 1
            ? ` ${snapshot.targets.length} 个窗口`
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
        {busy && <LoaderCircle className="spin" size={12} />}
        {snapshot.pictureInPicture ? "显示画中画" : "重新打开"}
      </button>
    </div>
  );
}

export function ProjectGroup({
  project,
  active,
  activeThreadId,
  disabled,
  onSelect,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  activeThreadId?: string;
  disabled: boolean;
  onSelect(threadId?: string): void;
  onDelete?(conversation: ConversationSummary): void;
}) {
  const [expanded, setExpanded] = useState(false);

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
        <span>{project.name}</span>
        <ChevronRight className="project-chevron" size={14} />
      </button>
      {expanded && (
        <div className="project-conversations">
          {project.conversations.map((conversation) => (
            <ProjectConversationItem
              key={conversation.id}
              conversation={conversation}
              active={active && conversation.id === activeThreadId}
              disabled={disabled}
              onSelect={() => onSelect(conversation.id)}
              onDelete={onDelete ? () => onDelete(conversation) : undefined}
            />
          ))}
          {project.conversations.length === 0 && (
            <span className="project-empty-label">暂无任务</span>
          )}
        </div>
      )}
    </section>
  );
}

export function ProjectConversationItem({
  conversation,
  active,
  disabled,
  onSelect,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  disabled: boolean;
  onSelect(): void;
  onDelete?(): void;
}) {
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
      </button>
      {onDelete && (
        <button
          type="button"
          className="thread-delete-button pressable"
          disabled={disabled}
          title={`删除“${conversation.title}”`}
          aria-label={`删除任务“${conversation.title}”`}
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
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
          <h2 id="delete-dialog-title">删除任务？</h2>
          <p id="delete-dialog-description">
            “{conversation.title}”及其对话记录将被永久删除，此操作无法撤销。
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
            取消
          </button>
          <button
            type="button"
            className="dialog-button danger pressable"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting && <LoaderCircle className="spin" size={14} />}
            {deleting ? "正在删除…" : "删除任务"}
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
  return (
    <div className="project-empty-state">
      <span className="project-empty-icon" aria-hidden="true">
        <FolderOpen size={23} />
      </span>
      <h1>打开一个项目</h1>
      <p>
        选择项目文件夹后，任务会按项目整理，运行时也会以该目录为 base 地址。
      </p>
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
        {opening ? "正在打开…" : "通过文件夹打开"}
      </button>
    </div>
  );
}

function EmptyState({
  connecting,
  onSelect,
}: {
  connecting: boolean;
  onSelect(value: string): void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark" aria-hidden="true">
        <Sparkles size={22} />
      </div>
      <h2>{connecting ? "正在连接运行时…" : "今天想推进什么？"}</h2>
      <p>描述目标，Threadlight 会展示每一步模型调用和工具执行。</p>
      {!connecting && (
        <div className="suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              className="suggestion pressable"
              onClick={() => onSelect(suggestion)}
            >
              {suggestion}
              <ArrowUp size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProgressList({
  progress,
  live = false,
  onTerminateProcess,
}: {
  progress: readonly ConversationProgress[];
  live?: boolean;
  onTerminateProcess?(sessionId: string): Promise<unknown>;
}) {
  return (
    <div className="progress-list">
      {progress.map((step, index) => (
        <div className="progress-step" key={index}>
          {step.text.trim() && (
            <div className="progress-copy">
              <MarkdownContent>{step.text}</MarkdownContent>
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
  const [expanded, setExpanded] = useState(live);
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
          {live ? (hasRunningActivity ? "执行中" : "已执行") : "执行记录"}
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
        <span>命令行输出</span>
        {process.truncated && <span className="output-note">已截断</span>}
      </summary>
      <pre>{output || "暂无输出"}</pre>
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
  const [terminating, setTerminating] = useState(false);
  const [error, setError] = useState(false);

  return (
    <>
      <button
        type="button"
        className="process-terminate-button pressable"
        disabled={terminating}
        title="结束该命令"
        aria-label="结束该命令"
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
        {terminating ? "正在结束" : "结束"}
      </button>
      {error && (
        <span className="process-action-error" role="status">
          结束失败
        </span>
      )}
    </>
  );
}

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: PendingApproval;
  onResolve(approved: boolean): void;
}) {
  return (
    <div className="approval-card">
      <div className="approval-icon">
        <Terminal size={16} />
      </div>
      <div className="approval-content">
        <strong>允许执行 {approval.call.name}？</strong>
        <p>此工具将以当前用户权限在本地运行。</p>
        <pre>{formatArguments(approval.call.arguments)}</pre>
        <div className="approval-actions">
          <button className="secondary pressable" onClick={() => onResolve(false)}>
            拒绝
          </button>
          <button className="primary pressable" onClick={() => onResolve(true)}>
            允许
          </button>
        </div>
      </div>
    </div>
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
  return (
    <div className="connection-error">
      <span className="error-icon">
        <X size={16} />
      </span>
      <div>
        <strong>无法连接到运行时</strong>
        <p>{message}</p>
        <p className="error-help">请在设置中检查模型厂商与 API Key，然后重新连接。</p>
        <div className="connection-actions">
          {onOpenSettings && (
            <button className="primary pressable" onClick={onOpenSettings}>
              打开设置
            </button>
          )}
          <button className="secondary pressable" onClick={onRetry}>
            重新连接
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
  const images = attachments
    .filter((attachment) => attachment.kind === "image")
    .flatMap((attachment) => {
      const url = previewUrlFor(attachmentPreview, attachment);
      return url ? [{ attachment, url }] : [];
    });
  const imageIds = new Set(images.map(({ attachment }) => attachment.id));
  const files = attachments.filter((attachment) => !imageIds.has(attachment.id));
  return (
    <div className="message-attachments" aria-label="消息附件">
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
  return (
    <div className="composer-attachments" aria-label="待发送附件">
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
              aria-label={`移除 ${attachment.file.name}`}
              title="移除"
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

function connectionLabel(connection: string): string {
  if (connection === "ready") return "运行时已连接";
  if (connection === "error") return "运行时离线";
  return "正在连接";
}

function voiceInputHint(status: VoiceInputStatus, error?: string): string {
  if (error) return error;
  if (status === "requesting") return "正在请求麦克风权限…";
  if (status === "recording") return "正在聆听 · 点击红色按钮完成 · Esc 取消";
  if (status === "transcribing") return "正在将语音转成文字…";
  return "Enter 发送 · Shift + Enter 换行";
}

function attachmentHint(
  status: VoiceInputStatus,
  voiceError: string | undefined,
  attachmentError: string | undefined,
  attachments: readonly PendingAttachment[],
  preparing: boolean,
): string {
  if (voiceError || status !== "idle") return voiceInputHint(status, voiceError);
  if (attachmentError) return attachmentError;
  if (preparing) return "正在准备附件…";
  if (attachments.length > 0) return `已添加 ${attachments.length} 个附件 · Enter 发送`;
  return voiceInputHint(status);
}

function hasFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatArguments(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function conversationTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  return title.length > 56 ? `${title.slice(0, 56)}…` : title || "新任务";
}

export function hasUserInput(
  messages: readonly { role: "user" | "assistant" }[],
): boolean {
  return messages.some((message) => message.role === "user");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
