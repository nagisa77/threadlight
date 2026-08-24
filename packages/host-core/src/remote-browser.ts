import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { basename, delimiter, join, resolve } from "node:path";

import type {
  BrowserMouseButton,
  BrowserSessionEvent,
  BrowserSessionInfo,
  BrowserViewport,
  HostBrowserClientMessage,
} from "@threadlight/protocol";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Dialog,
  Download,
  Page,
} from "playwright-core";

type BrowserCommand = Exclude<HostBrowserClientMessage, { type: "open" }>;

export interface RemoteBrowserSessions {
  create(input: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<BrowserSessionInfo>;
  owns(sessionId: string): boolean;
  command(message: BrowserCommand): Promise<void>;
  close(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface RemoteBrowserServiceOptions {
  homePath: string;
  executablePath?: string;
  launch?: (options: {
    executablePath: string;
    downloadsPath: string;
  }) => Promise<Browser>;
}

interface LiveBrowserSession {
  info: BrowserSessionInfo;
  page: Page;
  cdp: CDPSession;
  dialogs: Map<string, Dialog>;
  queue: Promise<void>;
  closed: boolean;
}

const MIN_VIEWPORT_WIDTH = 320;
const MIN_VIEWPORT_HEIGHT = 240;
const MAX_VIEWPORT_WIDTH = 3840;
const MAX_VIEWPORT_HEIGHT = 2160;
const MAX_DEVICE_SCALE_FACTOR = 2;

/**
 * Owns the one headless Chrome child process for a Threadlight Host. Each
 * connected client receives an isolated browser context while its panel tabs
 * share cookies and storage inside that context.
 */
export class RemoteBrowserService {
  private browser?: Promise<Browser>;
  private closed = false;

  constructor(private readonly options: RemoteBrowserServiceOptions) {}

  createSessions(
    send: (event: BrowserSessionEvent) => void,
  ): RemoteBrowserSessions {
    if (this.closed) throw new Error("Remote browser service is closed.");
    return new PlaywrightBrowserSessions(this, send);
  }

  async context(viewport: BrowserViewport): Promise<BrowserContext> {
    const browser = await this.requireBrowser();
    return browser.newContext({
      acceptDownloads: true,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      serviceWorkers: "allow",
    });
  }

  downloadsPath(): string {
    return join(this.options.homePath, "browser-downloads");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await (await browser).close().catch(() => undefined);
  }

  private requireBrowser(): Promise<Browser> {
    if (this.closed) {
      return Promise.reject(new Error("Remote browser service is closed."));
    }
    if (this.browser) return this.browser;
    this.browser = this.launchBrowser().catch((error) => {
      this.browser = undefined;
      throw error;
    });
    return this.browser;
  }

  private async launchBrowser(): Promise<Browser> {
    const executablePath = await findChromeExecutable(
      this.options.executablePath ?? process.env.THREADLIGHT_CHROME_PATH,
    );
    const downloadsPath = this.downloadsPath();
    await mkdir(downloadsPath, { recursive: true });
    const browser = this.options.launch
      ? await this.options.launch({ executablePath, downloadsPath })
      : await (
          await loadChromium()
        ).launch({
          executablePath,
          headless: true,
          chromiumSandbox: false,
          downloadsPath,
          args: [
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-dev-shm-usage",
            "--disable-features=Translate,MediaRouter",
            "--no-default-browser-check",
            "--no-first-run",
          ],
        });
    browser.once("disconnected", () => {
      this.browser = undefined;
    });
    return browser;
  }
}

async function loadChromium() {
  const moduleName = ["playwright", "core"].join("-");
  const playwright = (await import(
    moduleName
  )) as typeof import("playwright-core");
  return playwright.chromium;
}

class PlaywrightBrowserSessions implements RemoteBrowserSessions {
  private readonly sessions = new Map<string, LiveBrowserSession>();
  private contextPromise?: Promise<BrowserContext>;
  private disposed = false;

  constructor(
    private readonly service: RemoteBrowserService,
    private readonly send: (event: BrowserSessionEvent) => void,
  ) {}

  async create(input: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<BrowserSessionInfo> {
    if (this.disposed) throw new Error("Browser connection is closed.");
    const viewport = normalizeViewport(input);
    const context = await this.context(viewport);
    const page = await context.newPage();
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const cdp = await context.newCDPSession(page);
    const info: BrowserSessionInfo = {
      id: randomUUID(),
      url: "about:blank",
      title: "",
      canGoBack: false,
      canGoForward: false,
      loading: false,
      viewport,
    };
    const session: LiveBrowserSession = {
      info,
      page,
      cdp,
      dialogs: new Map(),
      queue: Promise.resolve(),
      closed: false,
    };
    this.sessions.set(info.id, session);
    this.installPageListeners(session);
    await cdp.send("Page.enable");
    await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });
    cdp.on("Page.screencastFrame", (frame) => {
      if (session.closed) return;
      this.send({
        type: "frame",
        sessionId: info.id,
        frameId: frame.sessionId,
        data: frame.data,
        width: Math.max(
          1,
          Math.round(frame.metadata.deviceWidth ?? session.info.viewport.width),
        ),
        height: Math.max(
          1,
          Math.round(
            frame.metadata.deviceHeight ?? session.info.viewport.height,
          ),
        ),
      });
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 78,
      maxWidth: MAX_VIEWPORT_WIDTH,
      maxHeight: MAX_VIEWPORT_HEIGHT,
      everyNthFrame: 1,
    });
    await this.refreshState(session, false);
    return { ...session.info, viewport: { ...session.info.viewport } };
  }

  owns(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async command(message: BrowserCommand): Promise<void> {
    const session = this.requireSession(message.sessionId);
    if (message.type === "frame-ack") {
      await session.cdp
        .send("Page.screencastFrameAck", { sessionId: message.frameId })
        .catch(() => undefined);
      return;
    }
    if (message.type === "close") {
      await this.close(message.sessionId);
      return;
    }
    await this.enqueue(session, async () => {
      if (message.type === "navigate") {
        await this.navigate(session, message.url);
        return;
      }
      if (message.type === "back") {
        await session.page.goBack({ waitUntil: "commit", timeout: 30_000 });
        await this.refreshState(session, false);
        return;
      }
      if (message.type === "forward") {
        await session.page.goForward({ waitUntil: "commit", timeout: 30_000 });
        await this.refreshState(session, false);
        return;
      }
      if (message.type === "reload") {
        await session.page.reload({ waitUntil: "commit", timeout: 30_000 });
        await this.refreshState(session, false);
        return;
      }
      if (message.type === "stop") {
        await session.cdp.send("Page.stopLoading");
        await this.refreshState(session, false);
        return;
      }
      if (message.type === "resize") {
        const viewport = normalizeViewport(message);
        session.info = { ...session.info, viewport };
        await session.page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        this.emitState(session);
        return;
      }
      if (message.type === "pointer") {
        await session.cdp.send("Input.dispatchMouseEvent", {
          type:
            message.phase === "move"
              ? "mouseMoved"
              : message.phase === "down"
                ? "mousePressed"
                : "mouseReleased",
          x: message.x,
          y: message.y,
          button: message.button,
          clickCount: message.clickCount ?? 1,
          modifiers: message.modifiers ?? 0,
        });
        return;
      }
      if (message.type === "wheel") {
        await session.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: message.x,
          y: message.y,
          button: "none",
          deltaX: message.deltaX,
          deltaY: message.deltaY,
          modifiers: message.modifiers ?? 0,
        });
        return;
      }
      if (message.type === "key") {
        await session.cdp.send("Input.dispatchKeyEvent", {
          type: message.phase === "down" ? "rawKeyDown" : "keyUp",
          key: message.key,
          code: message.code,
          text: message.text,
          modifiers: message.modifiers ?? 0,
          autoRepeat: message.repeat ?? false,
        });
        return;
      }
      if (message.type === "insert-text") {
        await session.cdp.send("Input.insertText", { text: message.text });
        return;
      }
      if (message.type !== "dialog") {
        throw new Error("Unsupported browser command.");
      }
      const dialog = session.dialogs.get(message.dialogId);
      if (!dialog) throw new Error("Browser dialog is no longer open.");
      session.dialogs.delete(message.dialogId);
      if (message.accept) await dialog.accept(message.promptText);
      else await dialog.dismiss();
    });
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.closed = true;
    for (const dialog of session.dialogs.values()) {
      await dialog.dismiss().catch(() => undefined);
    }
    session.dialogs.clear();
    await session.cdp.send("Page.stopScreencast").catch(() => undefined);
    await session.page.close().catch(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
    const context = this.contextPromise;
    this.contextPromise = undefined;
    if (context) await (await context).close().catch(() => undefined);
  }

  private context(viewport: BrowserViewport): Promise<BrowserContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.service.context(viewport).catch((error) => {
        this.contextPromise = undefined;
        throw error;
      });
    }
    return this.contextPromise;
  }

