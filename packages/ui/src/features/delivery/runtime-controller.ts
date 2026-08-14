import {
  useCallback,
  useEffect,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type {
  AgentPlanData,
  AgentTreeData,
  ConversationProgressData,
} from "@threadlight/protocol";

import { isTogglePanelShortcut } from "../../keyboard-shortcuts.js";
import {
  fileReaderReference,
  type LocalFileReference,
} from "../../markdown.js";
import {
  projectsWithDeliveryStatus,
  type ConversationSummary,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "../../projects.js";
import type { Translate } from "../../i18n.js";
import { errorMessage } from "../shared/format.js";
import { automaticDeliveryFromHistory } from "./delivery-turn-status.js";
import {
  clampWorkspacePanelWidth,
  conversationChangesRefreshKey,
  planDocumentOpenRequest,
  useDeliveryController,
} from "./controller.js";
import type {
  AutomaticDeliveryState,
  WorkspaceAdapter,
} from "./workspace-types.js";

interface DeliveryRuntimeOptions {
  client: ThreadlightClient;
  projects?: ProjectsAdapter;
  workspace?: WorkspaceAdapter;
  project?: ProjectSummary;
  conversation?: ConversationSummary;
  session: {
    threadId?: string;
    isRunning: boolean;
    agentTree?: AgentTreeData;
    messages: readonly { agentTree?: AgentTreeData }[];
    plan?: AgentPlanData;
    progress: readonly ConversationProgressData[];
  };
  setProjectSnapshot: Dispatch<SetStateAction<ProjectsSnapshot | undefined>>;
  t: Translate;
}

/** Owns workspace Diff, delivery, panel sizing, and delivery event lifecycles. */
export function useDeliveryRuntime({
  client,
  projects,
  workspace,
  project,
  conversation,
  session,
  setProjectSnapshot,
  t,
}: DeliveryRuntimeOptions) {
  const delivery = useDeliveryController(session);
  const {
    setTerminalOpen,
    setWorkspacePanelOpen,
    setWorkspacePanelWidth,
    setWorkspaceReviewRequest,
    setWorkspaceDeliveryRequest,
    workspaceFileOpenRequest,
    setWorkspaceFileOpenRequest,
    conversationChanges,
    setConversationChanges,
    setConversationChangesLoading,
    setConversationChangesError,
    automaticDeliveries,
    setAutomaticDeliveries,
    conversationChangesRequest,
    conversationChangesScope,
    activePlanDocument,
    deliveryAwaitingScopes,
    workspaceRoot,
  } = delivery;

  const scope =
    project && session.threadId
      ? `${project.id}\u0000${session.threadId}`
      : undefined;
  const automaticDelivery = scope ? automaticDeliveries[scope] : undefined;
  const currentWorkspacePath =
    conversation?.workspace?.path ?? project?.basePath;
  conversationChangesScope.current = scope ?? "";

  useEffect(() => {
    const storeDelivery = (
      event: {
        projectId: string;
        threadId: string;
        revision?: string;
        result?: AutomaticDeliveryState["result"];
        preflight?: AutomaticDeliveryState["preflight"];
        error?: string;
      },
      status: "syncing" | "synced" | "conflict" | "failed",
    ) => {
      const eventScope = `${event.projectId}\u0000${event.threadId}`;
      deliveryAwaitingScopes.current.delete(eventScope);
      setAutomaticDeliveries((current) => ({
        ...current,
        [eventScope]: {
          scope: eventScope,
          revision: event.revision ?? current[eventScope]?.revision ?? "",
          status,
          ...(event.result ? { result: event.result } : {}),
          ...(event.preflight ? { preflight: event.preflight } : {}),
          ...(event.error ? { error: event.error } : {}),
        },
      }));
      setProjectSnapshot((snapshot) =>
        projectsWithDeliveryStatus(
          snapshot,
          event.projectId,
          event.threadId,
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
      client.on("delivery/syncing", (event) => storeDelivery(event, "syncing")),
      client.on("delivery/synced", (event) => storeDelivery(event, "synced")),
      client.on("delivery/conflict", (event) =>
        storeDelivery(event, "conflict"),
      ),
      client.on("delivery/failed", (event) => storeDelivery(event, "failed")),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [client, projects, setAutomaticDeliveries, setProjectSnapshot]);

  useEffect(() => {
    if (!session.isRunning || !scope) return;
    deliveryAwaitingScopes.current.add(scope);
    setAutomaticDeliveries((current) => {
      if (!current[scope]) return current;
      const next = { ...current };
      delete next[scope];
      return next;
    });
  }, [scope, session.isRunning, setAutomaticDeliveries]);

  useEffect(() => {
    if (
      session.isRunning ||
      !scope ||
      automaticDelivery ||
      deliveryAwaitingScopes.current.has(scope) ||
      !workspace?.getDeliveryHistory ||
      !project ||
      !session.threadId ||
      conversation?.workspace?.mode !== "worktree"
    ) {
      return;
    }
    let active = true;
    void workspace
      .getDeliveryHistory(project.id, session.threadId)
      .then((history) => {
        if (!active) return;
        const restored = automaticDeliveryFromHistory(scope, history);
        if (!restored) return;
        setAutomaticDeliveries((current) =>
          current[scope] ? current : { ...current, [scope]: restored },
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    automaticDelivery,
    conversation?.workspace?.mode,
    project,
    scope,
    session.isRunning,
    session.threadId,
    setAutomaticDeliveries,
    workspace,
  ]);

  useEffect(() => {
    const next = planDocumentOpenRequest(
      session.plan,
      session.threadId,
      activePlanDocument.current,
      (workspaceFileOpenRequest?.id ?? 0) + 1,
    );
    if (!next) {
      activePlanDocument.current = undefined;
      return;
    }
    if (!workspace || !project || !session.threadId) return;
    activePlanDocument.current = next.documentKey;
    if (next.openPanel) setWorkspacePanelOpen(true);
    setWorkspaceFileOpenRequest(next.request);
  }, [
    activePlanDocument,
    project,
    session.plan?.documentPath,
    session.plan?.documentVersion,
    session.threadId,
    setWorkspaceFileOpenRequest,
    setWorkspacePanelOpen,
    workspace,
    workspaceFileOpenRequest?.id,
  ]);

  const refreshChanges = useCallback(
    async ({ background = false }: { background?: boolean } = {}) => {
      const request = ++conversationChangesRequest.current;
      if (!workspace || !project || !session.threadId) {
        setConversationChanges(undefined);
        setConversationChangesError(undefined);
        setConversationChangesLoading(false);
        return;
      }
      const projectId = project.id;
      const threadId = session.threadId;
      const requestScope = `${projectId}\u0000${threadId}`;
      if (!background) {
        setConversationChangesLoading(true);
        setConversationChangesError(undefined);
      }
      try {
        const snapshot = await workspace.getChanges(projectId, threadId);
        if (
          request === conversationChangesRequest.current &&
          requestScope === conversationChangesScope.current
        ) {
          setConversationChanges(snapshot);
        }
      } catch (reason) {
        if (
          !background &&
          request === conversationChangesRequest.current &&
          requestScope === conversationChangesScope.current
        ) {
          setConversationChangesError(errorMessage(reason));
        }
      } finally {
        if (
          request === conversationChangesRequest.current &&
          requestScope === conversationChangesScope.current
        ) {
          setConversationChangesLoading(false);
        }
      }
    },
    [
      conversationChangesRequest,
      conversationChangesScope,
      project,
      session.threadId,
      setConversationChanges,
      setConversationChangesError,
      setConversationChangesLoading,
      workspace,
    ],
  );

  const restoreChanges = useCallback(
    async (paths: readonly string[] | undefined, revision: string) => {
      if (
        !workspace?.restoreChanges ||
        !project ||
        !session.threadId ||
        session.isRunning
      ) {
        throw new Error(t("restoreUnavailableWhileRunning"));
      }
      setConversationChangesLoading(true);
      setConversationChangesError(undefined);
      try {
        setConversationChanges(
          await workspace.restoreChanges(
            project.id,
            session.threadId,
            revision,
            paths,
          ),
        );
      } catch (reason) {
        if (
          errorMessage(reason).includes("workspace changed after this Diff")
        ) {
          throw new Error(t("restoreConflict"));
        }
        throw reason;
      } finally {
        setConversationChangesLoading(false);
      }
    },
    [
      project,
      session.isRunning,
      session.threadId,
      setConversationChanges,
      setConversationChangesError,
      setConversationChangesLoading,
      t,
      workspace,
    ],
  );

  useEffect(() => {
    void refreshChanges();
  }, [refreshChanges, session.isRunning, session.messages.length]);

  const retryAutomaticDelivery = useCallback(async () => {
    if (
      !workspace?.applyDelivery ||
      !project ||
      !session.threadId ||
      !automaticDelivery
    ) {
      return;
    }
    const currentScope = `${project.id}\u0000${session.threadId}`;
    let revision = automaticDelivery.revision;
    try {
      const changes = await workspace.getChanges(project.id, session.threadId);
      revision = changes.revision;
      if (conversationChangesScope.current === currentScope) {
        setConversationChanges(changes);
      }
      await workspace.applyDelivery(project.id, session.threadId, revision);
    } catch (reason) {
      setAutomaticDeliveries((current) => ({
        ...current,
        [currentScope]: {
          ...(current[currentScope] ?? automaticDelivery),
          scope: currentScope,
          revision,
          status: "failed",
          error: errorMessage(reason),
        },
      }));
    }
  }, [
    automaticDelivery,
    conversationChangesScope,
    project,
    session.threadId,
    setAutomaticDeliveries,
    setConversationChanges,
    workspace,
  ]);

  const undoAutomaticDelivery = useCallback(async () => {
    if (
      !workspace?.undoDelivery ||
      !project ||
      !session.threadId ||
      !automaticDelivery ||
      automaticDelivery.status !== "synced"
    ) {
      return;
    }
    const current = automaticDelivery;
    setAutomaticDeliveries((deliveries) => ({
      ...deliveries,
      [current.scope]: { ...current, status: "undoing" },
    }));
    try {
      await workspace.undoDelivery(
        project.id,
        session.threadId,
        current.revision,
      );
      setAutomaticDeliveries((deliveries) => ({
        ...deliveries,
        [current.scope]: { ...current, status: "undone", result: undefined },
      }));
    } catch (reason) {
      setAutomaticDeliveries((deliveries) => ({
        ...deliveries,
        [current.scope]: {
          ...current,
          status: "failed",
          error: errorMessage(reason),
        },
      }));
    }
  }, [
    automaticDelivery,
    project,
    session.threadId,
    setAutomaticDeliveries,
    workspace,
  ]);

  const changeRefreshKey = conversationChangesRefreshKey(session.progress);
  useEffect(() => {
    if (changeRefreshKey) void refreshChanges({ background: true });
  }, [changeRefreshKey, refreshChanges]);

  useEffect(() => {
    if (!workspace) return;
    const handleFocus = () => void refreshChanges();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshChanges, workspace]);

  useEffect(() => {
    if (!project) return;
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (isTogglePanelShortcut(event)) {
        event.preventDefault();
        delivery.setTerminalOpen((open) => !open);
      } else if (
        workspace &&
        isTogglePanelShortcut(event, { shiftKey: true })
      ) {
        event.preventDefault();
        setWorkspacePanelOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [delivery.setTerminalOpen, project, setWorkspacePanelOpen, workspace]);

  function openReviewPanel() {
    setWorkspacePanelOpen(true);
    setWorkspaceReviewRequest((request) => request + 1);
    void refreshChanges();
  }

  function openDeliveryCenter() {
    setWorkspacePanelOpen(true);
    setWorkspaceDeliveryRequest((request) => request + 1);
  }

  function openLocalFile(reference: LocalFileReference) {
    if (!workspace || !project || !currentWorkspacePath) return;
    const file = fileReaderReference(reference, currentWorkspacePath);
    if (!file || (file.source === "system" && !workspace.readSystemFile))
      return;
    setWorkspacePanelOpen(true);
    setWorkspaceFileOpenRequest((current) => ({
      ...file,
      id: (current?.id ?? 0) + 1,
    }));
  }

  async function revealLocalFile(reference: LocalFileReference) {
    if (!workspace || !project || !currentWorkspacePath) return;
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
    await workspace.reveal(project.id, file.path, session.threadId);
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
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

  function resizeBy(delta: number) {
    const workspaceElement = workspaceRoot.current;
    const panelElement =
      workspaceElement?.querySelector<HTMLElement>(".workspace-panel");
    if (!workspaceElement || !panelElement) return;
    setWorkspacePanelWidth(
      clampWorkspacePanelWidth(
        panelElement.getBoundingClientRect().width + delta,
        workspaceElement.getBoundingClientRect().width,
      ),
    );
  }

  return {
    ...delivery,
    automaticDelivery,
    currentWorkspacePath,
    hasConversationChanges: Boolean(
      workspace && project && conversationChanges?.files.length,
    ),
    refreshChanges,
    restoreChanges,
    retryAutomaticDelivery,
    undoAutomaticDelivery,
    openReviewPanel,
    openDeliveryCenter,
    openLocalFile,
    revealLocalFile,
    beginResize,
    resizeBy,
  };
}
