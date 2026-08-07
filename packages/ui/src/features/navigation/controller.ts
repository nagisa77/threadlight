import { useRef, useState } from "react";

import type { CommandPaletteMode } from "../../command-palette.js";
import type { SettingsSnapshot } from "../../settings.js";
import type {
  ConversationSummary,
  HostsSnapshot,
  ProjectSummary,
  ProjectsSnapshot,
} from "../../projects.js";
import type { ProjectOpenerOption } from "../../project-opener.js";

export type AppView =
  "thread" | "memory" | "diagnostics" | "automations" | "security" | "settings";

export const SIDEBAR_VISIBILITY_KEY = "threadlight:sidebar-visible";
export const FIRST_RUN_COMPLETE_KEY = "threadlight:first-run-complete:v1";
export const MOBILE_SIDEBAR_QUERY = "(max-width: 720px)";

export function sidebarStartsOpen(
  mobile: boolean,
  storedVisibility?: string | null,
): boolean {
  return !mobile && storedVisibility !== "false";
}

export function isMobileSidebarViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
  );
}

export function storedSidebarVisibility(): string | null {
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

export function storedFirstRunComplete(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return firstRunIsComplete(
      window.localStorage.getItem(FIRST_RUN_COMPLETE_KEY),
    );
  } catch {
    return false;
  }
}

export function completeFirstRun(
  setCompleted: (completed: boolean) => void,
): void {
  try {
    window.localStorage.setItem(FIRST_RUN_COMPLETE_KEY, "true");
  } catch {
    // Project history still prevents established users from looping.
  }
  setCompleted(true);
}

export function useNavigationController(initial?: {
  projects?: ProjectsSnapshot;
  settings?: SettingsSnapshot;
}) {
  const initialMobileSidebar = isMobileSidebarViewport();
  const [mobileSidebar, setMobileSidebar] = useState(initialMobileSidebar);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    sidebarStartsOpen(initialMobileSidebar, storedSidebarVisibility()),
  );
  const sidebarCloseButton = useRef<HTMLButtonElement>(null);
  const sidebarOpenButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<AppView>("thread");
  const [projectSnapshot, setProjectSnapshot] = useState<
    ProjectsSnapshot | undefined
  >(() => initial?.projects);
  const [runtimeSettings, setRuntimeSettings] = useState<
    SettingsSnapshot | undefined
  >(() => initial?.settings);
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
    mode?: "delete" | "discard" | "metadata";
  }>();
  const [deleteError, setDeleteError] = useState<string>();
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] =
    useState<ProjectSummary>();
  const [deleteProjectError, setDeleteProjectError] = useState<string>();
  const [deletingProject, setDeletingProject] = useState(false);
  const [projectOpeners, setProjectOpeners] = useState<
    readonly ProjectOpenerOption[]
  >([]);
  const commandPaletteTrigger = useRef<HTMLButtonElement>(null);
  const projectSnapshotRef = useRef<ProjectsSnapshot | undefined>(undefined);
  const activeThreadIdRef = useRef<string | undefined>(undefined);
  const viewRef = useRef<AppView>(view);

  return {
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
  };
}
