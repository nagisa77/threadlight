import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  BrowserMouseButton,
  BrowserSessionEvent,
  BrowserSessionInfo,
  HostBrowserClientMessage,
} from "@threadlight/protocol";
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Server,
  X,
} from "lucide-react";

import { defineMessageCatalog, useMessageCatalog } from "./i18n.js";

type BrowserCommand = Exclude<HostBrowserClientMessage, { type: "open" }>;

export interface BrowserAdapter {
  create(request: {
    projectId: string;
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<BrowserSessionInfo>;
  command(message: BrowserCommand): void;
  close(sessionId: string): Promise<void>;
  subscribe(listener: (event: BrowserSessionEvent) => void): () => void;
}

export function BrowserView({
  adapter,
  projectId,
  hidden,
  label,
  onSessionChange,
}: {
  adapter: BrowserAdapter;
  projectId: string;
  hidden: boolean;
  label: string;
  onSessionChange?(session: BrowserSessionInfo): void;
}) {
  const copy = useMessageCatalog(browserMessages);
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const keyboardInput = useRef<HTMLTextAreaElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<BrowserSessionInfo | undefined>(undefined);
  const addressFocusedRef = useRef(false);
  const onSessionChangeRef = useRef(onSessionChange);
  const pendingFrame = useRef<
    Extract<BrowserSessionEvent, { type: "frame" }> | undefined
  >(undefined);
  const drawing = useRef(false);
  const pointerMove = useRef<
    Extract<BrowserCommand, { type: "pointer" }> | undefined
  >(undefined);
  const pointerMoveFrame = useRef<number | undefined>(undefined);
  const [session, setSession] = useState<BrowserSessionInfo>();
  const [status, setStatus] = useState<"connecting" | "live" | "error">(
    "connecting",
  );
  const [error, setError] = useState<string>();
  const [address, setAddress] = useState("");
  const [hasFrame, setHasFrame] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dialog, setDialog] =
    useState<Extract<BrowserSessionEvent, { type: "dialog" }>>();
  const [promptText, setPromptText] = useState("");
  const [download, setDownload] =
    useState<Extract<BrowserSessionEvent, { type: "download" }>>();

  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  const updateSession = useCallback((next: BrowserSessionInfo) => {
    sessionRef.current = next;
    setSession(next);
    setStatus("live");
    if (!addressFocusedRef.current) setAddress(displayAddress(next.url));
    onSessionChangeRef.current?.(next);
  }, []);

  const drawPendingFrame = useCallback(async () => {
    if (drawing.current) return;
    drawing.current = true;
    try {
      while (pendingFrame.current) {
        const frame = pendingFrame.current;
        pendingFrame.current = undefined;
        try {
          const bitmap = await createImageBitmap(jpegBlob(frame.data));
          const element = canvas.current;
          if (element) {
            if (element.width !== frame.width) element.width = frame.width;
            if (element.height !== frame.height) element.height = frame.height;
            element.getContext("2d", { alpha: false })?.drawImage(bitmap, 0, 0);
            setHasFrame(true);
            setStatus("live");
          }
          bitmap.close();
        } finally {
          adapter.command({
            type: "frame-ack",
            sessionId: frame.sessionId,
            frameId: frame.frameId,
          });
        }
      }
    } catch (drawError) {
      setStatus("error");
      setError(errorMessage(drawError));
    } finally {
      drawing.current = false;
    }
  }, [adapter]);

  useEffect(() => {
    return adapter.subscribe((event) => {
      const current = sessionRef.current;
      const eventSessionId =
        event.type === "state" ? event.session.id : event.sessionId;
      if (!current || eventSessionId !== current.id) return;
      if (event.type === "state") {
        updateSession(event.session);
        return;
      }
      if (event.type === "frame") {
        pendingFrame.current = event;
        void drawPendingFrame();
        return;
      }
      if (event.type === "dialog") {
        setDialog(event);
        setPromptText(event.defaultValue);
        return;
      }
      if (event.type === "download") {
        setDownload(event);
        return;
      }
      if (event.type === "error") {
        setError(event.message);
        return;
      }
      setStatus("error");
      setError(event.reason ?? copy.connectionLost);
    });
  }, [adapter, copy.connectionLost, drawPendingFrame, updateSession]);

  useEffect(() => {
    let disposed = false;
    let createdId: string | undefined;
    setStatus("connecting");
    setError(undefined);
    setHasFrame(false);
    const rect = surface.current?.getBoundingClientRect();
    void adapter
      .create({
        projectId,
        width: Math.max(320, Math.round(rect?.width ?? 1280)),
        height: Math.max(240, Math.round(rect?.height ?? 800)),
        deviceScaleFactor: 1,
      })
      .then((created) => {
        createdId = created.id;
        if (disposed) {
          return adapter.close(created.id);
        }
        updateSession(created);
      })
      .catch((createError) => {
        if (disposed) return;
        setStatus("error");
        setError(errorMessage(createError));
      });
    return () => {
      disposed = true;
      sessionRef.current = undefined;
      pendingFrame.current = undefined;
      if (createdId) void adapter.close(createdId);
    };
  }, [adapter, projectId, retry]);

  useEffect(() => {
    const element = surface.current;
    if (!element || !session?.id) return;
    let animationFrame: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.round(entry?.contentRect.width ?? 0));
      const height = Math.max(240, Math.round(entry?.contentRect.height ?? 0));
      if (
        Math.abs(width - sessionRef.current!.viewport.width) < 2 &&
        Math.abs(height - sessionRef.current!.viewport.height) < 2
      ) {
        return;
      }
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        adapter.command({
          type: "resize",
          sessionId: session.id,
          width,
          height,
          deviceScaleFactor: 1,
        });
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    };
  }, [adapter, session?.id]);

  useEffect(() => {
    if (!hidden) keyboardInput.current?.focus({ preventScroll: true });
  }, [hidden]);

  function navigate(event: FormEvent) {
    event.preventDefault();
    navigateTo(address);
  }

  function navigateTo(value: string) {
    const current = sessionRef.current;
    if (!current) return;
    adapter.command({ type: "navigate", sessionId: current.id, url: value });
    keyboardInput.current?.focus({ preventScroll: true });
  }

  function browserCommand(type: "back" | "forward" | "reload" | "stop") {
    if (session) adapter.command({ type, sessionId: session.id });
  }

  function sendPointer(
    event: ReactPointerEvent<HTMLCanvasElement>,
    phase: "move" | "down" | "up",
  ) {
    if (!session) return;
    const point = browserPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      session,
    );
    const command: Extract<BrowserCommand, { type: "pointer" }> = {
      type: "pointer",
      sessionId: session.id,
      phase,
      ...point,
      button: mouseButton(event.button, phase),
      clickCount: Math.min(3, Math.max(1, event.detail || 1)),
      modifiers: eventModifiers(event),
    };
    if (phase === "move") {
      pointerMove.current = command;
      if (pointerMoveFrame.current === undefined) {
        pointerMoveFrame.current = requestAnimationFrame(() => {
          pointerMoveFrame.current = undefined;
          if (pointerMove.current) adapter.command(pointerMove.current);
          pointerMove.current = undefined;
        });
      }
      return;
    }
    adapter.command(command);
    if (phase === "down") {
      event.currentTarget.setPointerCapture(event.pointerId);
      keyboardInput.current?.focus({ preventScroll: true });
    }
  }

  function sendWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    if (!session) return;
    event.preventDefault();
    const point = browserPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      session,
    );
    adapter.command({
      type: "wheel",
      sessionId: session.id,
      ...point,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifiers: eventModifiers(event),
    });
  }

  function sendKey(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    phase: "down" | "up",
  ) {
    if (!session || event.nativeEvent.isComposing) return;
    if (
      phase === "down" &&
      browserShortcut(event, session, adapter, addressInput.current)
    ) {
      return;
    }
    if (
      !browserKeyProducesText(event, phase) &&
      !browserKeyRequestsPaste(event, phase)
    ) {
      event.preventDefault();
    }
    adapter.command({
      type: "key",
      sessionId: session.id,
      phase,
      key: event.key,
      code: event.code,
      modifiers: eventModifiers(event),
      repeat: event.repeat,
    });
  }

  const blank = !session || session.url === "about:blank";
  const secure = session?.url.startsWith("https:");

  return (
    <section
      ref={root}
      className="browser-view"
      aria-label={label}
      hidden={hidden}
    >
      <div className="browser-toolbar">
        <div className="browser-navigation" aria-label={copy.navigation}>
          <button
            type="button"
            className="browser-tool-button pressable"
            aria-label={copy.back}
            title={copy.back}
            disabled={!session?.canGoBack}
            onClick={() => browserCommand("back")}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="browser-tool-button pressable"
            aria-label={copy.forward}
            title={copy.forward}
            disabled={!session?.canGoForward}
            onClick={() => browserCommand("forward")}
          >
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="browser-tool-button pressable"
            aria-label={session?.loading ? copy.stop : copy.reload}
            title={session?.loading ? copy.stop : copy.reload}
            disabled={!session}
            onClick={() => browserCommand(session?.loading ? "stop" : "reload")}
          >
            {session?.loading ? <X size={15} /> : <RefreshCw size={15} />}
          </button>
        </div>
        <form className="browser-address-form" onSubmit={navigate}>
          {secure ? (
            <LockKeyhole size={13} aria-hidden="true" />
          ) : (
            <Globe2 size={14} aria-hidden="true" />
          )}
          <input
            ref={addressInput}
            value={address}
            aria-label={copy.address}
            placeholder={copy.addressPlaceholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              navigateTo(event.currentTarget.value);
            }}
            onFocus={(event) => {
              addressFocusedRef.current = true;
              event.currentTarget.select();
            }}
            onBlur={() => {
              addressFocusedRef.current = false;
              if (sessionRef.current) {
                setAddress(displayAddress(sessionRef.current.url));
              }
            }}
          />
          {session?.loading && (
            <LoaderCircle className="spin browser-address-spinner" size={13} />
          )}
        </form>
        <span className="browser-host-badge" title={copy.hostHint}>
          <Server size={13} />
          <span>{copy.host}</span>
        </span>
        <button
          type="button"
          className="browser-tool-button pressable"
          aria-label={copy.fullscreen}
          title={copy.fullscreen}
          onClick={() => void root.current?.requestFullscreen()}
        >
          <Maximize2 size={15} />
        </button>
      </div>
      {session?.loading && <span className="browser-load-line" />}
      <div ref={surface} className="browser-surface">
        <canvas
          ref={canvas}
          className={`browser-canvas${blank || !hasFrame ? " hidden" : ""}`}
          aria-label={copy.remotePage}
          onContextMenu={(event) => event.preventDefault()}
          onPointerMove={(event) => sendPointer(event, "move")}
          onPointerDown={(event) => sendPointer(event, "down")}
          onPointerUp={(event) => sendPointer(event, "up")}
          onWheel={sendWheel}
        />
        <textarea
          ref={keyboardInput}
          className="browser-keyboard-input"
          aria-label={copy.remoteKeyboard}
          defaultValue=""
          onInput={(event) => {
            if (event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            const current = sessionRef.current;
            if (current && text) {
              adapter.command({
                type: "insert-text",
                sessionId: current.id,
                text,
              });
            }
          }}
          onKeyDown={(event) => sendKey(event, "down")}
          onKeyUp={(event) => sendKey(event, "up")}
          onPaste={(event) => {
            event.preventDefault();
            const current = sessionRef.current;
            const text = event.clipboardData.getData("text/plain");
            if (current && text) {
              adapter.command({
                type: "insert-text",
                sessionId: current.id,
                text,
              });
            }
          }}
        />
        {blank && status !== "error" && (
          <div className="browser-empty-state">
            {status === "connecting" ? (
              <LoaderCircle className="spin" size={27} />
            ) : (
              <Globe2 size={32} strokeWidth={1.5} />
            )}
            <strong>
              {status === "connecting" ? copy.starting : copy.start}
            </strong>
            <span>
              {status === "connecting" ? copy.startingHint : copy.startHint}
            </span>
          </div>
        )}
        {status === "error" && (
          <div className="browser-error-state" role="alert">
            <Globe2 size={30} strokeWidth={1.5} />
            <strong>{copy.unavailable}</strong>
            <span>{error}</span>
            <button
              type="button"
              className="secondary pressable"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RotateCcw size={14} />
              {copy.retry}
            </button>
          </div>
        )}
        {dialog && (
          <div className="browser-dialog-backdrop">
            <div
              className="browser-dialog"
              role="alertdialog"
              aria-modal="true"
            >
              <strong>{copy.pageDialog}</strong>
              <p>{dialog.message}</p>
              {dialog.dialogType === "prompt" && (
                <input
                  autoFocus
                  value={promptText}
                  onChange={(event) => setPromptText(event.target.value)}
                />
              )}
              <div className="browser-dialog-actions">
                {dialog.dialogType !== "alert" && (
                  <button
                    type="button"
                    className="secondary pressable"
                    onClick={() => {
                      adapter.command({
                        type: "dialog",
                        sessionId: dialog.sessionId,
                        dialogId: dialog.dialogId,
                        accept: false,
                      });
                      setDialog(undefined);
                    }}
                  >
                    {copy.cancel}
                  </button>
                )}
                <button
                  type="button"
                  className="primary pressable"
                  onClick={() => {
                    adapter.command({
                      type: "dialog",
                      sessionId: dialog.sessionId,
                      dialogId: dialog.dialogId,
                      accept: true,
                      ...(dialog.dialogType === "prompt" ? { promptText } : {}),
                    });
                    setDialog(undefined);
                  }}
                >
                  {copy.confirm}
                </button>
              </div>
            </div>
          </div>
        )}
        {download && (
          <button
            type="button"
            className={`browser-download-toast ${download.status}`}
            title={download.path ?? download.error}
            onClick={() => setDownload(undefined)}
          >
            <span>
              {download.status === "started"
                ? copy.downloading
                : download.status === "completed"
                  ? copy.downloaded
                  : copy.downloadFailed}
            </span>
            <strong>{download.filename}</strong>
            <X size={13} />
          </button>
        )}
      </div>
    </section>
  );
}

