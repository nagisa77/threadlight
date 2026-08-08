import { useRef, useState } from "react";
import type { AgentTreeData } from "@threadlight/protocol";

import type {
  AutomaticDeliveryState,
  ConversationChangesSnapshot,
  WorkspaceFileOpenRequest,
} from "./workspace-types.js";

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
  const latestAgentTree = [...(session?.messages ?? [])]
    .reverse()
    .find(({ agentTree }) => agentTree)?.agentTree;
  const currentAgentTree = session?.agentTree ?? latestAgentTree;
  const workspaceAgentPanel = {
    tree: currentAgentTree,
    live: Boolean(session?.agentTree),
    request: workspaceAgentRequest,
    open(tree: AgentTreeData = currentAgentTree!) {
      if (!tree) return;
      setWorkspacePanelOpen(true);
      setWorkspaceAgentRequest((request) => request + 1);
    },
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
