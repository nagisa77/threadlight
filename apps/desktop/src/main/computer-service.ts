import { execFile } from "node:child_process";
import { resolve } from "node:path";

import {
  BrowserWindow,
  desktopCapturer,
  screen,
  type DesktopCapturerSource,
  type WebContents,
} from "electron";
import type {
  ComputerShareTarget,
  ComputerUseAction,
} from "@threadlight/builtin-tools";
import type { DesktopComputerRequest } from "@threadlight/protocol";
import type { DesktopComputerShareSnapshot } from "../shared/desktop-api.js";

import {
  ComputerCaptureSession,
  captureStatusesMatchSources,
  type ComputerCaptureSource,
  type ComputerCaptureStreamMetadata,
  type ComputerCaptureStreamStatus,
} from "./computer-capture-session.js";
import { COMPUTER_CAPTURE_URL } from "./computer-capture.js";
import {
  enableMacOSChildWindowCapture,
  performMacOSComputerActions,
  type RoutedComputerAction,
} from "./computer-input.js";
import {
  COMPUTER_CANVAS_HEIGHT,
  COMPUTER_CANVAS_WIDTH,
  layoutComputerSources,
  mapCanvasPoint,
  type ComputerFrameLayout,
  type ComputerSourceBounds,
} from "./computer-layout.js";
import {
  COMPUTER_PREVIEW_MAX_SCALE,
  COMPUTER_PREVIEW_MIN_SCALE,
  COMPUTER_PREVIEW_URL,
  COMPUTER_PREVIEW_WINDOW_APPEARANCE,
  nextComputerPreviewScale,
  scaledComputerPreviewSize,
} from "./computer-preview.js";
import {
  ComputerSessionLease,
  type ComputerSessionOwner,
} from "./computer-session-lease.js";

interface WindowMetadata {
  windowId: number;
  title: string;
  applicationName: string;
  processId: number;
  layer: number;
  bounds: ComputerSourceBounds;
}

interface CaptureRecord {
  target: ComputerShareTarget;
  sourceId?: string;
  sourceType: "window" | "screen" | "application";
  sourceIds: readonly string[];
  applicationName: string;
  processId?: number;
  bounds?: ComputerSourceBounds;
}

interface CaptureCatalog {
  records: ReadonlyMap<string, CaptureRecord>;
  sourceRecords: ReadonlyMap<string, CaptureRecord>;
  targets: readonly ComputerShareTarget[];
}

interface ActiveCaptureSource extends ComputerCaptureSource {
  name: string;
  applicationName: string;
  processId?: number;
  bounds: ComputerSourceBounds;
}

interface ShareSelection {
  mode: "none" | "applications" | "windows" | "display";
  targetIds: readonly string[];
  pictureInPicture: boolean;
  inputMode: "virtual" | "system";
}

interface CursorPosition {
  x: number;
  y: number;
}

const EMPTY_SELECTION: ShareSelection = {
  mode: "none",
  targetIds: [],
  pictureInPicture: false,
  inputMode: "virtual",
};

export class DesktopComputerService {
  private selection: ShareSelection = EMPTY_SELECTION;
  private selectedTargets: ComputerShareTarget[] = [];
  private catalog?: CaptureCatalog;
  private catalogLoadedAt = 0;
  private captureWindow?: BrowserWindow;
  private preview?: BrowserWindow;
  private previewScale = 1;
  private previewDragOffset?: { x: number; y: number };
  private layout?: ComputerFrameLayout;
  private cursor?: CursorPosition;
  private activeProcessId?: number;
  private readonly sessionLease = new ComputerSessionLease();
  private pendingDisplayRequest?: {
    webContents: WebContents;
    source: DesktopCapturerSource;
  };
  private childWindowCaptureConfigured = false;
  private operation = Promise.resolve();
  private readonly captureSession =
    new ComputerCaptureSession<ActiveCaptureSource>({
      start: (source) => this.startMediaStream(source),
      stopAll: () => this.stopMediaStreams(),
      status: () => this.captureStatuses(),
    });

  constructor(
    private readonly onShareChanged: (
      snapshot: DesktopComputerShareSnapshot,
    ) => void = () => undefined,
  ) {}

  shareSnapshot(): DesktopComputerShareSnapshot {
    const owner = this.sessionLease.owner;
    return {
      active: this.selection.mode !== "none",
      pictureInPicture: this.selection.pictureInPicture,
      ...(owner ? { ownerThreadId: owner.threadId } : {}),
      targets: this.selectedTargets.map((target) => ({
        id: target.id,
        name: target.name,
        ...(target.applicationName
          ? { applicationName: target.applicationName }
          : {}),
      })),
    };
  }

