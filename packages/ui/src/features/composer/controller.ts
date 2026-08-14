import { useRef, useState } from "react";
import type { TurnMode } from "@threadlight/protocol";
export type {
  PendingAttachment,
  VoiceInputStatus,
} from "../shared/adapters.js";

export const COMPOSER_ERROR_DISMISS_MS = 5_000;

interface ComposerErrorTimer {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

export function scheduleComposerErrorDismissal(
  dismiss: () => void,
  timer: ComposerErrorTimer = window,
): () => void {
  const handle = timer.setTimeout(dismiss, COMPOSER_ERROR_DISMISS_MS);
  return () => timer.clearTimeout(handle);
}

export function shouldIgnoreComposerKey(
  composing: boolean,
  nativeEvent: Pick<globalThis.KeyboardEvent, "isComposing" | "keyCode">,
) {
  return composing || nativeEvent.isComposing || nativeEvent.keyCode === 229;
}

export function preserveComposerFocusOnPointerDown(event: {
  preventDefault(): void;
}) {
  event.preventDefault();
}

export function activateComposerMenuOnPointerDown(
  event: { preventDefault(): void },
  activate: () => void,
) {
  preserveComposerFocusOnPointerDown(event);
  activate();
}

/** Keeps one asynchronous Composer submission in flight at a time. */
export function createSubmissionGate() {
  let pending = false;
  return {
    get pending(): boolean {
      return pending;
    },
    tryStart(): boolean {
      if (pending) return false;
      pending = true;
      return true;
    },
    stop(): void {
      pending = false;
    },
  };
}

export function useComposerController() {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionGate = useRef(createSubmissionGate());
  const inputValueRef = useRef("");
  const [composerMode, setComposerMode] = useState<TurnMode>("default");
  const composerRoot = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const historyIndex = useRef(-1);
  const historyDraft = useRef("");

  return {
    input,
    setInput,
    submitting,
    setSubmitting,
    submissionGate,
    inputValueRef,
    composerMode,
    setComposerMode,
    composerRoot,
    textarea,
    composing,
    historyIndex,
    historyDraft,
  };
}
