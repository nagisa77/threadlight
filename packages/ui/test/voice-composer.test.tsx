import { readFileSync } from "node:fs";
import { ThreadlightClient } from "@threadlight/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  composerSubmitDelivery,
  MessageAttachments,
  preserveComposerFocusOnPointerDown,
  ThreadlightApp,
} from "../src/app.js";
import {
  activateVoiceInputFromClick,
  activateVoiceInputFromPointerDown,
} from "../src/features/composer/voice-input-button.js";
import {
  COMPOSER_ERROR_DISMISS_MS,
  scheduleComposerErrorDismissal,
} from "../src/features/composer/controller.js";

const appSource = readFileSync(
  new URL("../src/app-root.tsx", import.meta.url),
  "utf8",
);
const voiceInputControllerSource = readFileSync(
  new URL(
    "../src/features/composer/voice-input-controller.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("voice composer", () => {
  it("always queues composer submissions while a turn is running", () => {
    expect(
      composerSubmitDelivery({ metaKey: false, ctrlKey: false }, true),
    ).toBe("queued");
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
      <ThreadlightApp client={client} voiceInput={{ transcribe: vi.fn() }} />,
    );

    expect(html).toContain('aria-label="语音输入"');
    expect(html).toContain('aria-label="发送消息"');
    expect(html).toContain('aria-describedby="composer-hint"');
    expect(html).toContain('rows="2"');
    expect(html).toContain('data-mobile-instruction="true"');
    expect(html).toContain('class="composer-toolbar-start"');
    expect(html).toContain('class="composer-toolbar-end"');
    expect(html).toContain('class="composer-footer-status"');
    expect(html.indexOf("<textarea")).toBeLessThan(
      html.indexOf('class="composer-toolbar"'),
    );
    expect(html.indexOf('id="composer-hint"')).toBeLessThan(
      html.indexOf('class="composer-productivity-status"'),
    );
    client.dispose();
  });

  it("keeps pointer submission from moving focus before the send click", () => {
    const preventDefault = vi.fn();

    preserveComposerFocusOnPointerDown({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("keeps the mobile stop action mounted until its click fires", () => {
    expect(appSource).toMatch(
      /className="composer-action stop pressable"\s+onPointerDown=\{preserveComposerFocusOnPointerDown\}\s+onClick=\{\(\) => void interrupt\(\)\}/,
    );
  });

  it("keeps the mobile composer expanded for the full voice lifecycle", () => {
    expect(appSource).toContain(
      'voiceStatus !== "idle" ? " is-voice-active" : ""',
    );
    expect(appSource).not.toMatch(
      /selectedCapabilities\.length > 0 \|\|\s*voiceError/,
    );
    expect(appSource).toContain("dismissComposerErrors();");
  });

  it("automatically dismisses composer errors after five seconds", () => {
    const dismiss = vi.fn();
    const clearTimeout = vi.fn();
    let timeout: (() => void) | undefined;
    const dispose = scheduleComposerErrorDismissal(dismiss, {
      setTimeout(callback, delay) {
        expect(delay).toBe(COMPOSER_ERROR_DISMISS_MS);
        timeout = callback;
        return 7;
      },
      clearTimeout,
    });

    timeout?.();
    expect(dismiss).toHaveBeenCalledOnce();
    dispose();
    expect(clearTimeout).toHaveBeenCalledWith(7);
  });

  it("starts voice input during pointerdown before the mobile composer can move", () => {
    const activate = vi.fn();

    activateVoiceInputFromPointerDown({ button: 0 }, activate);
    activateVoiceInputFromClick({ detail: 1 }, activate);

    expect(activate).toHaveBeenCalledOnce();
    expect(voiceInputControllerSource).toContain(
      "microphoneSecureContextRequired",
    );
  });

  it("keeps keyboard activation available without duplicating pointer input", () => {
    const activate = vi.fn();

    activateVoiceInputFromPointerDown({ button: 2 }, activate);
    activateVoiceInputFromClick({ detail: 0 }, activate);

    expect(activate).toHaveBeenCalledOnce();
  });

  it("exposes a file picker when a local staging adapter is available", () => {
    const client = new ThreadlightClient({
      send: vi.fn(),
      onMessage: () => () => undefined,
    });
    const html = renderToStaticMarkup(
      <ThreadlightApp client={client} attachmentStage={{ stage: vi.fn() }} />,
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
          imageUrl: (attachment) =>
            `threadlight-attachment://local/${attachment.id}`,
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

  it("reserves an image slot while an authenticated preview loads", () => {
    const html = renderToStaticMarkup(
      <MessageAttachments
        attachments={[
          {
            id: "attachment-1",
            name: "remote-diagram.png",
            mimeType: "image/png",
            size: 5,
            kind: "image",
            path: "/remote/project/remote-diagram.png",
          },
        ]}
        attachmentPreview={{
          imageUrl: () => undefined,
          loadImageUrl: vi.fn(),
        }}
      />,
    );

    expect(html).toContain('class="message-image-placeholder"');
    expect(html).toContain("remote-diagram.png");
  });
});
