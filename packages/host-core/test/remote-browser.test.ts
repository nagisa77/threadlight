import { EventEmitter } from "node:events";

import type {
  Browser,
  BrowserContext,
  CDPSession,
  Page,
} from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import {
  RemoteBrowserService,
  normalizeBrowserUrl,
} from "../src/remote-browser.js";

describe("RemoteBrowserService", () => {
  it("streams Chrome frames and forwards navigation and interactive input", async () => {
    const page = new FakePage();
    const cdp = new FakeCdp();
    const context = {
      newPage: async () => page as unknown as Page,
      newCDPSession: async () => cdp as unknown as CDPSession,
      close: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const browser = new FakeBrowser(context);
    const events: unknown[] = [];
    const service = new RemoteBrowserService({
      homePath: "/tmp/threadlight-browser-test",
      executablePath: process.execPath,
      launch: async () => browser as unknown as Browser,
    });
    const sessions = service.createSessions((event) => events.push(event));
    const session = await sessions.create({
      width: 1200,
      height: 720,
      deviceScaleFactor: 1,
    });

    expect(session).toMatchObject({
      url: "about:blank",
      viewport: { width: 1200, height: 720, deviceScaleFactor: 1 },
    });
    expect(cdp.commands.map(({ method }) => method)).toEqual([
      "Page.enable",
      "Page.setLifecycleEventsEnabled",
      "Page.startScreencast",
      "Page.getNavigationHistory",
    ]);

    cdp.emit("Page.screencastFrame", {
      sessionId: 7,
      data: "jpeg-frame",
      metadata: { deviceWidth: 1200, deviceHeight: 720 },
    });
    expect(events).toContainEqual({
      type: "frame",
      sessionId: session.id,
      frameId: 7,
      data: "jpeg-frame",
      width: 1200,
      height: 720,
    });

    await sessions.command({
      type: "navigate",
      sessionId: session.id,
      url: "localhost:4173/demo",
    });
    expect(page.gotoCalls).toEqual(["http://localhost:4173/demo"]);
    await sessions.command({
      type: "pointer",
      sessionId: session.id,
      phase: "down",
      x: 44,
      y: 80,
      button: "left",
    });
    await sessions.command({
      type: "insert-text",
      sessionId: session.id,
      text: "Threadlight",
    });
    await sessions.command({
      type: "frame-ack",
      sessionId: session.id,
      frameId: 7,
    });
    expect(cdp.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "Input.dispatchMouseEvent",
          params: expect.objectContaining({
            type: "mousePressed",
            x: 44,
            y: 80,
          }),
        }),
        {
          method: "Input.insertText",
          params: { text: "Threadlight" },
        },
        {
          method: "Page.screencastFrameAck",
          params: { sessionId: 7 },
        },
      ]),
    );

    await sessions.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    await service.close();
    expect(browser.closed).toBe(true);
  });

  it("treats localhost as the Host's localhost and searches plain text", () => {
    expect(normalizeBrowserUrl("localhost:3000")).toBe(
      "http://localhost:3000/",
    );
    expect(normalizeBrowserUrl("threadlight.xyz/docs")).toBe(
      "https://threadlight.xyz/docs",
    );
    expect(normalizeBrowserUrl("remote browser test")).toBe(
      "https://www.google.com/search?q=remote%20browser%20test",
    );
    expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow(
      "http, https, or about",
    );
  });
});

class FakeBrowser extends EventEmitter {
  closed = false;

  constructor(private readonly context: BrowserContext) {
    super();
  }

  async newContext(): Promise<BrowserContext> {
    return this.context;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeCdp extends EventEmitter {
  readonly commands: Array<{ method: string; params?: unknown }> = [];
  history = { currentIndex: 0, entries: [{ id: 1, url: "about:blank" }] };

  async send(method: string, params?: unknown): Promise<unknown> {
    this.commands.push({ method, ...(params === undefined ? {} : { params }) });
    if (method === "Page.getNavigationHistory") return this.history;
    return {};
  }
}

class FakePage extends EventEmitter {
  readonly gotoCalls: string[] = [];
  private currentUrl = "about:blank";
  private currentTitle = "";

  async setViewportSize(): Promise<void> {}

  async title(): Promise<string> {
    return this.currentTitle;
  }

  url(): string {
    return this.currentUrl;
  }

  mainFrame(): object {
    return this;
  }

  async goto(url: string): Promise<null> {
    this.gotoCalls.push(url);
    this.currentUrl = url;
    this.currentTitle = "Remote demo";
    this.emit("load");
    return null;
  }

  async goBack(): Promise<null> {
    return null;
  }

  async goForward(): Promise<null> {
    return null;
  }

  async reload(): Promise<null> {
    return null;
  }

  async close(): Promise<void> {
    this.emit("close");
  }
}
