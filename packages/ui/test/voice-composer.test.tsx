import { ThreadlightClient } from "@threadlight/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  composerSubmitDelivery,
  MessageAttachments,
  ThreadlightApp,
} from "../src/app.js";

describe("voice composer", () => {
  it("uses Enter for prompt injection and Cmd/Ctrl+Enter for the queue while running", () => {
    expect(
      composerSubmitDelivery({ metaKey: false, ctrlKey: false }, true),
    ).toBe("inject");
    expect(
      composerSubmitDelivery({ metaKey: true, ctrlKey: false }, true),
    ).toBe("queued");
    expect(
      composerSubmitDelivery({ metaKey: false, ctrlKey: true }, true),
    ).toBe("queued");
    expect(
      composerSubmitDelivery({ metaKey: true, ctrlKey: false }, false),
    ).toBe("inject");
  });

  it("exposes voice input without changing the existing send action", () => {
    const client = new ThreadlightClient({
      send: vi.fn(),
      onMessage: () => () => undefined,
    });

    const html = renderToStaticMarkup(
      <ThreadlightApp
        client={client}
        voiceInput={{ transcribe: vi.fn() }}
      />,
    );

    expect(html).toContain('aria-label="语音输入"');
    expect(html).toContain('aria-label="发送消息"');
    expect(html).toContain('aria-describedby="composer-hint"');
    client.dispose();
  });

  it("exposes a file picker when a local staging adapter is available", () => {
    const client = new ThreadlightClient({
      send: vi.fn(),
      onMessage: () => () => undefined,
    });
    const html = renderToStaticMarkup(
      <ThreadlightApp
        client={client}
        attachmentStage={{ stage: vi.fn() }}
      />,
    );

    expect(html).toContain('aria-label="添加"');
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple=""');
    client.dispose();
  });

  it("derives image preview URLs at render time", () => {
    const html = renderToStaticMarkup(
      <MessageAttachments
        attachments={[
          {
            id: "attachment-1",
            name: "diagram.png",
            mimeType: "image/png",
            size: 5,
            kind: "image",
            path: "/workspace/diagram.png",
          },
        ]}
        attachmentPreview={{
          imageUrl: (attachment) => `threadlight-attachment://local/${attachment.id}`,
        }}
      />,
    );

    expect(html).toContain('src="threadlight-attachment://local/attachment-1"');
    expect(html).not.toContain("/workspace/diagram.png");
  });

  it("falls back to a file entry when preview URL generation fails", () => {
    const html = renderToStaticMarkup(
      <MessageAttachments
        attachments={[
          {
            id: "attachment-1",
            name: "diagram.png",
            mimeType: "image/png",
            size: 5,
            kind: "image",
            path: "/workspace/diagram.png",
          },
        ]}
        attachmentPreview={{
          imageUrl: () => {
            throw new Error("preview unavailable");
          },
        }}
      />,
    );

    expect(html).toContain("diagram.png");
    expect(html).not.toContain("<img");
  });
});
