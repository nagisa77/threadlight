import { useRef, useState } from "react";
import type {
  ConversationAccessMode,
  TaskDevelopmentMode,
} from "@threadlight/protocol";

export interface SuggestedQuestionsState {
  key: string;
  status: "loading" | "ready" | "error";
  suggestions: readonly string[];
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
