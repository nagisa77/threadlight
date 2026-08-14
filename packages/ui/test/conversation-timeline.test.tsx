import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConversationTimeline,
  conversationTimelineEntries,
} from "../src/features/task-session/conversation-timeline.js";
import type { ConversationMessage } from "../src/features/task-session/session.js";
import { readUiStyles } from "./style-source.js";

const messages: readonly ConversationMessage[] = [
  { id: "question-1", role: "user", text: "  First\nquestion  " },
  { id: "empty-answer", role: "assistant", text: "  " },
  { id: "answer-1", role: "assistant", text: " First\nanswer " },
  { id: "ignored-answer", role: "assistant", text: "Ignored answer" },
  {
    id: "question-2",
    role: "user",
    text: "",
    attachments: [{ name: "reference.png" }],
  },
];

describe("conversation timeline", () => {
  it("pairs each question with its first non-empty answer", () => {
    expect(conversationTimelineEntries(messages, "Attachment-only")).toEqual([
      {
        messageId: "question-1",
        question: "First question",
        response: "First answer",
      },
      { messageId: "question-2", question: "Attachment-only" },
    ]);
  });

  it("renders one accessible jump target per question and omits missing answers", () => {
    const html = renderToStaticMarkup(
      <ConversationTimeline messages={messages} onJump={vi.fn()} />,
    );

    expect(html).toContain('aria-label="对话时间轴"');
    expect(html).toContain("跳转到提问：First question");
    expect(html).toContain("First answer");
    expect(html).toContain("仅附件消息");
    expect(html.match(/conversation-timeline-item/g)).toHaveLength(2);
    expect(html.match(/<small>/g)).toHaveLength(1);
  });

  it("does not render a timeline for a single-turn conversation", () => {
    const html = renderToStaticMarkup(
      <ConversationTimeline messages={messages.slice(0, 3)} onJump={vi.fn()} />,
    );

    expect(html).toBe("");
  });

  it("wires timeline selection to the existing message anchor jump", () => {
    const appSource = readFileSync(
      new URL("../src/app-root.tsx", import.meta.url),
      "utf8",
    );

    expect(appSource).toMatch(
      /<Timeline messages=\{state\.messages\} onJump=\{jumpToMessage\}/,
    );
    expect(appSource).toContain("id={`message-${message.id}`}");
  });

  it("uses truncated previews, a lighter answer, and hides on mobile", () => {
    const styles = readUiStyles();

    expect(styles).toMatch(
      /\.conversation-timeline\s*\{[^}]*position:\s*sticky;[^}]*left:\s*18px;[^}]*width:\s*48px;/s,
    );
    expect(styles).toMatch(
      /\.conversation-timeline-item\s*\{[^}]*width:\s*48px;[^}]*flex:\s*1 1 16px;/s,
    );
    expect(styles).toMatch(
      /\.conversation-timeline-item:hover \.conversation-timeline-tick\s*\{[^}]*width:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.conversation-timeline-card strong\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(styles).toMatch(
      /\.conversation-timeline-card small\s*\{[^}]*overflow:\s*hidden;[^}]*color:\s*var\(--subtle\);[^}]*-webkit-line-clamp:\s*3;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.conversation-timeline\s*\{[^}]*display:\s*none;/s,
    );
  });
});
