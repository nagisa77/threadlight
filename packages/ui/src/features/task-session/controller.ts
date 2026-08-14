import { useCallback, useRef, useState } from "react";
import type {
  ConversationAccessMode,
  SuggestionLanguage,
  TaskDevelopmentMode,
} from "@threadlight/protocol";
import {
  activeProject,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "../../projects.js";

export interface SuggestedQuestionsState {
  key: string;
  status: "loading" | "ready" | "error";
  suggestions: readonly string[];
}

export function suggestionScopeKey({
  threadId,
  projectId,
  newTaskDraft,
  language,
}: {
  threadId?: string;
  projectId?: string;
  newTaskDraft: boolean;
  language: SuggestionLanguage;
}): string {
  if (threadId) return `thread:${threadId}\u0000${language}`;
  return newTaskDraft && projectId
    ? `project:${projectId}\u0000${language}`
    : "";
}

export function useTaskSessionController() {
  const [newTaskDraft, setNewTaskDraft] = useState(false);
  const [newTaskDraftError, setNewTaskDraftError] = useState<string>();
  const [developmentMode, setDevelopmentMode] =
    useState<TaskDevelopmentMode>("local");
  const [draftAccessMode, setDraftAccessMode] =
    useState<ConversationAccessMode>("approval");
  const [draftModel, setDraftModel] = useState<{
    provider: string;
    model: string;
  }>();
  const [conversationRecoveryBusy, setConversationRecoveryBusy] =
    useState(false);
  const [conversationRecoveryError, setConversationRecoveryError] =
    useState<string>();
  const [suggestedQuestions, setSuggestedQuestions] =
    useState<SuggestedQuestionsState>();
  const [suggestionRetry, setSuggestionRetry] = useState(0);
  const conversation = useRef<HTMLElement>(null);
  const followOutput = useRef(true);

  return {
    newTaskDraft,
    setNewTaskDraft,
    newTaskDraftError,
    setNewTaskDraftError,
    developmentMode,
    setDevelopmentMode,
    draftAccessMode,
    setDraftAccessMode,
    draftModel,
    setDraftModel,
    conversationRecoveryBusy,
    setConversationRecoveryBusy,
    conversationRecoveryError,
    setConversationRecoveryError,
    suggestedQuestions,
    setSuggestedQuestions,
    suggestionRetry,
    setSuggestionRetry,
    conversation,
    followOutput,
  };
}

export function useProjectSessionActions({
  projects,
  openThread,
  setProjectSnapshot,
  setDevelopmentMode,
  setDraftAccessMode,
  setDraftModel,
  setNewTaskDraftError,
  setNewTaskDraft,
}: {
  projects?: ProjectsAdapter;
  openThread(threadId: string): Promise<string | undefined>;
  setProjectSnapshot(snapshot: ProjectsSnapshot): void;
  setDevelopmentMode(mode: TaskDevelopmentMode): void;
  setDraftAccessMode(mode: ConversationAccessMode): void;
  setDraftModel(model: { provider: string; model: string } | undefined): void;
  setNewTaskDraftError(error: string | undefined): void;
  setNewTaskDraft(value: boolean): void;
}) {
  const beginDraft = useCallback(() => {
    setDevelopmentMode("local");
    setDraftAccessMode("approval");
    setDraftModel(undefined);
    setNewTaskDraftError(undefined);
    setNewTaskDraft(true);
  }, [
    setDevelopmentMode,
    setDraftAccessMode,
    setDraftModel,
    setNewTaskDraft,
    setNewTaskDraftError,
  ]);

  const connectProject = useCallback(
    async (snapshot: ProjectsSnapshot, preferredThreadId?: string) => {
      if (!projects) return;
      const project = activeProject(snapshot);
      if (!project) return;
      const requestedThreadId =
        preferredThreadId ??
        project.conversations.find((conversation) => !conversation.archivedAt)
          ?.id;
      if (!requestedThreadId) {
        beginDraft();
        return;
      }
      setNewTaskDraft(false);
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
    [beginDraft, openThread, projects, setNewTaskDraft, setProjectSnapshot],
  );

  return { beginDraft, connectProject };
}
