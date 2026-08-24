import {
  useCallback,
  useEffect,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  AttachmentData,
  CapabilityDescriptor,
  ConversationAccessMode,
  FollowUpDelivery,
  TaskDevelopmentMode,
  TurnMode,
} from "@threadlight/protocol";

import { nextCapabilityIndex } from "../../capabilities.js";
import {
  scheduleComposerErrorDismissal,
  shouldIgnoreComposerKey,
  type PendingAttachment,
  type VoiceInputStatus,
} from "./controller.js";
import {
  composerContinuationAvailable,
  composerSubmissionAvailable,
} from "../../composer-submission.js";

interface ComposerHistoryResult {
  index: number;
  value: string;
  draft: string;
}

interface ComposerMessage {
  role: "user" | "assistant";
  text: string;
}

interface ComposerSession {
  threadId?: string;
  provider?: string;
  model?: string;
  isRunning: boolean;
  continuationAvailable: boolean;
  submissionError?: string;
  messages: readonly ComposerMessage[];
}

type NewThreadResult =
  { error: string } | { threadId: string; sent: boolean } | undefined;

interface ComposerRuntimeOptions {
  session: ComposerSession;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  submissionGate: RefObject<{
    readonly pending: boolean;
    tryStart(): boolean;
    stop(): void;
  }>;
  inputValueRef: RefObject<string>;
  composerMode: TurnMode;
  setComposerMode: Dispatch<SetStateAction<TurnMode>>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  composing: RefObject<boolean>;
  historyIndex: RefObject<number>;
  historyDraft: RefObject<string>;
  followOutput: RefObject<boolean>;
  voiceStatus: VoiceInputStatus;
  voiceError?: string;
  setVoiceError(error: string | undefined): void;
  cancelVoiceInput(): void;
  attachmentError?: string;
  setAttachmentError(error: string | undefined): void;
  preparingAttachments: boolean;
  pendingAttachmentsRef: RefObject<PendingAttachment[]>;
  stageAttachments(
    pending: readonly PendingAttachment[],
  ): Promise<AttachmentData[]>;
  clearAttachments(pending: readonly PendingAttachment[]): void;
  capabilityQuery?: unknown;
  setCapabilityQuery(value: undefined): void;
  selectedCapabilities: readonly CapabilityDescriptor[];
  setSelectedCapabilities: Dispatch<
    SetStateAction<readonly CapabilityDescriptor[]>
  >;
  addMenuOpen: boolean;
  setAddMenuOpen(open: boolean): void;
  activeCapabilityIndex: number;
  setActiveCapabilityIndex: Dispatch<SetStateAction<number>>;
  composerMenuItemCount: number;
  selectComposerMenuItem(index: number): void;
  newTaskDraft: boolean;
  setNewTaskDraft(value: boolean): void;
  setNewTaskDraftError(error: string | undefined): void;
  developmentMode: TaskDevelopmentMode;
  draftAccessMode: ConversationAccessMode;
  selectedAccessMode: ConversationAccessMode;
  selectedProvider?: string;
  selectedModel?: string;
  providerReady: boolean;
  firstRunRequired: boolean;
  showProviderSetup(firstRunRequired: boolean): void;
  clearSubmissionError(threadId: string): void;
  sendNewThread(
    value: string,
    attachments: readonly AttachmentData[],
    mode: TurnMode,
    capabilities: readonly CapabilityDescriptor[],
    accessMode: ConversationAccessMode,
    provider: string | undefined,
    model: string | undefined,
    developmentMode: TaskDevelopmentMode,
  ): Promise<NewThreadResult>;
  send(
    value: string,
    attachments: readonly AttachmentData[],
    mode: TurnMode,
    capabilities: readonly CapabilityDescriptor[],
    accessMode: ConversationAccessMode,
    provider?: string,
    model?: string,
  ): Promise<boolean>;
  continueTurn(): Promise<boolean>;
  addFollowUp(
    value: string,
    delivery: FollowUpDelivery,
    attachments: readonly AttachmentData[],
  ): Promise<boolean>;
  persistSubmittedThread(
    threadId: string,
    accessMode: ConversationAccessMode,
  ): Promise<void>;
  navigateHistory(input: {
    messages: readonly ComposerMessage[];
    current: string;
    draft: string;
    index: number;
    direction: "older" | "newer";
  }): ComposerHistoryResult | undefined;
}