  showPictureInPicture(): Promise<DesktopComputerShareSnapshot> {
    return this.serialize(async () => {
      if (this.selection.mode === "none") return this.shareSnapshot();
      this.selection = { ...this.selection, pictureInPicture: true };
      try {
        await this.captureSharedFrame();
        this.preview?.showInactive();
        this.preview?.moveTop();
        this.notifyShareChanged();
        return this.shareSnapshot();
      } catch (error) {
        this.selection = { ...this.selection, pictureInPicture: false };
        this.closePreview();
        this.notifyShareChanged();
        throw error;
      }
    });
  }

  stopSharing(): Promise<DesktopComputerShareSnapshot> {
    return this.serialize(async () => {
      await this.clear();
      return this.shareSnapshot();
    });
  }

  handle(request: DesktopComputerRequest): Promise<unknown> {
    return this.serialize(async () => {
      switch (request.method) {
        case "computer/list":
          return this.list(parseComputerOwner(request.params));
        case "computer/configure":
          return this.configure(parseConfigureParams(request.params));
        case "computer/clear":
          return this.clear(parseComputerOwner(request.params));
        case "computer/execute":
          return this.execute(parseExecuteParams(request.params));
      }
    });
  }

  ownsCaptureWebContents(webContents: WebContents | null): boolean {
    if (!webContents) return false;
    const ownsHiddenCapture =
      !!this.captureWindow &&
      !this.captureWindow.isDestroyed() &&
      webContents === this.captureWindow.webContents;
    const ownsPreview =
      !!this.preview &&
      !this.preview.isDestroyed() &&
      webContents === this.preview.webContents;
    return ownsHiddenCapture || ownsPreview;
  }

  ownsPreviewWebContents(webContents: WebContents | null): boolean {
    return (
      !!webContents &&
      !!this.preview &&
      !this.preview.isDestroyed() &&
      webContents === this.preview.webContents
    );
  }

  closePictureInPicture(): DesktopComputerShareSnapshot {
    const changed =
      this.selection.pictureInPicture ||
      (!!this.preview && !this.preview.isDestroyed());
    this.selection = {
      ...this.selection,
      pictureInPicture: false,
    };
    this.closePreview();
    if (changed) this.notifyShareChanged();
    return this.shareSnapshot();
  }

  resizePictureInPicture(pinchDeltaY: number): void {
    if (!Number.isFinite(pinchDeltaY) || !this.layout) return;
    const preview = this.preview;
    if (!preview || preview.isDestroyed()) return;
    const nextScale = nextComputerPreviewScale(
      this.previewScale,
      pinchDeltaY,
    );
    if (nextScale === this.previewScale) return;
    this.previewScale = nextScale;
    this.resizePreview(preview, this.layout);
  }

  dragPictureInPicture(
    phase: "start" | "move" | "end",
    x: number,
    y: number,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const preview = this.preview;
    if (!preview || preview.isDestroyed()) return;
    if (phase === "start") {
      const bounds = preview.getBounds();
      this.previewDragOffset = {
        x: x - bounds.x,
        y: y - bounds.y,
      };
      return;
    }
    if (phase === "end") {
      this.previewDragOffset = undefined;
      return;
    }
    const offset = this.previewDragOffset;
    if (!offset) return;
    preview.setPosition(
      Math.round(x - offset.x),
      Math.round(y - offset.y),
      false,
    );
  }

  dispose(): void {
    void this.stopPreviewRelays();
    this.preview?.destroy();
    this.preview = undefined;
    this.previewScale = 1;
    this.previewDragOffset = undefined;
    this.captureWindow?.destroy();
    this.captureWindow = undefined;
    this.pendingDisplayRequest = undefined;
    this.selection = EMPTY_SELECTION;
    this.selectedTargets = [];
    this.layout = undefined;
    this.cursor = undefined;
    this.activeProcessId = undefined;
    this.sessionLease.release();
  }

  private async list(
    owner: ComputerSessionOwner,
  ): Promise<readonly ComputerShareTarget[]> {
    const acquired = this.sessionLease.acquire(owner);
    if (acquired) this.notifyShareChanged();
    try {
      const catalog = await this.loadCatalog(true);
      return catalog.targets;
    } catch (error) {
      if (acquired) {
        this.sessionLease.release(owner);
        this.notifyShareChanged();
      }
      throw error;
    }
  }

  private async configure(options: {
    runId: string;
    threadId: string;
    mode: "applications" | "windows" | "display";
    targetIds: readonly string[];
    pictureInPicture: boolean;
    inputMode: "virtual" | "system";
  }) {
    const owner = { runId: options.runId, threadId: options.threadId };
    const acquired = this.sessionLease.acquire(owner);
    if (acquired) this.notifyShareChanged();
    try {
      return await this.configureSelection(options);
    } catch (error) {
      if (acquired) {
        this.sessionLease.release(owner);
        this.notifyShareChanged();
      }
      throw error;
    }
  }

