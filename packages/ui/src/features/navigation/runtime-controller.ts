import { useEffect, useRef, useState, type RefObject } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type { ConversationAccessMode } from "@threadlight/protocol";

import type { AutomationAdapter } from "../../automations.js";
import type {
  CommandPaletteEntry,
  CommandPaletteMode,
  SearchAdapter,
} from "../../command-palette.js";
import {
  isCommandPaletteShortcut,
  isFileSearchShortcut,
} from "../../keyboard-shortcuts.js";
import {
  activeProject,
  type ConversationSummary,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "../../projects.js";
import type {
  ProjectOpenerAdapter,
  ProjectOpenerId,
} from "../../project-opener.js";
import type { SettingsAdapter } from "../../settings.js";
import { isLanguage, type Language, type Translate } from "../../i18n.js";
import { isThemePreference, type ThemePreference } from "../../theme.js";
import type {
  WorkspaceAdapter,
  WorkspaceFileOpenRequest,
} from "../../workspace-panel.js";
import { errorMessage } from "../shared/format.js";
import type { VoiceInputStatus } from "../shared/adapters.js";
import {
  completeFirstRun,
  MOBILE_SIDEBAR_QUERY,
  SIDEBAR_VISIBILITY_KEY,
  sidebarStartsOpen,
  storedSidebarVisibility,
} from "./controller.js";
import { restoredThreadRoute } from "./startup.js";
import type { useNavigationController } from "./controller.js";

type NavigationState = ReturnType<typeof useNavigationController>;

interface StandaloneDraftTransition {
  setProjectSnapshot(snapshot: ProjectsSnapshot): void;
  closeConversationPanels(): void;
  showThread(): void;
  beginDraft(): void;
}

export function enterStandaloneDraft(
  snapshot: ProjectsSnapshot,
  transition: StandaloneDraftTransition,
): void {
  transition.setProjectSnapshot(snapshot);
  transition.closeConversationPanels();
  transition.showThread();
  transition.beginDraft();
}

interface NavigationRuntimeOptions {
  client: ThreadlightClient;
  navigation: NavigationState;
  projects?: ProjectsAdapter;
  settings?: SettingsAdapter;
  search?: SearchAdapter;
  automations?: AutomationAdapter;
  workspace?: WorkspaceAdapter;
  projectOpener?: ProjectOpenerAdapter;
  initialThreadId?: string;
  initialProjects?: ProjectsSnapshot;
  initialSettingsProvided: boolean;
  activeThread: {
    threadId?: string;
    recovery?: unknown;
    hasUserInput: boolean;
  };
  displayedThreadId?: string;
  newTaskDraft: boolean;
  voiceStatus: VoiceInputStatus;
  textarea: RefObject<HTMLTextAreaElement | null>;
  beginDraft(): void;
  selectExistingTask(): void;
  connectProject(
    snapshot: ProjectsSnapshot,
    preferredThreadId?: string,
  ): Promise<void>;
  cancelVoiceInput(): void;
  closeConversationPanels(): void;
  openReviewPanel(): void;
  stopComputerShare(): Promise<boolean>;
  deleteThread(threadId: string): Promise<boolean>;
  retryRuntime(): Promise<unknown>;
  setWorkspacePanelOpen(value: boolean | ((open: boolean) => boolean)): void;
  setTerminalOpen(value: boolean | ((open: boolean) => boolean)): void;
  setWorkspaceFileOpenRequest(
    value:
      | WorkspaceFileOpenRequest
      | ((current?: WorkspaceFileOpenRequest) => WorkspaceFileOpenRequest),
  ): void;
  onThreadChange?(threadId?: string): void;
  onLanguageChange(language: Language): void;
  onThemeChange(theme: ThemePreference): void;
  onPreferredProjectOpenerChange(value?: ProjectOpenerId): void;
  t: Translate;
}

/** Owns project, Host, task-route, sidebar, and command navigation lifecycles. */
export function useNavigationRuntime(options: NavigationRuntimeOptions) {
  const {
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
    initialSettingsProvided,
    activeThread,
    displayedThreadId,
    newTaskDraft,
    voiceStatus,
    textarea,
    beginDraft,
    selectExistingTask,
    connectProject,
    cancelVoiceInput,
    closeConversationPanels,
    openReviewPanel,
    stopComputerShare,
    deleteThread,
    retryRuntime,
    setWorkspacePanelOpen,
    setTerminalOpen,
    setWorkspaceFileOpenRequest,
    onThreadChange,
    onLanguageChange,
    onThemeChange,
    onPreferredProjectOpenerChange,
    t,
  } = options;
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
    setRuntimeSettings,
    setFirstRunCompleted,
    observedInitialProjects,
    setHostSnapshot,
    hostSnapshot,
    setProjectError,
    switchingProject,
    setSwitchingProject,
    setRemoteRuntimeOpen,
    setRemoteProjectPathOpen,
    remoteRuntimeBusy,
    setRemoteRuntimeBusy,
    setRemoteRuntimeError,
    setCommandPaletteOpen,
    setCommandPaletteMode,
    setPendingSearchJump,
    setProjectOpeners,
    commandPaletteTrigger,
    projectSnapshotRef,
    activeThreadIdRef,
    viewRef,
  } = navigation;
  const [initialRestoreComplete, setInitialRestoreComplete] = useState(
    () => !projects,
  );
  const initialProjectSnapshot = useRef(initialProjects);
  const currentProject = activeProject(projectSnapshot);
  const currentHost = hostSnapshot?.hosts.find(
    (host) => host.id === hostSnapshot.activeHostId,
  );

  projectSnapshotRef.current = projectSnapshot;
  activeThreadIdRef.current = displayedThreadId;
  viewRef.current = view;

  useEffect(() => {
    if (!settings || initialSettingsProvided) return;
    let active = true;
    void settings
      .load()
      .then((snapshot) => {
        if (active) setRuntimeSettings(snapshot);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [initialSettingsProvided, setRuntimeSettings, settings]);

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
  }, [observedInitialProjects, projectSnapshot, setFirstRunCompleted]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setMobileSidebar(event.matches);
      setSidebarOpen(
        sidebarStartsOpen(event.matches, storedSidebarVisibility()),
      );
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [setMobileSidebar, setSidebarOpen]);

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
  }, [mobileSidebar, setSidebarOpen, sidebarOpen, sidebarOpenButton]);

  useEffect(() => {
    if (!onThreadChange || !projectSnapshot) return;
    const route = restoredThreadRoute({
      restoreComplete: initialRestoreComplete,
      newTaskDraft,
      activeThreadId: activeThread.threadId,
      conversations: currentProject?.conversations,
    });
    if (route.ready) onThreadChange(route.threadId);
  }, [
    activeThread.threadId,
    currentProject?.conversations,
    initialRestoreComplete,
    newTaskDraft,
    onThreadChange,
    projectSnapshot,
  ]);

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
        .catch(() => undefined);
    };
    const unsubscribes = [
      client.on("thread/title", ({ threadId }) =>
        refreshCompletedTask(threadId),
      ),
      client.on("turn/completed", ({ threadId }) =>
        refreshCompletedTask(threadId),
      ),
      client.on("turn/failed", ({ threadId }) =>
        refreshCompletedTask(threadId),
      ),
    ];
    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [activeThreadIdRef, client, projects, setProjectSnapshot, viewRef]);

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
        .catch(() => undefined);
    };
    window.addEventListener("focus", markVisibleConversationRead);
    return () =>
      window.removeEventListener("focus", markVisibleConversationRead);
  }, [
    activeThreadIdRef,
    projectSnapshotRef,
    projects,
    setProjectSnapshot,
    viewRef,
  ]);

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
  }, [
    currentProject?.id,
    currentProject?.scope,
    projectOpener,
    setProjectOpeners,
  ]);

  useEffect(() => {
    if (!projects) {
      setInitialRestoreComplete(true);
      return;
    }
    let active = true;
    void projects
      .loadHosts?.()
      .then((hosts) => {
        if (active) setHostSnapshot(hosts);
      })
      .catch(() => undefined);
    const prefetchedSnapshot = initialProjectSnapshot.current;
    initialProjectSnapshot.current = undefined;
    void (
      prefetchedSnapshot ? Promise.resolve(prefetchedSnapshot) : projects.load()
    )
      .then(async (snapshot) => {
        if (!active) return;
        let nextSnapshot = snapshot;
        let preferredThreadId: string | undefined;
        const initialProject = snapshot.projects.find((project) =>
          project.conversations.some(({ id }) => id === initialThreadId),
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
      .catch((reason) => {
        if (active) setProjectError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setInitialRestoreComplete(true);
      });
    return () => {
      active = false;
    };
  }, [
    connectProject,
    initialThreadId,
    projects,
    setHostSnapshot,
    setProjectError,
    setProjectSnapshot,
  ]);

  useEffect(() => {
    return automations?.subscribeOpen?.((target) => {
      void selectConversation(target.projectId, target.id);
    });
  }, [automations, projectSnapshot, switchingProject, voiceStatus]);

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
      if (!switchingProject && voiceStatus === "idle") openCommandPalette(mode);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [currentProject, search, switchingProject, voiceStatus]);

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
    if (
      newTaskDraft ||
      (!activeThread.recovery && !activeThread.hasUserInput)
    ) {
      textarea.current?.focus();
      return;
    }
    closeConversationPanels();
    beginDraft();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  async function createProjectThread(projectId: string) {
    if (projectId === currentProject?.id) return createThread();
    if (!projects || switchingProject || voiceStatus !== "idle") return;
    closeSidebarForNavigation();
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      const snapshot = await projects.activate(projectId);
      setProjectSnapshot(snapshot);
      closeConversationPanels();
      setView("thread");
      beginDraft();
      requestAnimationFrame(() => textarea.current?.focus());
    } catch (reason) {
      setProjectError(errorMessage(reason));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function createStandaloneThread() {
    if (
      !projects?.createStandalone ||
      switchingProject ||
      voiceStatus !== "idle"
    )
      return;
    closeSidebarForNavigation();
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      const snapshot = await projects.createStandalone();
      enterStandaloneDraft(snapshot, {
        setProjectSnapshot,
        closeConversationPanels,
        showThread: () => setView("thread"),
        beginDraft,
      });
      requestAnimationFrame(() => textarea.current?.focus());
    } catch (reason) {
      setProjectError(errorMessage(reason));
    } finally {
      setSwitchingProject(false);
    }
  }

  async function openProjectView(
    projectId: string,
    nextView: "memory" | "diagnostics" | "security",
  ) {
    cancelVoiceInput();
    if (
      projectId !== currentProject?.id &&
      !(await selectConversation(projectId))
    )
      return;
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
    } catch (reason) {
      setProjectError(errorMessage(reason));
      throw reason;
    }
  }

  async function revealProjectInFinder(project: ProjectSummary) {
    if (project.runtime?.kind === "remote" || !workspace?.revealSystemFile)
      return;
    setProjectError(undefined);
    try {
      await workspace.revealSystemFile(project.basePath);
    } catch (reason) {
      setProjectError(errorMessage(reason));
      throw reason;
    }
  }

  function openCommandPalette(mode: CommandPaletteMode = "all") {
    if (
      !search ||
      !currentProject ||
      switchingProject ||
      voiceStatus !== "idle"
    )
      return;
    closeSidebarForNavigation();
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
      if (entry.actionId === "new-task") await createThread();
      else if (entry.actionId === "memory") setView("memory");
      else if (entry.actionId === "review") {
        setView("thread");
        openReviewPanel();
      } else if (entry.actionId === "workspace") {
        setWorkspacePanelOpen((open) => !open);
      } else if (entry.actionId === "terminal") {
        setTerminalOpen((open) => !open);
      } else if (entry.actionId === "diagnostics") setView("diagnostics");
      else if (entry.actionId === "automations") setView("automations");
      else if (entry.actionId === "settings") setView("settings");
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

  async function openProjectFolder(path?: string) {
    if (!projects || switchingProject || voiceStatus !== "idle") return;
    setSwitchingProject(true);
    setProjectError(undefined);
    try {
      if (currentHost?.kind === "remote" && !path) {
        closeSidebarForNavigation();
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
    } catch (reason) {
      setProjectError(errorMessage(reason));
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
      setHostSnapshot(await projects.connectRemote(input));
      await refreshHostSettings();
      const snapshot = await projects.load();
      setProjectSnapshot(snapshot);
      setRemoteRuntimeOpen(false);
      setView("thread");
      closeConversationPanels();
      await connectProject(snapshot);
    } catch (reason) {
      setRemoteRuntimeError(errorMessage(reason));
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
    } catch (reason) {
      setRemoteRuntimeError(errorMessage(reason));
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
    } catch (reason) {
      setRemoteRuntimeError(errorMessage(reason));
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
    } catch (reason) {
      setRemoteRuntimeError(errorMessage(reason));
    } finally {
      setSwitchingProject(false);
    }
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
        conversation.id === displayedThreadId
      ) {
        closeConversationPanels();
        setView("thread");
        await connectProject(snapshot);
      }
    } catch (reason) {
      setProjectError(errorMessage(reason));
      throw reason;
    }
  }

  async function selectConversation(projectId: string, threadId?: string) {
    if (!projects || switchingProject || voiceStatus !== "idle") return false;
    closeSidebarForNavigation();
    selectExistingTask();
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
        currentProject?.id !== nextProject?.id ||
        displayedThreadId !== nextThreadId
      ) {
        closeConversationPanels();
      }
      setView("thread");
      await connectProject(snapshot, threadId);
      return true;
    } catch (reason) {
      setProjectError(errorMessage(reason));
      return false;
    } finally {
      setSwitchingProject(false);
    }
  }

  async function confirmDeleteConversation(
    target: {
      projectId: string;
      conversation: ConversationSummary;
      mode?: "delete" | "discard" | "metadata";
    },
    runningThreadIds: readonly string[],
  ): Promise<ProjectsSnapshot | undefined> {
    if (!projects || runningThreadIds.includes(target.conversation.id)) return;
    const deletingActive =
      target.projectId === projectSnapshot?.activeProjectId &&
      target.conversation.id === displayedThreadId;
    if (deletingActive && !(await stopComputerShare())) return;
    if (target.mode === "metadata") {
      if (!projects.recoverConversation)
        throw new Error(t("metadataRecoveryUnavailable"));
      const snapshot = await projects.recoverConversation({
        projectId: target.projectId,
        id: target.conversation.id,
      });
      if (deletingActive) {
        closeConversationPanels();
        setView("thread");
        await connectProject(snapshot);
      }
      return snapshot;
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
    if (deletingActive) {
      closeConversationPanels();
      setView("thread");
      await connectProject(snapshot);
    }
    return snapshot;
  }

  async function confirmDeleteProject(target: ProjectSummary) {
    if (!projects?.deleteProject) return;
    const deletingActive = target.id === projectSnapshot?.activeProjectId;
    if (deletingActive && !(await stopComputerShare())) return;
    const snapshot = await projects.deleteProject(target.id);
    if (deletingActive) {
      closeConversationPanels();
      setView("thread");
      await connectProject(snapshot);
    }
    return snapshot;
  }

  async function reconnectRuntime() {
    if (currentProject || !projects) await retryRuntime();
  }

  return {
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
    confirmDeleteConversation,
    confirmDeleteProject,
    reconnectRuntime,
  };
}