function displayAddress(url: string): string {
  return url === "about:blank" ? "" : url;
}

function jpegBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "image/jpeg" });
}

function browserPoint(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  session: BrowserSessionInfo,
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x:
      ((clientX - rect.left) / Math.max(1, rect.width)) *
      session.viewport.width,
    y:
      ((clientY - rect.top) / Math.max(1, rect.height)) *
      session.viewport.height,
  };
}

function mouseButton(
  button: number,
  phase: "move" | "down" | "up",
): BrowserMouseButton {
  if (phase === "move") return "none";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function eventModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

export function browserKeyProducesText(
  event: {
    altKey: boolean;
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    getModifierState(key: string): boolean;
  },
  phase: "down" | "up",
): boolean {
  if (phase !== "down" || event.metaKey) return false;
  if (event.getModifierState("AltGraph")) return true;
  if (event.ctrlKey || event.altKey) return false;
  return (
    event.key.length === 1 || event.key === "Dead" || event.key === "Process"
  );
}

export function browserKeyRequestsPaste(
  event: {
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
  },
  phase: "down" | "up",
): boolean {
  if (phase !== "down") return false;
  return (
    ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") ||
    (event.shiftKey && event.key === "Insert")
  );
}

function browserShortcut(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  session: BrowserSessionInfo,
  adapter: BrowserAdapter,
  address: HTMLInputElement | null,
): boolean {
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "l") {
    event.preventDefault();
    address?.focus();
    address?.select();
    return true;
  }
  if ((command && event.key.toLowerCase() === "r") || event.key === "F5") {
    event.preventDefault();
    adapter.command({ type: "reload", sessionId: session.id });
    return true;
  }
  if (event.altKey && event.key === "ArrowLeft" && session.canGoBack) {
    event.preventDefault();
    adapter.command({ type: "back", sessionId: session.id });
    return true;
  }
  if (event.altKey && event.key === "ArrowRight" && session.canGoForward) {
    event.preventDefault();
    adapter.command({ type: "forward", sessionId: session.id });
    return true;
  }
  if (event.key === "Escape" && session.loading) {
    event.preventDefault();
    adapter.command({ type: "stop", sessionId: session.id });
    return true;
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const browserMessages = defineMessageCatalog({
  "zh-CN": {
    navigation: "浏览器导航",
    back: "后退",
    forward: "前进",
    reload: "重新加载",
    stop: "停止加载",
    address: "地址栏",
    addressPlaceholder: "输入 URL 或搜索内容",
    host: "Host",
    hostHint: "页面由目标 Threadlight Host 上的 Chrome 打开",
    fullscreen: "全屏浏览器",
    remotePage: "远端 Chrome 页面",
    remoteKeyboard: "远端 Chrome 键盘输入",
    starting: "正在启动浏览器",
    startingHint: "正在目标 Host 上启动无头 Chrome…",
    start: "开始浏览",
    startHint: "输入 URL 以打开页面",
    unavailable: "浏览器不可用",
    retry: "重试",
    connectionLost: "与目标 Host 的浏览器直播连接已断开。",
    pageDialog: "页面提示",
    cancel: "取消",
    confirm: "确定",
    downloading: "正在下载到 Host",
    downloaded: "已下载到 Host",
    downloadFailed: "下载失败",
  },
  "zh-TW": {
    navigation: "瀏覽器導覽",
    back: "上一頁",
    forward: "下一頁",
    reload: "重新載入",
    stop: "停止載入",
    address: "網址列",
    addressPlaceholder: "輸入 URL 或搜尋內容",
    host: "Host",
    hostHint: "頁面由目標 Threadlight Host 上的 Chrome 開啟",
    fullscreen: "全螢幕瀏覽器",
    remotePage: "遠端 Chrome 頁面",
    remoteKeyboard: "遠端 Chrome 鍵盤輸入",
    starting: "正在啟動瀏覽器",
    startingHint: "正在目標 Host 上啟動無頭 Chrome…",
    start: "開始瀏覽",
    startHint: "輸入 URL 以開啟頁面",
    unavailable: "瀏覽器無法使用",
    retry: "重試",
    connectionLost: "與目標 Host 的瀏覽器直播連線已中斷。",
    pageDialog: "頁面提示",
    cancel: "取消",
    confirm: "確定",
    downloading: "正在下載到 Host",
    downloaded: "已下載到 Host",
    downloadFailed: "下載失敗",
  },
  en: {
    navigation: "Browser navigation",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    stop: "Stop loading",
    address: "Address bar",
    addressPlaceholder: "Enter a URL or search",
    host: "Host",
    hostHint: "This page runs in Chrome on the target Threadlight Host",
    fullscreen: "Fullscreen browser",
    remotePage: "Remote Chrome page",
    remoteKeyboard: "Remote Chrome keyboard input",
    starting: "Starting browser",
    startingHint: "Starting headless Chrome on the target Host…",
    start: "Start browsing",
    startHint: "Enter a URL to open a page",
    unavailable: "Browser unavailable",
    retry: "Retry",
    connectionLost: "The browser stream from the target Host was disconnected.",
    pageDialog: "Page dialog",
    cancel: "Cancel",
    confirm: "OK",
    downloading: "Downloading on Host",
    downloaded: "Downloaded on Host",
    downloadFailed: "Download failed",
  },
  ja: {
    navigation: "ブラウザーナビゲーション",
    back: "戻る",
    forward: "進む",
    reload: "再読み込み",
    stop: "読み込みを停止",
    address: "アドレスバー",
    addressPlaceholder: "URL または検索語を入力",
    host: "Host",
    hostHint: "対象の Threadlight Host 上の Chrome でページを開きます",
    fullscreen: "ブラウザーを全画面表示",
    remotePage: "リモート Chrome ページ",
    remoteKeyboard: "リモート Chrome キーボード入力",
    starting: "ブラウザーを起動中",
    startingHint: "対象 Host でヘッドレス Chrome を起動しています…",
    start: "ブラウジングを開始",
    startHint: "URL を入力してページを開きます",
    unavailable: "ブラウザーを利用できません",
    retry: "再試行",
    connectionLost: "対象 Host からのブラウザー配信が切断されました。",
    pageDialog: "ページダイアログ",
    cancel: "キャンセル",
    confirm: "OK",
    downloading: "Host にダウンロード中",
    downloaded: "Host にダウンロード済み",
    downloadFailed: "ダウンロード失敗",
  },
  ko: {
    navigation: "브라우저 탐색",
    back: "뒤로",
    forward: "앞으로",
    reload: "새로고침",
    stop: "로딩 중지",
    address: "주소 표시줄",
    addressPlaceholder: "URL 또는 검색어 입력",
    host: "Host",
    hostHint: "대상 Threadlight Host의 Chrome에서 페이지를 엽니다",
    fullscreen: "브라우저 전체 화면",
    remotePage: "원격 Chrome 페이지",
    remoteKeyboard: "원격 Chrome 키보드 입력",
    starting: "브라우저 시작 중",
    startingHint: "대상 Host에서 헤드리스 Chrome을 시작하는 중…",
    start: "탐색 시작",
    startHint: "URL을 입력하여 페이지 열기",
    unavailable: "브라우저를 사용할 수 없음",
    retry: "다시 시도",
    connectionLost: "대상 Host의 브라우저 스트림 연결이 끊겼습니다.",
    pageDialog: "페이지 대화상자",
    cancel: "취소",
    confirm: "확인",
    downloading: "Host에 다운로드 중",
    downloaded: "Host에 다운로드됨",
    downloadFailed: "다운로드 실패",
  },
});
