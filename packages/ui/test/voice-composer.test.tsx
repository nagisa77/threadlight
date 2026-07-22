import { ThreadlightClient } from "@threadlight/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ThreadlightApp } from "../src/app.js";

describe("voice composer", () => {
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
});