  private async configureSelection(options: {
    mode: "applications" | "windows" | "display";
    targetIds: readonly string[];
    pictureInPicture: boolean;
    inputMode: "virtual" | "system";
  }) {
    if (!this.childWindowCaptureConfigured) {
      this.childWindowCaptureConfigured = enableMacOSChildWindowCapture();
    }
    const catalog = await this.loadCatalog(false);
    const records = options.targetIds.map((id) => {
      const record = catalog.records.get(id);
      if (!record) throw new Error(`Unknown computer share target: ${id}`);
      return record;
    });
    validateShareSelection(records, options);
    const sources = expandCaptureSources(records, catalog);
    if (!sources.length) {
      throw new Error("The selected applications have no visible windows");
    }
    if (sources.length > 12) {
      throw new Error(
        "A computer share session can include at most 12 visible windows",
      );
    }

    if (!options.pictureInPicture) this.closePreview();
    try {
      const activeSources = await this.captureSession.replace(sources);
      this.selection = {
        mode: options.mode,
        targetIds: records.map((record) => record.target.id),
        pictureInPicture: options.pictureInPicture,
        inputMode: options.inputMode,
      };
      this.selectedTargets = records.map((record) => record.target);
      this.cursor = undefined;
      this.activeProcessId = activeSources.find(
        (source) => source.processId,
      )?.processId;
      this.layout = layoutActiveSources(activeSources);
      await this.captureSharedFrame();
      this.notifyShareChanged();
      return this.state();
    } catch (error) {
      this.selection = EMPTY_SELECTION;
      this.selectedTargets = [];
      this.layout = undefined;
      this.cursor = undefined;
      this.activeProcessId = undefined;
      this.closePreview();
      this.notifyShareChanged();
      throw error;
    }
  }

  private async clear(owner?: ComputerSessionOwner) {
    if (owner && this.sessionLease.owner) {
      this.sessionLease.assertOwnedBy(owner);
    }
    await this.captureSession.stop();
    this.selection = EMPTY_SELECTION;
    this.selectedTargets = [];
    this.layout = undefined;
    this.cursor = undefined;
    this.activeProcessId = undefined;
    this.previewScale = 1;
    this.closePreview();
    this.sessionLease.release(owner);
    this.notifyShareChanged();
    return this.state();
  }

  private async execute({
    actions,
    owner,
  }: {
    actions: readonly ComputerUseAction[];
    owner: ComputerSessionOwner;
  }) {
    const acquired = this.sessionLease.acquire(owner);
    if (acquired) this.notifyShareChanged();
    try {
      return await this.executeActions(actions);
    } catch (error) {
      if (acquired) {
        this.sessionLease.release(owner);
        this.notifyShareChanged();
      }
      throw error;
    }
  }

  private async executeActions(actions: readonly ComputerUseAction[]) {
    if (this.selection.mode === "none") {
      throw new Error(
        "No content is shared. Call computer_share list and set before using computer.",
      );
    }
    if (!this.layout) {
      throw new Error("The live computer share layout is unavailable");
    }

    const routed: RoutedComputerAction[] = [];
    for (const action of actions) {
      if (action.type === "screenshot" || action.type === "wait") {
        if (action.type === "wait") {
          if (routed.length) {
            await this.performRouted(routed.splice(0));
          }
          await waitFor(2_000);
        }
        continue;
      }
      if (action.type === "type" || action.type === "keypress") {
        routed.push({
          ...action,
          ...(this.activeProcessId === undefined
            ? {}
            : { processId: this.activeProcessId }),
        });
        continue;
      }
      if (action.type === "drag") {
        const points = action.path.map((point) =>
          this.requireMappedPoint(point.x, point.y),
        );
        if (points.some((point) => point.sourceId !== points[0]?.sourceId)) {
          throw new Error("A drag path cannot cross shared content tiles");
        }
        const processId = points[0]?.processId;
        this.activeProcessId = processId ?? this.activeProcessId;
        const last = action.path.at(-1);
        if (last) this.cursor = { x: last.x, y: last.y };
        routed.push({
          ...action,
          path: points.map(({ x, y }) => ({ x, y })),
          ...(processId === undefined ? {} : { processId }),
        });
        continue;
      }
      if (!("x" in action) || !("y" in action)) {
        throw new Error(`Unsupported computer action: ${action.type}`);
      }

      const mapped = this.requireMappedPoint(action.x, action.y);
      this.cursor = { x: action.x, y: action.y };
      this.activeProcessId = mapped.processId ?? this.activeProcessId;
      routed.push({
        ...action,
        x: mapped.x,
        y: mapped.y,
        ...(mapped.processId === undefined
          ? {}
          : { processId: mapped.processId }),
      });
    }
    await this.performRouted(routed);
    if (routed.length) await waitFor(120);
    const screenshot = await this.captureSharedFrame();
    return { screenshot: screenshot.toString("base64") };
  }

  private async performRouted(actions: readonly RoutedComputerAction[]) {
    if (!actions.length) return;
    await performMacOSComputerActions(
      actions,
      this.selection.inputMode,
      new AbortController().signal,
    );
  }

