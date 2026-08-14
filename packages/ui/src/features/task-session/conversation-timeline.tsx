import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n.js";
import type { ConversationMessage } from "./session.js";

export interface ConversationTimelineEntry {
  messageId: string;
  question: string;
  response?: string;
}

export function conversationTimelineEntries(
  messages: readonly ConversationMessage[],
  attachmentFallback: string,
): ConversationTimelineEntry[] {
  const entries: ConversationTimelineEntry[] = [];
  let current: ConversationTimelineEntry | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      const question = timelinePreview(message.text) || attachmentFallback;
      current = { messageId: message.id, question };
      entries.push(current);
      continue;
    }

    const response = timelinePreview(message.text);
    if (current && response && !current.response) current.response = response;
  }

  return entries;
}

export function ConversationTimeline({
  messages,
  onJump,
}: {
  messages: readonly ConversationMessage[];
  onJump(messageId: string): void;
}) {
  const { t } = useI18n();
  const timeline = useRef<HTMLElement>(null);
  const entries = conversationTimelineEntries(
    messages,
    t("attachmentOnlyFollowUp"),
  );
  const entryIds = entries.map(({ messageId }) => messageId);
  const entrySignature = entryIds.join("\u0000");
  const [activeMessageId, setActiveMessageId] = useState<string>();

  useEffect(() => {
    const scroller = timeline.current?.closest<HTMLElement>(".conversation");
    if (!scroller || entryIds.length < 2) return;

    let animationFrame = 0;
    const updateActiveMessage = () => {
      animationFrame = 0;
      const threshold =
        scroller.getBoundingClientRect().top +
        Math.min(scroller.clientHeight * 0.3, 220);
      let nextActiveId = entryIds[0];

      for (const messageId of entryIds) {
        const message = document.getElementById(`message-${messageId}`);
        if (!message || message.getBoundingClientRect().top > threshold) break;
        nextActiveId = messageId;
      }

      setActiveMessageId((current) =>
        current === nextActiveId ? current : nextActiveId,
      );
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateActiveMessage);
    };

    scheduleUpdate();
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      scroller.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [entrySignature]);

  if (entries.length < 2) return null;

  const currentMessageId = entries.some(
    ({ messageId }) => messageId === activeMessageId,
  )
    ? activeMessageId
    : entries[0].messageId;

  return (
    <nav
      ref={timeline}
      className="conversation-timeline"
      aria-label={t("conversationTimeline")}
      aria-live="off"
    >
      <div
        className="conversation-timeline-list"
        style={{ height: `${Math.min(entries.length * 16, 280)}px` }}
      >
        {entries.map((entry) => {
          const current = entry.messageId === currentMessageId;
          return (
            <button
              type="button"
              className="conversation-timeline-item"
              aria-current={current ? "location" : undefined}
              aria-label={t("jumpToQuestion", { question: entry.question })}
              key={entry.messageId}
              onClick={() => onJump(entry.messageId)}
            >
              <span className="conversation-timeline-tick" aria-hidden="true" />
              <span className="conversation-timeline-card" aria-hidden="true">
                <strong>{entry.question}</strong>
                {entry.response && <small>{entry.response}</small>}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function timelinePreview(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
