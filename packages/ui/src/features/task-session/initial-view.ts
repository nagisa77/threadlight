import { useLayoutEffect, useRef, type RefObject } from "react";

import type { SessionState } from "./session.js";

export function useInitialViewReady({
  onReady,
  restoreComplete,
  hasCurrentProject,
  connection,
  messagesLength,
  conversation,
  followOutput,
}: {
  onReady?(): void;
  restoreComplete: boolean;
  hasCurrentProject: boolean;
  connection: SessionState["connection"];
  messagesLength: number;
  conversation: RefObject<HTMLElement | null>;
  followOutput: RefObject<boolean>;
}) {
  const reported = useRef(false);

  useLayoutEffect(() => {
    if (
      !onReady ||
      reported.current ||
      !restoreComplete ||
      (hasCurrentProject && connection === "connecting")
    ) {
      return;
    }

    const element = conversation.current;
    if (element && followOutput.current) {
      element.scrollTop = element.scrollHeight;
    }
    const frame = requestAnimationFrame(() => {
      if (element && followOutput.current) {
        element.scrollTop = element.scrollHeight;
      }
      reported.current = true;
      onReady();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    connection,
    conversation,
    followOutput,
    hasCurrentProject,
    messagesLength,
    onReady,
    restoreComplete,
  ]);
}
