import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComposerQueue,
  GuidedMessageReceipt,
  queuedTurnDropBeforeId,
} from "../src/composer-queue.js";

describe("ComposerQueue", () => {
  const items = [
    {
      id: "queued-1",
      input: "先完成当前回答",
      delivery: "queued" as const,
      attachments: [
        {
          id: "attachment-1",
          name: "brief.pdf",
          mimeType: "application/pdf",
          size: 42,
          kind: "file" as const,
          path: "/tmp/brief.pdf",
        },
      ],
      createdAt: "2026-08-07T00:00:00.000Z",
    },
    {
      id: "queued-2",
      input: "立即改变方向",
      delivery: "inject" as const,
      createdAt: "2026-08-07T00:00:01.000Z",
    },
  ];

  it("shows attachments, explicit guidance, drag affordance, and pending injection state", () => {
    const html = renderToStaticMarkup(
      <ComposerQueue
        items={items}
        onInject={vi.fn()}
        onReorder={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("先完成当前回答");
    expect(html).toContain("1 个附件");
    expect(html).toContain("拖拽调整排队顺序");
    expect(html).toContain("尽快引导这条消息");
    expect(html).toContain("等待引导");
  });

  it("computes stable before-item ids for both drop edges", () => {
    expect(
      queuedTurnDropBeforeId(items, "queued-1", "queued-2", "after"),
    ).toBeUndefined();
    expect(
      queuedTurnDropBeforeId(items, "queued-2", "queued-1", "before"),
    ).toBe("queued-1");
  });
});

describe("GuidedMessageReceipt", () => {
  it("makes a consumed guidance action visible in conversation history", () => {
    const html = renderToStaticMarkup(<GuidedMessageReceipt />);

    expect(html).toContain("已引导至当前运行");
    expect(html).toContain("lucide-check");
  });
});