  private requireMappedPoint(x: number, y: number) {
    if (!this.layout) throw new Error("Shared content layout is unavailable");
    const point = mapCanvasPoint(this.layout, x, y);
    if (!point) {
      throw new Error(
        "The computer coordinate is outside shared content. Click inside a visible app or display tile.",
      );
    }
    return point;
  }

  private async captureSharedFrame(): Promise<Buffer> {
    await this.ensureCaptureStreams();
    if (
      this.selection.pictureInPicture &&
      (!this.preview || this.preview.isDestroyed())
    ) {
      await this.syncLivePreview();
    }
    const capture = await this.ensureCaptureWindow();
    await this.renderLiveFrame();
    await capture.webContents.executeJavaScript(
      "window.threadlightCapture.sync()",
    );
    const image = await capture.webContents.capturePage({
      x: 0,
      y: 0,
      width: COMPUTER_CANVAS_WIDTH,
      height: COMPUTER_CANVAS_HEIGHT,
    });
    if (image.isEmpty()) {
      throw new Error(
        "The live computer share returned an empty frame. Check Screen Recording permission.",
      );
    }
    const normalized = image.resize({
      width: COMPUTER_CANVAS_WIDTH,
      height: COMPUTER_CANVAS_HEIGHT,
      quality: "best",
    });
    return normalized.toPNG();
  }

  private async ensureCaptureStreams(): Promise<void> {
    const inactive = await this.captureSession.inactiveKeys();
    if (!inactive.length) return;

    const sources = this.captureSession.activeSources.map(
      ({ width: _width, height: _height, ...source }) => source,
    );
    if (!sources.length) {
      throw new Error(
        "The shared capture stopped. Select the share targets again.",
      );
    }
    const activeSources = await this.captureSession.replace(sources);
    this.layout = layoutActiveSources(activeSources);
    if (this.selection.pictureInPicture) {
      await this.syncLivePreview(true);
    }
  }

  private resolveSelectedRecords(catalog: CaptureCatalog): CaptureRecord[] {
    return this.selectedTargets.map((target) => {
      const exact = catalog.records.get(target.id);
      if (exact) return exact;

      if (target.type === "application" && target.processId) {
        const application = catalog.records.get(
          `application:${target.processId}`,
        );
        if (application) return application;
      }
      if (target.type === "display" && target.displayId) {
        const display = catalog.records.get(`display:${target.displayId}`);
        if (display) return display;
      }
      if (target.type === "window" && target.processId) {
        const candidates = [...catalog.sourceRecords.values()].filter(
          (record) =>
            record.sourceType === "window" &&
            record.processId === target.processId,
        );
        const sameTitle = candidates.find(
          (record) => record.target.windowTitle === target.windowTitle,
        );
        if (sameTitle) return sameTitle;
        if (candidates.length === 1 && candidates[0]) return candidates[0];
      }
      throw new Error(
        `The shared target is no longer available: ${target.name}`,
      );
    });
  }

  private async renderLiveFrame(): Promise<void> {
    if (!this.layout) throw new Error("Shared content layout is unavailable");
    const capture = await this.ensureCaptureWindow();
    await capture.webContents.executeJavaScript(
      `window.threadlightCapture.render(${JSON.stringify(
        this.layout,
      )}, ${JSON.stringify(this.cursor ?? null)})`,
    );
  }

  private async startMediaStream(
    source: ActiveCaptureSource,
  ): Promise<ComputerCaptureStreamMetadata> {
    const capture = await this.ensureCaptureWindow();
    const desktopSource = await this.resolveDesktopSource(source);
    this.pendingDisplayRequest = {
      webContents: capture.webContents,
      source: desktopSource,
    };
    try {
      const result = (await capture.webContents.executeJavaScript(
        `window.threadlightCapture.start(${JSON.stringify(source.key)})`,
      )) as unknown;
      return requireStreamMetadata(result, source.name);
    } finally {
      this.pendingDisplayRequest = undefined;
    }
  }

  private async startPreviewStream(
    preview: WebContents,
    source: ActiveCaptureSource,
  ): Promise<ComputerCaptureStreamMetadata> {
    const capture = await this.ensureCaptureWindow();
    const offer = (await capture.webContents.executeJavaScript(
      `window.threadlightCapture.createPreviewOffer(${JSON.stringify(
        source.key,
      )})`,
    )) as unknown;
    requireSessionDescription(offer, "offer", source.name);
    const answer = (await preview.executeJavaScript(
      `window.threadlightPreview.acceptOffer(${JSON.stringify(
        source.key,
      )}, ${JSON.stringify(offer)})`,
    )) as unknown;
    requireSessionDescription(answer, "answer", source.name);
    await capture.webContents.executeJavaScript(
      `window.threadlightCapture.acceptPreviewAnswer(${JSON.stringify(
        source.key,
      )}, ${JSON.stringify(answer)})`,
    );
    const result = (await preview.executeJavaScript(
      `window.threadlightPreview.waitForStream(${JSON.stringify(source.key)})`,
    )) as unknown;
    return requireStreamMetadata(result, source.name);
  }

