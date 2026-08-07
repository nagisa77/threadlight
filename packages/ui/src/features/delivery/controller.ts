import { useRef, useState } from "react";

import type {
  AutomaticDeliveryState,
  ConversationChangesSnapshot,
  WorkspaceFileOpenRequest,
} from "./workspace-types.js";

export function useDeliveryController() {
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
  const conversationChangesRequest = useRef(0);
  const conversationChangesScope = useRef("");
  const activePlanDocument = useRef<string | undefined>(undefined);
  const deliveryAwaitingScopes = useRef(new Set<string>());
  const workspaceRoot = useRef<HTMLElement>(null);

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