  private requireSession(sessionId: string): LiveBrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) {
      throw new Error("Browser session is no longer available.");
    }
    return session;
  }

  private enqueue(
    session: LiveBrowserSession,
    operation: () => Promise<void>,
  ): Promise<void> {
    const next = session.queue.then(operation);
    session.queue = next.catch(() => undefined);
    return next;
  }

  private async navigate(
    session: LiveBrowserSession,
    value: string,
  ): Promise<void> {
    const url = normalizeBrowserUrl(value);
    await this.refreshState(session, true, url);
    try {
      await session.page.goto(url, { waitUntil: "commit", timeout: 30_000 });
    } catch (error) {
      await this.refreshState(session, false);
      throw error;
    }
  }

  private installPageListeners(session: LiveBrowserSession): void {
    const { page } = session;
    page.on("request", (request) => {
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        void this.refreshState(session, true, request.url());
      }
    });
    page.on("domcontentloaded", () => {
      void this.refreshState(session, false);
    });
    page.on("load", () => {
      void this.refreshState(session, false);
    });
    page.on("dialog", (dialog) => this.openDialog(session, dialog));
    page.on("download", (download) => {
      void this.saveDownload(session, download);
    });
    page.on("popup", (popup) => {
      void popup
        .waitForLoadState("domcontentloaded", { timeout: 15_000 })
        .catch(() => undefined)
        .then(async () => {
          const url = popup.url();
          await popup.close().catch(() => undefined);
          if (url && url !== "about:blank") await this.navigate(session, url);
        })
        .catch((error) => this.emitError(session.info.id, error));
    });
    page.on("crash", () => this.closeFromPage(session, "Chrome page crashed."));
    page.on("close", () => this.closeFromPage(session));
  }

  private openDialog(session: LiveBrowserSession, dialog: Dialog): void {
    const dialogId = randomUUID();
    session.dialogs.set(dialogId, dialog);
    this.send({
      type: "dialog",
      sessionId: session.info.id,
      dialogId,
      dialogType: dialog.type() as
        "alert" | "beforeunload" | "confirm" | "prompt",
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
    });
  }

  private async saveDownload(
    session: LiveBrowserSession,
    download: Download,
  ): Promise<void> {
    const downloadId = randomUUID();
    const filename = safeDownloadFilename(download.suggestedFilename());
    this.send({
      type: "download",
      sessionId: session.info.id,
      downloadId,
      filename,
      status: "started",
    });
    try {
      const path = await availableDownloadPath(
        this.service.downloadsPath(),
        filename,
      );
      await download.saveAs(path);
      const error = await download.failure();
      if (error) throw new Error(error);
      this.send({
        type: "download",
        sessionId: session.info.id,
        downloadId,
        filename,
        status: "completed",
        path,
      });
    } catch (error) {
      this.send({
        type: "download",
        sessionId: session.info.id,
        downloadId,
        filename,
        status: "failed",
        error: errorMessage(error),
      });
    }
  }

  private async refreshState(
    session: LiveBrowserSession,
    loading: boolean,
    pendingUrl?: string,
  ): Promise<void> {
    if (session.closed) return;
    const [title, history] = await Promise.all([
      session.page.title().catch(() => session.info.title),
      session.cdp
        .send("Page.getNavigationHistory")
        .catch(() => ({ currentIndex: 0, entries: [] })),
    ]);
    if (session.closed) return;
    const currentIndex = history.currentIndex;
    session.info = {
      ...session.info,
      url: pendingUrl ?? session.page.url(),
      title,
      canGoBack: currentIndex > 0,
      canGoForward: currentIndex < history.entries.length - 1,
      loading,
    };
    this.emitState(session);
  }

  private emitState(session: LiveBrowserSession): void {
    this.send({
      type: "state",
      session: {
        ...session.info,
        viewport: { ...session.info.viewport },
      },
    });
  }

  private emitError(sessionId: string, error: unknown): void {
    this.send({ type: "error", sessionId, message: errorMessage(error) });
  }

  private closeFromPage(session: LiveBrowserSession, reason?: string): void {
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(session.info.id);
    this.send({
      type: "closed",
      sessionId: session.info.id,
      ...(reason ? { reason } : {}),
    });
  }
}