/** Owns composer submission, draft restoration, IME handling, and history. */
export function useComposerRuntime(options: ComposerRuntimeOptions) {
  const {
    session,
    input,
    setInput,
    setSubmitting,
    submissionGate,
    inputValueRef,
    composerMode,
    setComposerMode,
    textarea,
    composing,
    historyIndex,
    historyDraft,
    followOutput,
    voiceStatus,
    voiceError,
    setVoiceError,
    cancelVoiceInput,
    attachmentError,
    setAttachmentError,
    preparingAttachments,
    pendingAttachmentsRef,
    stageAttachments,
    clearAttachments,
    capabilityQuery,
    setCapabilityQuery,
    selectedCapabilities,
    setSelectedCapabilities,
    addMenuOpen,
    setAddMenuOpen,
    activeCapabilityIndex,
    setActiveCapabilityIndex,
    composerMenuItemCount,
    selectComposerMenuItem,
    newTaskDraft,
    setNewTaskDraft,
    setNewTaskDraftError,
    developmentMode,
    draftAccessMode,
    selectedAccessMode,
    selectedProvider,
    selectedModel,
    providerReady,
    firstRunRequired,
    showProviderSetup,
    clearSubmissionError,
    sendNewThread,
    send,
    continueTurn,
    addFollowUp,
    persistSubmittedThread,
    navigateHistory,
  } = options;

  const dismissErrors = useCallback(() => {
    setVoiceError(undefined);
    setAttachmentError(undefined);
    setNewTaskDraftError(undefined);
    if (session.threadId) clearSubmissionError(session.threadId);
  }, [
    clearSubmissionError,
    session.threadId,
    setAttachmentError,
    setNewTaskDraftError,
    setVoiceError,
  ]);

  useEffect(() => {
    if (!voiceError && !attachmentError && !session.submissionError) return;
    return scheduleComposerErrorDismissal(dismissErrors);
  }, [attachmentError, dismissErrors, session.submissionError, voiceError]);

  function restoreDraft(draft: string) {
    if (inputValueRef.current !== "") return;
    setInput(draft);
    inputValueRef.current = draft;
    focusComposer(textarea, draft);
  }

  async function submit(
    value = input,
    followUpDelivery: FollowUpDelivery = "queued",
  ) {
    if (
      submissionGate.current.pending ||
      voiceStatus !== "idle" ||
      preparingAttachments
    ) {
      return;
    }
    if (!providerReady) {
      showProviderSetup(firstRunRequired);
      return;
    }
    const draftInput = value;
    const draftAttachments = [...pendingAttachmentsRef.current];
    const continuing = composerContinuationAvailable(
      draftInput,
      draftAttachments.length,
      selectedCapabilities,
      session,
    );
    if (
      !continuing &&
      !composerSubmissionAvailable(
        draftInput,
        draftAttachments.length,
        selectedCapabilities,
      )
    ) {
      return;
    }
    if (!submissionGate.current.tryStart()) return;
    const submittingFollowUp = session.isRunning;
    followOutput.current = true;
    setSubmitting(true);
    historyIndex.current = -1;
    historyDraft.current = "";
    setInput("");
    setCapabilityQuery(undefined);
    inputValueRef.current = "";
    if (textarea.current) textarea.current.style.height = "auto";
    try {
      const staged = await stageDraftAttachments(
        draftAttachments,
        stageAttachments,
        () => restoreDraft(draftInput),
      );
      if (!staged) return;
      if (continuing) {
        if (!(await continueTurn())) restoreDraft(draftInput);
        return;
      }
      if (submittingFollowUp) {
        if (!(await addFollowUp(value, followUpDelivery, staged))) {
          restoreDraft(draftInput);
          return;
        }
        clearAttachments(draftAttachments);
        return;
      }
      const submittedThreadId = await submitTurn({
        value,
        staged,
        session,
        newTaskDraft,
        composerMode,
        selectedCapabilities,
        draftAccessMode,
        selectedAccessMode,
        selectedProvider,
        selectedModel,
        developmentMode,
        sendNewThread,
        send,
        setNewTaskDraft,
        setNewTaskDraftError,
        restoreDraft: () => restoreDraft(draftInput),
      });
      if (!submittedThreadId) return;
      setComposerMode("default");
      setSelectedCapabilities([]);
      clearAttachments(draftAttachments);
      await persistSubmittedThread(
        submittedThreadId,
        accessModeForSubmittedThread({
          newTaskDraft,
          draftAccessMode,
          selectedAccessMode,
        }),
      );
    } finally {
      submissionGate.current.stop();
      setSubmitting(false);
    }
  }

  function rewriteQuestion(value: string) {
    historyIndex.current = -1;
    historyDraft.current = "";
    setInput(value);
    setVoiceError(undefined);
    focusComposer(textarea, value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldIgnoreComposerKey(composing.current, event.nativeEvent)) return;
    if (event.key === "Escape" && voiceStatus === "recording") {
      event.preventDefault();
      cancelVoiceInput();
      return;
    }
    if (
      handleCapabilityKey(event, {
        open: addMenuOpen,
        itemCount: composerMenuItemCount,
        activeIndex: activeCapabilityIndex,
        setActiveIndex: setActiveCapabilityIndex,
        selectItem: selectComposerMenuItem,
        close: () => setAddMenuOpen(false),
      })
    ) {
      return;
    }
    if (
      handleCapabilityKey(event, {
        open: Boolean(capabilityQuery),
        itemCount: composerMenuItemCount,
        activeIndex: activeCapabilityIndex,
        setActiveIndex: setActiveCapabilityIndex,
        selectItem: selectComposerMenuItem,
        close: () => setCapabilityQuery(undefined),
      })
    ) {
      return;
    }
    if (handleHistoryKey(event)) return;
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      voiceStatus === "idle"
    ) {
      event.preventDefault();
      void submit(input, session.isRunning ? "queued" : "inject");
    }
  }

  function handleHistoryKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return false;
    }
    const element = event.currentTarget;
    const atBoundary =
      event.key === "ArrowUp"
        ? element.selectionStart === 0 && element.selectionEnd === 0
        : element.selectionStart === input.length &&
          element.selectionEnd === input.length;
    if (!atBoundary) return false;
    const next = navigateHistory({
      messages: session.messages,
      current: input,
      draft: historyDraft.current,
      index: historyIndex.current,
      direction: event.key === "ArrowUp" ? "older" : "newer",
    });
    if (!next) return false;
    event.preventDefault();
    historyIndex.current = next.index;
    historyDraft.current = next.draft;
    setInput(next.value);
    inputValueRef.current = next.value;
    requestAnimationFrame(() => {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
      element.setSelectionRange(next.value.length, next.value.length);
    });
    return true;
  }

  return {
    dismissErrors,
    submit,
    rewriteQuestion,
    handleCompositionStart: () => {
      composing.current = true;
    },
    handleCompositionEnd: () => {
      composing.current = false;
    },
    handleKeyDown,
  };
}

