import { useCallback, useRef, useState } from "react";
import type {
  AgentPlanData,
  AgentTreeData,
  ConversationProgressData,
} from "@threadlight/protocol";

import type {
  AutomaticDeliveryState,
  ConversationChangesSnapshot,
  WorkspaceFileOpenRequest,
} from "./workspace-types.js";

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
  if (!threadId || !plan?.documentPath || !plan.documentVersion) return;
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
  progress: readonly ConversationProgressData[],
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

export function resolveAgentPanelTree(
  session:
    | {
        agentTree?: AgentTreeData;
        messages: readonly { agentTree?: AgentTreeData }[];
      }
    | undefined,
  rootId?: string,
): AgentTreeData | undefined {
  const trees = [
    session?.agentTree,
    ...[...(session?.messages ?? [])]
      .reverse()
      .map(({ agentTree }) => agentTree),
  ].filter((tree): tree is AgentTreeData => Boolean(tree));
  return (
    (rootId ? trees.find((tree) => tree.rootId === rootId) : undefined) ??
    trees[0]
  );
}

export function useDeliveryController(session?: {
  agentTree?: AgentTreeData;
  messages: readonly { agentTree?: AgentTreeData }[];
}) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const workspacePanelMounted = useRef(false);
  if (workspacePanelOpen) workspacePanelMounted.current = true;
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState<number>();
  const [workspaceReviewRequest, setWorkspaceReviewRequest] = useState(0);
  const [workspaceDeliveryRequest, setWorkspaceDeliveryRequest] = useState(0);
  const [workspaceAgentRequest, setWorkspaceAgentRequest] = useState(0);
  const [workspaceAgentTarget, setWorkspaceAgentTarget] = useState<{
    rootId: string;
    agentThreadId: string;
  }>();
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
  const conversationChangesRequest = useRef(0);
  const conversationChangesScope = useRef("");
  const activePlanDocument = useRef<string | undefined>(undefined);
  const deliveryAwaitingScopes = useRef(new Set<string>());
  const workspaceRoot = useRef<HTMLElement>(null);
  const currentAgentTree = resolveAgentPanelTree(
    session,
    workspaceAgentTarget?.rootId,
  );
  const openWorkspaceAgent = useCallback(
    (tree: AgentTreeData, agentThreadId: string) => {
      setWorkspaceAgentTarget({ rootId: tree.rootId, agentThreadId });
      setWorkspacePanelOpen(true);
      setWorkspaceAgentRequest((request) => request + 1);
    },
    [],
  );
  const workspaceAgentPanel = {
    tree: currentAgentTree,
    live: Boolean(
      session?.agentTree &&
      session.agentTree.rootId === currentAgentTree?.rootId,
    ),
    request: workspaceAgentRequest,
    selectedAgentId:
      workspaceAgentTarget &&
      currentAgentTree?.rootId === workspaceAgentTarget.rootId
        ? workspaceAgentTarget.agentThreadId
        : undefined,
    open: openWorkspaceAgent,
  };

  return {
    terminalOpen,
    setTerminalOpen,
    workspacePanelOpen,
    setWorkspacePanelOpen,
    workspacePanelMounted,
    workspacePanelWidth,
    setWorkspacePanelWidth,
    workspaceReviewRequest,
    setWorkspaceReviewRequest,
    workspaceDeliveryRequest,
    setWorkspaceDeliveryRequest,
    workspaceAgentPanel,
    workspaceFileOpenRequest,
    setWorkspaceFileOpenRequest,
    conversationChanges,
    setConversationChanges,
    conversationChangesLoading,
    setConversationChangesLoading,
    conversationChangesError,
    setConversationChangesError,
    automaticDeliveries,
    setAutomaticDeliveries,
    conversationChangesRequest,
    conversationChangesScope,
    activePlanDocument,
    deliveryAwaitingScopes,
    workspaceRoot,
  };
}