  private async resolveDesktopSource(
    source: ActiveCaptureSource,
  ): Promise<DesktopCapturerSource> {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const exact = sources.find(
      (candidate) => candidate.id === source.sourceId,
    );
    if (exact) return exact;

    const nativeWindowId = /^window:(\d+)$/.exec(source.key)?.[1];
    if (nativeWindowId) {
      const rebound = sources.find((candidate) =>
        candidate.id.startsWith(`window:${nativeWindowId}:`),
      );
      if (rebound) return rebound;
    }
    const displayId = /^display:(.+)$/.exec(source.key)?.[1];
    if (displayId) {
      const rebound = sources.find(
        (candidate) => candidate.display_id === displayId,
      );
      if (rebound) return rebound;
    }
    throw new Error(`The selected capture source disappeared: ${source.name}`);
  }

  private async stopMediaStreams(): Promise<void> {
    const capture = this.captureWindow;
    if (!capture || capture.isDestroyed()) return;
    await capture.webContents
      .executeJavaScript("window.threadlightCapture.stopAll()")
      .catch(() => undefined);
  }

  private async captureStatuses(): Promise<
    readonly ComputerCaptureStreamStatus[]
  > {
    const capture = this.captureWindow;
    if (!capture || capture.isDestroyed()) return [];
    const value = (await capture.webContents.executeJavaScript(
      "window.threadlightCapture.status()",
    )) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isCaptureStatus);
  }

  private async loadCatalog(force: boolean): Promise<CaptureCatalog> {
    if (
      this.catalog &&
      !force &&
      Date.now() - this.catalogLoadedAt < 5_000
    ) {
      return this.catalog;
    }
    const [sources, windows] = await Promise.all([
      desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      }),
      listMacOSWindows(),
    ]);
    if (sources.length === 0) {
      throw new Error(
        "No shareable screen content is available. Allow Threadlight to record the screen in System Settings, then restart Threadlight.",
      );
    }
    const records = new Map<string, CaptureRecord>();
    const sourceRecords = new Map<string, CaptureRecord>();
    const unusedWindows = [...windows];

    for (const source of sources) {
      if (source.id.startsWith("screen:")) {
        const display = screen
          .getAllDisplays()
          .find((candidate) => String(candidate.id) === source.display_id);
        if (!display) continue;
        const id = `display:${display.id}`;
        const target: ComputerShareTarget = {
          id,
          type: "display",
          name: display.label || source.name,
          displayId: String(display.id),
        };
        const record: CaptureRecord = {
          target,
          sourceId: source.id,
          sourceType: "screen",
          sourceIds: [source.id],
          applicationName: target.name,
          bounds: display.bounds,
        };
        records.set(id, record);
        sourceRecords.set(source.id, record);
        continue;
      }

      const matchIndex = bestWindowMatch(source, unusedWindows);
      if (matchIndex < 0) continue;
      const metadata = unusedWindows.splice(matchIndex, 1)[0];
      if (!metadata || metadata.processId === process.pid) continue;
      const id = `window:${metadata.windowId}`;
      const target: ComputerShareTarget = {
        id,
        type: "window",
        name: `${metadata.applicationName} — ${source.name}`,
        applicationName: metadata.applicationName,
        windowTitle: source.name,
        processId: metadata.processId,
      };
      const record: CaptureRecord = {
        target,
        sourceId: source.id,
        sourceType: "window",
        sourceIds: [source.id],
        applicationName: metadata.applicationName,
        processId: metadata.processId,
        bounds: metadata.bounds,
      };
      sourceRecords.set(source.id, record);
      if (metadata.layer === 0 && metadata.title) {
        records.set(id, record);
      }
    }

    const byApplication = new Map<number, CaptureRecord[]>();
    for (const record of sourceRecords.values()) {
      if (record.sourceType !== "window" || !record.processId) continue;
      const current = byApplication.get(record.processId) ?? [];
      current.push(record);
      byApplication.set(record.processId, current);
    }
    for (const [processId, applicationWindows] of byApplication) {
      const applicationName =
        applicationWindows[0]?.applicationName ?? `Process ${processId}`;
      const id = `application:${processId}`;
      records.set(id, {
        target: {
          id,
          type: "application",
          name: applicationName,
          applicationName,
          processId,
        },
        sourceType: "application",
        sourceIds: applicationWindows.flatMap((record) => record.sourceIds),
        applicationName,
        processId,
      });
    }

    const targets = [...records.values()]
      .map((record) => record.target)
      .sort(compareTargets);
    this.catalog = { records, sourceRecords, targets };
    this.catalogLoadedAt = Date.now();
    return this.catalog;
  }

  private state() {
    return {
      mode: this.selection.mode,
      targets: this.selectedTargets,
      pictureInPicture: this.selection.pictureInPicture,
      canvas: {
        width: COMPUTER_CANVAS_WIDTH,
        height: COMPUTER_CANVAS_HEIGHT,
      },
      inputMode: this.selection.inputMode,
      includeChildWindows: this.childWindowCaptureConfigured,
    };
  }

  private async ensureCaptureWindow(): Promise<BrowserWindow> {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) {
      return this.captureWindow;
    }
    const capture = new BrowserWindow({
      width: COMPUTER_CANVAS_WIDTH,
      height: COMPUTER_CANVAS_HEIGHT,
      show: false,
      frame: false,
      backgroundColor: "#171815",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    capture.webContents.session.setDisplayMediaRequestHandler(
      (request, callback) => {
        const pending = this.pendingDisplayRequest;
        if (
          !pending ||
          request.frame !== pending.webContents.mainFrame
        ) {
          callback({});
          return;
        }
        callback({ video: pending.source });
      },
    );
    capture.on("closed", () => {
      if (this.captureWindow === capture) this.captureWindow = undefined;
      if (this.pendingDisplayRequest?.webContents === capture.webContents) {
        this.pendingDisplayRequest = undefined;
      }
    });
    await capture.loadURL(COMPUTER_CAPTURE_URL);
    this.captureWindow = capture;
    return capture;
  }

  private async ensurePreview(): Promise<BrowserWindow> {
    if (this.preview && !this.preview.isDestroyed()) return this.preview;
    const previewSize = this.layout
      ? scaledComputerPreviewSize(this.layout, this.previewScale)
      : { width: 180, height: 120 };
    const minimumSize = this.layout
      ? scaledComputerPreviewSize(
          this.layout,
          COMPUTER_PREVIEW_MIN_SCALE,
        )
      : { width: 108, height: 72 };
    const maximumSize = this.layout
      ? scaledComputerPreviewSize(
          this.layout,
          COMPUTER_PREVIEW_MAX_SCALE,
        )
      : { width: 297, height: 198 };
    const preview = new BrowserWindow({
      width: previewSize.width,
      height: previewSize.height,
      minWidth: minimumSize.width,
      minHeight: minimumSize.height,
      maxWidth: maximumSize.width,
      maxHeight: maximumSize.height,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "Threadlight · Computer Use",
      ...COMPUTER_PREVIEW_WINDOW_APPEARANCE,
      webPreferences: {
        preload: resolve(
          import.meta.dirname,
          "../preload/computer-preview.cjs",
        ),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    preview.setHasShadow(false);
    if (process.platform === "darwin") preview.setVibrancy(null);
    preview.setAlwaysOnTop(true, "floating");
    preview.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    preview.on("closed", () => {
      if (this.preview !== preview) return;
      this.preview = undefined;
      void this.stopPreviewRelays();
      this.selection = {
        ...this.selection,
        pictureInPicture: false,
      };
      this.notifyShareChanged();
    });
    await preview.loadURL(COMPUTER_PREVIEW_URL);
    this.preview = preview;
    return preview;
  }

  private closePreview(): void {
    void this.stopPreviewRelays();
    const preview = this.preview;
    this.preview = undefined;
    this.previewDragOffset = undefined;
    if (preview && !preview.isDestroyed()) preview.destroy();
  }

  private async syncLivePreview(force = false): Promise<void> {
    if (!this.selection.pictureInPicture || !this.layout) return;
    const preview = await this.ensurePreview();
    const sources = this.captureSession.activeSources;
    const status = force
      ? []
      : await this.previewCaptureStatuses(preview.webContents);
    if (force || !captureStatusesMatchSources(status, sources)) {
      await preview.webContents.executeJavaScript(
        "window.threadlightPreview.stopAll()",
      );
      await this.stopPreviewRelays();
      try {
        for (const source of sources) {
          await this.startPreviewStream(preview.webContents, source);
        }
      } catch (error) {
        await this.stopPreviewRelays();
        await preview.webContents
          .executeJavaScript("window.threadlightPreview.stopAll()")
          .catch(() => undefined);
        throw error;
      }
    }
    this.resizePreview(preview, this.layout);
    await preview.webContents.executeJavaScript(
      `window.threadlightPreview.render(${JSON.stringify(this.layout)})`,
    );
    if (!preview.isVisible()) preview.showInactive();
  }

  private resizePreview(
    preview: BrowserWindow,
    layout: ComputerFrameLayout,
  ): void {
    const minimumSize = scaledComputerPreviewSize(
      layout,
      COMPUTER_PREVIEW_MIN_SCALE,
    );
    const maximumSize = scaledComputerPreviewSize(
      layout,
      COMPUTER_PREVIEW_MAX_SCALE,
    );
    const previewSize = scaledComputerPreviewSize(
      layout,
      this.previewScale,
    );
    preview.setMinimumSize(0, 0);
    preview.setMaximumSize(maximumSize.width, maximumSize.height);
    preview.setMinimumSize(minimumSize.width, minimumSize.height);

    const current = preview.getBounds();
    if (
      current.width !== previewSize.width ||
      current.height !== previewSize.height
    ) {
      const workArea = screen.getDisplayMatching(current).workArea;
      const centeredX = Math.round(
        current.x + (current.width - previewSize.width) / 2,
      );
      const centeredY = Math.round(
        current.y + (current.height - previewSize.height) / 2,
      );
      const maximumX = workArea.x + workArea.width - previewSize.width;
      const maximumY = workArea.y + workArea.height - previewSize.height;
      preview.setBounds(
        {
          x: Math.max(workArea.x, Math.min(maximumX, centeredX)),
          y: Math.max(workArea.y, Math.min(maximumY, centeredY)),
          width: previewSize.width,
          height: previewSize.height,
        },
        false,
      );
    }
    void preview.webContents
      .executeJavaScript(
        `document.documentElement.style.setProperty("--preview-scale", ${JSON.stringify(
          this.previewScale,
        )})`,
      )
      .catch(() => undefined);
  }

  private async stopPreviewRelays(): Promise<void> {
    const capture = this.captureWindow;
    if (!capture || capture.isDestroyed()) return;
    await capture.webContents
      .executeJavaScript("window.threadlightCapture.stopPreviewRelays()")
      .catch(() => undefined);
  }

  private async previewCaptureStatuses(
    webContents: WebContents,
  ): Promise<readonly ComputerCaptureStreamStatus[]> {
    const value = (await webContents.executeJavaScript(
      "window.threadlightPreview.status()",
    )) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isCaptureStatus);
  }

  private notifyShareChanged(): void {
    this.onShareChanged(this.shareSnapshot());
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function validateShareSelection(
  records: readonly CaptureRecord[],
  options: {
    mode: "applications" | "windows" | "display";
    inputMode: "virtual" | "system";
  },
): void {
  const expectedType =
    options.mode === "applications"
      ? "application"
      : options.mode === "windows"
        ? "window"
        : "display";
  if (records.some((record) => record.target.type !== expectedType)) {
    throw new Error(
      `All target ids must be ${expectedType} targets for ${options.mode} mode`,
    );
  }
  if (options.mode === "display" && records.length !== 1) {
    throw new Error("Display mode requires exactly one display target");
  }
  if (options.mode === "display" && options.inputMode === "virtual") {
    throw new Error(
      "Display capture has no target application for virtual input. Use system input only when physical cursor control is explicitly allowed.",
    );
  }
  if (
    options.inputMode === "virtual" &&
    records.some(
      (record) => record.sourceType !== "application" && !record.processId,
    )
  ) {
    throw new Error(
      "One or more selected windows cannot receive virtual input. Select an application target.",
    );
  }
}

function expandCaptureSources(
  records: readonly CaptureRecord[],
  catalog: CaptureCatalog,
): ActiveCaptureSource[] {
  const sources = new Map<string, ActiveCaptureSource>();
  for (const record of records) {
    const expanded =
      record.sourceType === "application"
        ? record.sourceIds.flatMap((sourceId) => {
            const source = catalog.sourceRecords.get(sourceId);
            return source ? [source] : [];
          })
        : [record];
    for (const source of expanded) {
      if (!source.sourceId || !source.bounds) continue;
      sources.set(source.target.id, {
        key: source.target.id,
        sourceId: source.sourceId,
        name: source.target.windowTitle ?? source.target.name,
        applicationName: source.applicationName,
        ...(source.processId === undefined
          ? {}
          : { processId: source.processId }),
        bounds: source.bounds,
      });
    }
  }
  return [...sources.values()];
}

function layoutActiveSources(
  sources: readonly (ActiveCaptureSource & ComputerCaptureStreamMetadata)[],
): ComputerFrameLayout {
  return layoutComputerSources(
    sources.map((source) => ({
      id: source.key,
      name: source.name,
      applicationName: source.applicationName,
      ...(source.processId === undefined
        ? {}
        : { processId: source.processId }),
      pixelWidth: source.width,
      pixelHeight: source.height,
      bounds: source.bounds,
    })),
  );
}

function parseConfigureParams(value: unknown): {
  runId: string;
  threadId: string;
  mode: "applications" | "windows" | "display";
  targetIds: readonly string[];
  pictureInPicture: boolean;
  inputMode: "virtual" | "system";
} {
  if (!isObject(value)) throw new Error("Invalid computer configure request");
  const owner = parseComputerOwner(value);
  if (
    value.mode !== "applications" &&
    value.mode !== "windows" &&
    value.mode !== "display"
  ) {
    throw new Error("Invalid computer share mode");
  }
  if (
    !Array.isArray(value.targetIds) ||
    value.targetIds.length === 0 ||
    value.targetIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("Invalid computer share target ids");
  }
  if (
    typeof value.pictureInPicture !== "boolean" ||
    (value.inputMode !== "virtual" && value.inputMode !== "system")
  ) {
    throw new Error("Invalid computer share options");
  }
  return {
    ...owner,
    mode: value.mode,
    targetIds: value.targetIds,
    pictureInPicture: value.pictureInPicture,
    inputMode: value.inputMode,
  };
}

function parseExecuteParams(value: unknown): {
  actions: readonly ComputerUseAction[];
  owner: ComputerSessionOwner;
} {
  if (!isObject(value) || !Array.isArray(value.actions)) {
    throw new Error("Invalid computer execute request");
  }
  return {
    actions: value.actions as ComputerUseAction[],
    owner: parseComputerOwner(value),
  };
}

function parseComputerOwner(value: unknown): ComputerSessionOwner {
  if (
    !isObject(value) ||
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.threadId !== "string" ||
    !value.threadId
  ) {
    throw new Error("Invalid computer task ownership");
  }
  return { runId: value.runId, threadId: value.threadId };
}

function isCaptureStatus(value: unknown): value is ComputerCaptureStreamStatus {
  return (
    isObject(value) &&
    typeof value.key === "string" &&
    typeof value.active === "boolean"
  );
}

function requireStreamMetadata(
  value: unknown,
  sourceName: string,
): ComputerCaptureStreamMetadata {
  if (
    !isObject(value) ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    throw new Error(`Could not start live capture for ${sourceName}`);
  }
  return { width: value.width, height: value.height };
}

function requireSessionDescription(
  value: unknown,
  expectedType: "offer" | "answer",
  sourceName: string,
): asserts value is { type: "offer" | "answer"; sdp: string } {
  if (
    !isObject(value) ||
    value.type !== expectedType ||
    typeof value.sdp !== "string" ||
    !value.sdp
  ) {
    throw new Error(`Could not relay the shared stream for ${sourceName}`);
  }
}

function bestWindowMatch(
  source: DesktopCapturerSource,
  windows: readonly WindowMetadata[],
): number {
  const windowId = /^window:(\d+):/.exec(source.id)?.[1];
  if (windowId) {
    const exactId = windows.findIndex(
      (window) => window.windowId === Number(windowId),
    );
    if (exactId >= 0) return exactId;
  }
  const exact = windows.findIndex((window) => window.title === source.name);
  if (exact >= 0) return exact;
  const normalizedSource = normalizeTitle(source.name);
  return windows.findIndex(
    (window) => normalizeTitle(window.title) === normalizedSource,
  );
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function compareTargets(
  left: ComputerShareTarget,
  right: ComputerShareTarget,
): number {
  const order = { application: 0, window: 1, display: 2 };
  return (
    order[left.type] - order[right.type] ||
    left.name.localeCompare(right.name)
  );
}

function listMacOSWindows(): Promise<readonly WindowMetadata[]> {
  if (process.platform !== "darwin") return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", WINDOW_CATALOG_SCRIPT],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new Error(
              "Threadlight could not enumerate shareable application windows. Check Screen Recording permission.",
            ),
          );
          return;
        }
        try {
          const value = JSON.parse(stdout) as unknown;
          if (!Array.isArray(value)) throw new Error("Invalid window catalog");
          resolve(value.filter(isWindowMetadata));
        } catch (parseError) {
          reject(
            new Error(
              `Could not read the macOS window catalog: ${String(parseError)}`,
            ),
          );
        }
      },
    );
  });
}