async function stageDraftAttachments(
  pending: readonly PendingAttachment[],
  stage: (pending: readonly PendingAttachment[]) => Promise<AttachmentData[]>,
  restore: () => void,
): Promise<AttachmentData[] | undefined> {
  if (pending.length === 0) return [];
  try {
    return await stage(pending);
  } catch {
    restore();
    return undefined;
  }
}

async function submitTurn(input: {
  value: string;
  staged: readonly AttachmentData[];
  session: ComposerSession;
  newTaskDraft: boolean;
  composerMode: TurnMode;
  selectedCapabilities: readonly CapabilityDescriptor[];
  draftAccessMode: ConversationAccessMode;
  selectedAccessMode: ConversationAccessMode;
  selectedProvider?: string;
  selectedModel?: string;
  developmentMode: TaskDevelopmentMode;
  sendNewThread: ComposerRuntimeOptions["sendNewThread"];
  send: ComposerRuntimeOptions["send"];
  setNewTaskDraft(value: boolean): void;
  setNewTaskDraftError(error: string | undefined): void;
  restoreDraft(): void;
}): Promise<string | undefined> {
  if (input.newTaskDraft && !input.session.threadId) {
    const result = await input.sendNewThread(
      input.value,
      input.staged,
      input.composerMode,
      input.selectedCapabilities,
      input.draftAccessMode,
      input.selectedProvider,
      input.selectedModel,
      input.developmentMode,
    );
    if (!result) return;
    if ("error" in result) {
      input.setNewTaskDraftError(result.error);
      input.restoreDraft();
      return;
    }
    input.setNewTaskDraft(false);
    input.setNewTaskDraftError(undefined);
    if (result.sent) return result.threadId;
    input.restoreDraft();
    return;
  }
  const sent = await input.send(
    input.value,
    input.staged,
    input.composerMode,
    input.selectedCapabilities,
    input.selectedAccessMode,
    input.session.provider,
    input.session.model,
  );
  if (!sent) {
    input.restoreDraft();
    return;
  }
  if (input.newTaskDraft) {
    input.setNewTaskDraft(false);
    input.setNewTaskDraftError(undefined);
  }
  return input.session.threadId;
}

export function accessModeForSubmittedThread(input: {
  newTaskDraft: boolean;
  draftAccessMode: ConversationAccessMode;
  selectedAccessMode: ConversationAccessMode;
}): ConversationAccessMode {
  return input.newTaskDraft ? input.draftAccessMode : input.selectedAccessMode;
}

function handleCapabilityKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  menu: {
    open: boolean;
    itemCount: number;
    activeIndex: number;
    setActiveIndex: Dispatch<SetStateAction<number>>;
    selectItem(index: number): void;
    close(): void;
  },
): boolean {
  if (!menu.open) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    menu.setActiveIndex((current) =>
      nextCapabilityIndex(current, menu.itemCount, delta),
    );
    return true;
  }
  if ((event.key === "Enter" || event.key === "Tab") && menu.itemCount > 0) {
    event.preventDefault();
    menu.selectItem(menu.activeIndex);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    menu.close();
    return true;
  }
  return false;
}

function focusComposer(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  requestAnimationFrame(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
    element.focus();
    element.setSelectionRange(value.length, value.length);
  });
}