export async function findChromeExecutable(
  configured?: string,
): Promise<string> {
  const candidates = [
    configured?.trim(),
    ...(process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? windowsChromeCandidates()
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/snap/bin/chromium",
          ]),
    ...pathChromeCandidates(),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of new Set(candidates.map((value) => resolve(value)))) {
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error(
    "Google Chrome or Chromium is required on the Threadlight Host. Install Chrome, or set THREADLIGHT_CHROME_PATH to its executable.",
  );
}

export function normalizeBrowserUrl(value: string): string {
  const input = value.trim();
  if (!input) return "about:blank";
  if (
    /^(localhost|\[?[a-f\d:]+\]?|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:[/?#]|$)/i.test(
      input,
    )
  ) {
    return new URL(`http://${input}`).toString();
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) {
    const url = new URL(input);
    if (!["http:", "https:", "about:"].includes(url.protocol)) {
      throw new Error("Browser URLs must use http, https, or about.");
    }
    return url.toString();
  }
  if (/^[^\s]+\.[^\s]+(?:[/?#]|$)/.test(input)) {
    return new URL(`https://${input}`).toString();
  }
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function normalizeViewport(input: {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}): BrowserViewport {
  return {
    width: clampInteger(input.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH),
    height: clampInteger(
      input.height,
      MIN_VIEWPORT_HEIGHT,
      MAX_VIEWPORT_HEIGHT,
    ),
    deviceScaleFactor: Math.min(
      MAX_DEVICE_SCALE_FACTOR,
      Math.max(1, input.deviceScaleFactor ?? 1),
    ),
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function windowsChromeCandidates(): string[] {
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter((value): value is string => Boolean(value));
  return roots.flatMap((root) => [
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Chromium", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
  ]);
}

function pathChromeCandidates(): string[] {
  const names =
    process.platform === "win32"
      ? ["chrome.exe", "chromium.exe", "msedge.exe"]
      : [
          "google-chrome",
          "google-chrome-stable",
          "chromium",
          "chromium-browser",
          "microsoft-edge",
        ];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => join(directory, name)));
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(
      path,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function safeDownloadFilename(value: string): string {
  const filename = basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return filename || "download";
}

async function availableDownloadPath(
  directory: string,
  filename: string,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = join(
      directory,
      index === 0 ? filename : `${stem} (${index})${extension}`,
    );
    try {
      await access(candidate, constants.F_OK);
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not allocate a browser download filename.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function browserMouseButton(value: unknown): BrowserMouseButton {
  if (
    value === "none" ||
    value === "left" ||
    value === "middle" ||
    value === "right"
  ) {
    return value;
  }
  throw new Error("Invalid browser mouse button.");
}