function isWindowMetadata(value: unknown): value is WindowMetadata {
  if (!isObject(value) || !isObject(value.bounds)) return false;
  return (
    typeof value.windowId === "number" &&
    typeof value.title === "string" &&
    typeof value.applicationName === "string" &&
    typeof value.processId === "number" &&
    typeof value.layer === "number" &&
    typeof value.bounds.x === "number" &&
    typeof value.bounds.y === "number" &&
    typeof value.bounds.width === "number" &&
    typeof value.bounds.height === "number" &&
    value.bounds.width > 0 &&
    value.bounds.height > 0
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const WINDOW_CATALOG_SCRIPT = String.raw`
function run() {
  ObjC.import("Cocoa");
  ObjC.import("CoreGraphics");
  const rows = ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo(17, 0),
  );
  const output = [];
  for (let index = 0; index < Number(rows.count); index += 1) {
    const window = ObjC.deepUnwrap(rows.objectAtIndex(index));
    const bounds = window.kCGWindowBounds;
    if (!bounds || bounds.Width <= 1 || bounds.Height <= 1) continue;
    output.push({
      windowId: window.kCGWindowNumber,
      title: window.kCGWindowName || "",
      applicationName: window.kCGWindowOwnerName,
      processId: window.kCGWindowOwnerPID,
      layer: window.kCGWindowLayer,
      bounds: {
        x: bounds.X,
        y: bounds.Y,
        width: bounds.Width,
        height: bounds.Height,
      },
    });
  }
  return JSON.stringify(output);
}
`;
