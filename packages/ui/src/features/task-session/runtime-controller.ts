import { useEffect, useState, type RefObject } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type { ConversationAccessMode } from "@threadlight/protocol";

import type { Language, Translate } from "../../i18n.js";
import {
  type ConversationSummary,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "../../projects.js";
import { errorMessage } from "../shared/format.js";
import {
  suggestionScopeKey,
  type SuggestedQuestionsState,
} from "./controller.js";
import { requestThreadOpen, type SessionState } from "./session.js";

interface TaskSessionRuntimeOptions {
  client: ThreadlightClient;
  projects?: ProjectsAdapter;
  project?: ProjectSummary;
  conversationSummary?: ConversationSummary;
  session: SessionState;
  newTaskDraft: boolean;
  language: Language;
  suggestedQuestions?: SuggestedQuestionsState;
  setSuggestedQuestions(value: SuggestedQuestionsState | undefined): void;
  suggestionRetry: number;
  setSuggestionRetry(value: number | ((retry: number) => number)): void;
  recoveryBusy: boolean;
  setRecoveryBusy(value: boolean): void;
  setRecoveryError(value: string | undefined): void;
  conversation: RefObject<HTMLElement | null>;
  followOutput: RefObject<boolean>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  pendingSearchJump?: {
    threadId: string;
    messageId?: string;
    activityId?: string;
  };
  setPendingSearchJump(value: undefined): void;
  setProjectSnapshot(value: ProjectsSnapshot): void;
  setProjectError(value: string | undefined): void;
  setNewTaskDraft(value: boolean): void;
  openThread(threadId: string): Promise<string | undefined>;
  closeBookmarks(): void;
  t: Translate;
}

/** Owns the active conversation viewport, suggestions, and recovery actions. */
export function useTaskSessionRuntime({
  client,
  projects,
  project,
  conversationSummary,
  session,
  newTaskDraft,
  language,
  suggestedQuestions,
  setSuggestedQuestions,
  suggestionRetry,
  setSuggestionRetry,
  recoveryBusy,
  setRecoveryBusy,
  setRecoveryError,
  conversation,
  followOutput,
  textarea,
  pendingSearchJump,
  setPendingSearchJump,
  setProjectSnapshot,
  setProjectError,
  setNewTaskDraft,
  openThread,
  closeBookmarks,
  t,
}: TaskSessionRuntimeOptions) {
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const suggestionKey = suggestionScopeKey({
    threadId: session.threadId,
    projectId: project?.id,
    newTaskDraft,
    language,
  });

  useEffect(() => {
    setRecoveryBusy(false);
    setRecoveryError(undefined);
  }, [session.recovery?.threadId, setRecoveryBusy, setRecoveryError]);

  useEffect(() => {
    if (
      session.connection !== "ready" ||
      !suggestionKey ||
      session.messages.length > 0
    ) {
      return;
    }
    let active = true;
    setSuggestedQuestions({
      key: suggestionKey,
      status: "loading",
      suggestions: [],
    });
    void client
      .suggestQuestions(session.threadId, language)
      .then(({ suggestions }) => {
        if (active) {
          setSuggestedQuestions({
            key: suggestionKey,
            status: "ready",
            suggestions,
          });
        }
      })
      .catch(() => {
        if (active) {
          setSuggestedQuestions({
            key: suggestionKey,
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
    session.connection,
    session.messages.length,
    session.threadId,
    setSuggestedQuestions,
    suggestionKey,
    suggestionRetry,
  ]);

  useEffect(() => {
    const element = conversation.current;
    if (element && followOutput.current) {
      element.scrollTop = element.scrollHeight;
      setShowJumpToLatest(false);
    }
  }, [
    conversation,
    followOutput,
    session.messages.length,
    session.progress,
    session.streamingText,
  ]);

  useEffect(() => {
    if (
      !pendingSearchJump ||
      session.threadId !== pendingSearchJump.threadId ||
      (pendingSearchJump.messageId &&
        !session.messages.some(
          (message) => message.id === pendingSearchJump.messageId,
        ))
    ) {
      return;
    }
    let frame = 0;
    let attempts = 0;
    const locateTarget = () => {
      frame = 0;
      let target = pendingSearchJump.activityId
        ? document.getElementById(`activity-${pendingSearchJump.activityId}`)
        : undefined;
      if (!target && pendingSearchJump.activityId && attempts < 3) {
        const activityList = [...document.querySelectorAll(".activity-list")]
          .filter(
            (element): element is HTMLDetailsElement =>
              element instanceof HTMLDetailsElement,
          )
          .find((element) =>
            (element.dataset.activityIds ?? "")
              .split(" ")
              .includes(pendingSearchJump.activityId as string),
          );
        if (activityList) {
          activityList.open = true;
          attempts += 1;
          frame = requestAnimationFrame(locateTarget);
          return;
        }
      }
      target ??= pendingSearchJump.messageId
        ? document.getElementById(`message-${pendingSearchJump.messageId}`)
        : undefined;
      if (!target) return;
      followOutput.current = false;
      const details = target.closest("details");
      if (details instanceof HTMLDetailsElement) details.open = true;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      setPendingSearchJump(undefined);
    };
    frame = requestAnimationFrame(locateTarget);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [
    followOutput,
    pendingSearchJump,
    session.messages,
    session.threadId,
    setPendingSearchJump,
  ]);

  function jumpToMessage(messageId: string) {
    closeBookmarks();
    requestAnimationFrame(() => {
      const target = document.getElementById(`message-${messageId}`);
      if (!target) return;
      followOutput.current = false;
      setShowJumpToLatest(true);
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
  }

  function jumpToLatest() {
    const element = conversation.current;
    if (!element) return;
    followOutput.current = true;
    element.scrollTop = element.scrollHeight;
    setShowJumpToLatest(false);
    textarea.current?.focus({ preventScroll: true });
  }

  async function repairMissingThread() {
    if (
      !projects?.recoverConversation ||
      !project ||
      !conversationSummary ||
      !session.recovery ||
      recoveryBusy
    ) {
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError(undefined);
    try {
      await client.initialize();
      const { threadId: replacementId } = await client.startThread(
        conversationSummary.workspace?.mode === "worktree"
          ? "worktree"
          : "local",
      );
      setProjectSnapshot(
        await projects.recoverConversation({
          projectId: project.id,
          id: session.recovery.threadId,
          replacementId,
        }),
      );
      setNewTaskDraft(false);
      await openThread(replacementId);
    } catch (reason) {
      setRecoveryError(errorMessage(reason));
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function relinkMissingThread(replacementId: string) {
    if (
      !projects?.recoverConversation ||
      !project ||
      !session.recovery ||
      recoveryBusy
    ) {
      return;
    }
    if (replacementId === session.recovery.threadId) {
      setRecoveryError(t("replacementThreadSame"));
      return;
    }
    if (project.conversations.some(({ id }) => id === replacementId)) {
      setRecoveryError(t("replacementThreadAlreadyTracked"));
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError(undefined);
    try {
      const result = await requestThreadOpen(client, replacementId);
      if (result.status === "missing") {
        setRecoveryError(t("replacementThreadNotFound"));
        return;
      }
      const openedThreadId = result.thread.threadId;
      setProjectSnapshot(
        await projects.recoverConversation({
          projectId: project.id,
          id: session.recovery.threadId,
          replacementId: openedThreadId,
        }),
      );
      setNewTaskDraft(false);
      await openThread(openedThreadId);
    } catch (reason) {
      setRecoveryError(errorMessage(reason));
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function updateAccessMode(accessMode: ConversationAccessMode) {
    if (!projects || !project || !session.threadId) return;
    setProjectError(undefined);
    try {
      if (!conversationSummary) {
        await projects.upsertConversation({
          projectId: project.id,
          id: session.threadId,
          title: t("task"),
        });
      }
      setProjectSnapshot(
        await projects.updateConversation({
          projectId: project.id,
          id: session.threadId,
          accessMode,
        }),
      );
    } catch (reason) {
      setProjectError(errorMessage(reason));
      throw reason;
    }
  }

  return {
    suggestionKey,
    suggestions:
      suggestedQuestions?.key === suggestionKey
        ? suggestedQuestions.suggestions
        : [],
    suggestionsLoading:
      Boolean(suggestionKey) &&
      session.connection === "ready" &&
      (suggestedQuestions?.key !== suggestionKey ||
        suggestedQuestions.status === "loading"),
    suggestionsFailed:
      suggestedQuestions?.key === suggestionKey &&
      suggestedQuestions.status === "error",
    retrySuggestions: () => setSuggestionRetry((retry) => retry + 1),
    showJumpToLatest,
    setShowJumpToLatest,
    jumpToMessage,
    jumpToLatest,
    repairMissingThread,
    relinkMissingThread,
    updateAccessMode,
  };
}
