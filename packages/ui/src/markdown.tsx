import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  Globe2,
  LoaderCircle,
  LocateFixed,
  X,
} from "lucide-react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  MessageCitationData,
  MessageSourceData,
} from "@threadlight/protocol";

import { useI18n, type Language } from "./i18n.js";
import { Dialog } from "./dialog.js";
import {
  anchoredPopoverPosition,
  observePopoverAnchor,
  type PopoverPosition,
} from "./popover.js";

export interface MarkdownContentProps {
  children: string;
  onOpenLocalFile?(reference: LocalFileReference): void;
  onRevealLocalFile?(reference: LocalFileReference): void | Promise<void>;
  sources?: readonly MessageSourceData[];
  citations?: readonly MessageCitationData[];
}

export interface LocalFileReference {
  path: string;
  line?: number;
  column?: number;
}

export interface WorkspaceFileReference {
  path: string;
  line?: number;
  column?: number;
}

export interface FileReaderReference extends WorkspaceFileReference {
  source: "workspace" | "system";
}

type SourceSurface =
  | {
      kind: "preview";
      citationId: string;
      openerId: string;
    }
  | {
      kind: "collection";
      activeCitationId?: string;
    };

const SOURCE_MOBILE_BREAKPOINT = 720;
const SOURCE_PREVIEW_WIDTH = 360;

interface MarkdownLinkContextValue {
  citationById: ReadonlyMap<string, MessageCitationData>;
  citationNamespace: string;
  labels: ReturnType<typeof sourceCopy>;
  onOpenLocalFile?: MarkdownContentProps["onOpenLocalFile"];
  onRevealLocalFile?: MarkdownContentProps["onRevealLocalFile"];
  openSources(citationId: string | undefined, opener: HTMLElement): void;
  previewSources(citationId: string, opener: HTMLElement): void;
  schedulePreviewClose(): void;
  sources: readonly MessageSourceData[];
}

const MarkdownLinkContext = createContext<MarkdownLinkContextValue | null>(
  null,
);
const MARKDOWN_COMPONENTS: Components = { a: MarkdownAnchor };

export function MarkdownContent({
  children,
  onOpenLocalFile,
  onRevealLocalFile,
  sources = [],
  citations = [],
}: MarkdownContentProps) {
  const { language } = useI18n();
  const labels = sourceCopy(language);
  const citationNamespace = useId().replaceAll(":", "");
  const lastSourceOpener = useRef<{
    element: HTMLElement;
    id?: string;
  } | null>(null);
  const previewCloseTimer = useRef<number | undefined>(undefined);
  const [sourceSurface, setSourceSurface] = useState<SourceSurface>();
  const citationById = new Map(
    citations.map((citation) => [citation.id, citation]),
  );

  useEffect(() => {
    if (sourceSurface?.kind !== "preview") return;
    const movePreviewToMobilePage = () => {
      if (sourceViewportWidth() > SOURCE_MOBILE_BREAKPOINT) return;
      setSourceSurface({
        kind: "collection",
        activeCitationId: sourceSurface.citationId,
      });
    };
    window.addEventListener("resize", movePreviewToMobilePage);
    window.visualViewport?.addEventListener("resize", movePreviewToMobilePage);
    return () => {
      window.removeEventListener("resize", movePreviewToMobilePage);
      window.visualViewport?.removeEventListener(
        "resize",
        movePreviewToMobilePage,
      );
    };
  }, [sourceSurface]);

  useEffect(
    () => () => {
      if (previewCloseTimer.current !== undefined) {
        window.clearTimeout(previewCloseTimer.current);
      }
    },
    [],
  );

  function cancelPreviewClose() {
    if (previewCloseTimer.current === undefined) return;
    window.clearTimeout(previewCloseTimer.current);
    previewCloseTimer.current = undefined;
  }

  function previewSources(citationId: string, opener: HTMLElement) {
    if (
      sourcePresentationKind(citationId, sourceViewportWidth()) !== "preview"
    ) {
      return;
    }
    cancelPreviewClose();
    rememberSourceOpener(opener);
    setSourceSurface({ kind: "preview", citationId, openerId: opener.id });
  }

  function schedulePreviewClose() {
    cancelPreviewClose();
    previewCloseTimer.current = window.setTimeout(() => {
      previewCloseTimer.current = undefined;
      setSourceSurface((current) =>
        current?.kind === "preview" ? undefined : current,
      );
    }, 140);
  }

  function closePreview() {
    cancelPreviewClose();
    setSourceSurface((current) =>
      current?.kind === "preview" ? undefined : current,
    );
  }

  function openSources(citationId: string | undefined, opener: HTMLElement) {
    cancelPreviewClose();
    rememberSourceOpener(opener);
    setSourceSurface(
      sourcePresentationKind(citationId, sourceViewportWidth()) === "preview"
        ? { kind: "preview", citationId: citationId!, openerId: opener.id }
        : {
            kind: "collection",
            ...(citationId ? { activeCitationId: citationId } : {}),
          },
    );
  }

  function closeSources() {
    setSourceSurface(undefined);
    requestAnimationFrame(() => {
      const remembered = lastSourceOpener.current;
      const current = remembered?.id
        ? document.getElementById(remembered.id)
        : remembered?.element;
      current?.focus();
    });
  }

  function rememberSourceOpener(opener: HTMLElement) {
    lastSourceOpener.current = {
      element: opener,
      ...(opener.id ? { id: opener.id } : {}),
    };
  }

  function locateCitation(citationId: string) {
    setSourceSurface(undefined);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const marker = document.getElementById(
          citationAnchorId(citationNamespace, citationId),
        );
        const target = marker?.closest("p, li, blockquote, td, th") ?? marker;
        if (!(target instanceof HTMLElement)) return;
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "center",
        });
        target.classList.add("source-citation-target");
        marker?.focus({ preventScroll: true });
        window.setTimeout(
          () => target.classList.remove("source-citation-target"),
          1_800,
        );
      });
    });
  }

  return (
    <div className="markdown-content">
      <MarkdownLinkContext.Provider
        value={{
          citationById,
          citationNamespace,
          labels,
          onOpenLocalFile,
          onRevealLocalFile,
          openSources,
          previewSources,
          schedulePreviewClose,
          sources,
        }}
      >
        <Markdown
          components={MARKDOWN_COMPONENTS}
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) =>
            url.startsWith("threadlight-source:")
              ? url
              : defaultUrlTransform(url)
          }
        >
          {children}
        </Markdown>
      </MarkdownLinkContext.Provider>
      {sources.length > 0 && citations.length > 0 ? (
        <button
          type="button"
          className="message-sources-trigger pressable"
          onClick={(event) => openSources(undefined, event.currentTarget)}
        >
          <BookOpen size={13} />
          {labels.sourceCount.replace("{count}", String(sources.length))}
        </button>
      ) : null}
      {sourceSurface?.kind === "preview" ? (
        <SourcePreviewPopover
          citation={citationById.get(sourceSurface.citationId)}
          sources={sources}
          openerId={sourceSurface.openerId}
          onKeepOpen={cancelPreviewClose}
          onRequestClose={schedulePreviewClose}
          onClose={closePreview}
        />
      ) : null}
      {sourceSurface?.kind === "collection"
        ? createPortal(
            <SourceCollection
              sources={sources}
              citations={citations}
              activeCitationId={sourceSurface.activeCitationId}
              onClose={closeSources}
              onLocate={locateCitation}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function MarkdownAnchor({
  href,
  node: _node,
  className,
  children: linkChildren,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const context = useContext(MarkdownLinkContext);
  if (!context) {
    throw new Error("Markdown links must be rendered inside MarkdownContent");
  }

  const {
    citationById,
    citationNamespace,
    labels,
    onOpenLocalFile,
    onRevealLocalFile,
    openSources,
    previewSources,
    schedulePreviewClose,
    sources,
  } = context;
  const citationId = parseSourceCitationHref(href);
  const citation = citationId ? citationById.get(citationId) : undefined;
  if (citation) {
    const citationSources = sourcesForCitation(citation, sources);
    const primarySource = citationSources[0];
    return (
      <button
        type="button"
        id={citationAnchorId(citationNamespace, citation.id)}
        className="source-citation-marker pressable"
        aria-label={labels.openCitation.replace(
          "{number}",
          String(linkChildren),
        )}
        onPointerEnter={(event) =>
          previewSources(citation.id, event.currentTarget)
        }
        onPointerLeave={schedulePreviewClose}
        onFocus={(event) => previewSources(citation.id, event.currentTarget)}
        onBlur={schedulePreviewClose}
        onClick={(event) => openSources(citation.id, event.currentTarget)}
      >
        {primarySource ? (
          <>
            <SourceIcon source={primarySource} size={12} />
            <span>{sourceDisplayName(primarySource)}</span>
            {citationSources.length > 1 ? (
              <span className="source-citation-more">
                +{citationSources.length - 1}
              </span>
            ) : null}
          </>
        ) : (
          linkChildren
        )}
      </button>
    );
  }

  const localFile = parseLocalFileReference(href);
  if (localFile && onOpenLocalFile) {
    return (
      <LocalFileLink
        href={href}
        {...props}
        className={["local-file-link", className].filter(Boolean).join(" ")}
        reference={localFile}
        onOpen={onOpenLocalFile}
        onReveal={onRevealLocalFile}
      >
        {linkChildren}
      </LocalFileLink>
    );
  }

  if (!isWebUrl(href)) {
    return (
      <a href={href} className={className} {...props}>
        {linkChildren}
      </a>
    );
  }

  return (
    <a
      href={href}
      {...props}
      className={className}
      target="_blank"
      rel="noreferrer noopener"
    >
      {linkChildren}
    </a>
  );
}

function SourcePreviewPopover({
  citation,
  sources,
  openerId,
  onKeepOpen,
  onRequestClose,
  onClose,
}: {
  citation: MessageCitationData | undefined;
  sources: readonly MessageSourceData[];
  openerId: string;
  onKeepOpen(): void;
  onRequestClose(): void;
  onClose(): void;
}) {
  const { language } = useI18n();
  const labels = sourceCopy(language);
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const previewSources = citation ? sourcesForCitation(citation, sources) : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<PopoverPosition>();
  const activeSource = previewSources[activeIndex] ?? previewSources[0];

  useEffect(() => {
    if (previewSources.length === 0) {
      onCloseRef.current();
      return;
    }
    const reposition = () => {
      const opener = document.getElementById(openerId);
      if (!opener) {
        onCloseRef.current();
        return;
      }
      const bounds = opener.getBoundingClientRect();
      const viewportWidth = sourceViewportWidth();
      const width = Math.min(SOURCE_PREVIEW_WIDTH, viewportWidth - 24);
      setPosition(
        anchoredPopoverPosition(bounds, {
          width,
          height:
            root.current?.offsetHeight ??
            (previewSources.length > 1 ? 166 : 118),
          viewportWidth,
          viewportHeight: sourceViewportHeight(),
          gap: 10,
          margin: 12,
          align: "start",
        }),
      );
    };
    return observePopoverAnchor(reposition);
  }, [openerId, previewSources.length]);

  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent) {
      const opener = document.getElementById(openerId);
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !opener?.contains(event.target)
      ) {
        onCloseRef.current();
      }
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCloseRef.current();
    }
    window.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [openerId]);

  if (!activeSource) return null;

  const popover = (
    <div
      ref={root}
      className={`source-preview ${previewSources.length > 1 ? "multiple" : "single"}`}
      data-dialog-portal=""
      role="dialog"
      aria-labelledby={titleId}
      style={
        {
          top: position?.top,
          bottom: position?.bottom,
          left: position?.left,
          width: `min(${SOURCE_PREVIEW_WIDTH}px, calc(100vw - 24px))`,
          transformOrigin: position?.transformOrigin,
          visibility: position ? "visible" : "hidden",
        } satisfies CSSProperties
      }
      onPointerEnter={onKeepOpen}
      onPointerLeave={onRequestClose}
      onFocusCapture={onKeepOpen}
      onBlurCapture={onRequestClose}
    >
      {previewSources.length > 1 ? (
        <div className="source-preview-pagination">
          <div>
            <button
              type="button"
              className="source-preview-nav pressable"
              aria-label={labels.previousSource}
              onClick={() =>
                setActiveIndex(
                  (activeIndex - 1 + previewSources.length) %
                    previewSources.length,
                )
              }
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              className="source-preview-nav pressable"
              aria-label={labels.nextSource}
              onClick={() =>
                setActiveIndex((activeIndex + 1) % previewSources.length)
              }
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <span>
            {activeIndex + 1}/{previewSources.length}
          </span>
        </div>
      ) : null}
      <a
        className="source-preview-link pressable"
        href={activeSource.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        <span className="source-preview-domain">
          <SourceIcon source={activeSource} size={15} />
          <span>{sourceDisplayName(activeSource)}</span>
          <ExternalLink className="source-preview-external" size={14} />
        </span>
        <strong id={titleId}>{activeSource.title}</strong>
        {activeSource.description ? (
          <small>{activeSource.description}</small>
        ) : null}
      </a>
    </div>
  );

  return createPortal(popover, document.body);
}

function SourceCollection({
  sources,
  citations,
  activeCitationId,
  onClose,
  onLocate,
}: {
  sources: readonly MessageSourceData[];
  citations: readonly MessageCitationData[];
  activeCitationId?: string;
  onClose(): void;
  onLocate(citationId: string): void;
}) {
  const { language } = useI18n();
  const labels = sourceCopy(language);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const activeCitation = citations.find(
    (citation) => citation.id === activeCitationId,
  );
  const orderedSources = [...sources].sort((left, right) => {
    const leftActive = activeCitation?.sourceIds.includes(left.id) ? 0 : 1;
    const rightActive = activeCitation?.sourceIds.includes(right.id) ? 0 : 1;
    return leftActive - rightActive;
  });

  return (
    <Dialog
      as="aside"
      backdropClassName="source-drawer-backdrop"
      className="source-collection"
      aria-labelledby={titleId}
      initialFocusRef={closeButton}
      onClose={onClose}
    >
      <header className="source-collection-header">
        <div>
          <h2 id={titleId}>{labels.sources}</h2>
          <p>
            {labels.drawerSubtitle.replace("{count}", String(sources.length))}
          </p>
        </div>
        <button
          ref={closeButton}
          type="button"
          className="source-collection-close pressable"
          aria-label={labels.close}
          title={labels.close}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="source-collection-list">
        {orderedSources.map((source, index) => {
          const sourceCitations = citations.filter((citation) =>
            citation.sourceIds.includes(source.id),
          );
          const preferredCitation =
            sourceCitations.find(
              (citation) => citation.id === activeCitationId,
            ) ?? sourceCitations[0];
          const active = activeCitation?.sourceIds.includes(source.id);
          return (
            <article
              key={source.id}
              className={`source-card ${active ? "active" : ""} ${
                !activeCitation && index === 0 ? "featured" : ""
              }`}
            >
              <div className="source-card-domain">
                <SourceIcon source={source} size={17} />
                <span>{sourceDisplayName(source)}</span>
                <button
                  type="button"
                  className="source-card-locate pressable"
                  aria-label={labels.locate}
                  title={labels.locate}
                  disabled={!preferredCitation}
                  onClick={() =>
                    preferredCitation && onLocate(preferredCitation.id)
                  }
                >
                  <LocateFixed size={14} />
                </button>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${labels.openPage}: ${source.title}`}
                  title={labels.openPage}
                >
                  <ExternalLink size={13} />
                </a>
              </div>
              <a
                className="source-card-title pressable"
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <strong>{source.title}</strong>
                {source.description ? <span>{source.description}</span> : null}
              </a>
            </article>
          );
        })}
      </div>
    </Dialog>
  );
}

function SourceIcon({
  source,
  size,
}: {
  source: MessageSourceData;
  size: number;
}) {
  const favicon = sourceFaviconUrl(source.url);
  return (
    <span
      className="source-site-icon"
      style={{ "--source-icon-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <Globe2 size={size} />
      {favicon ? (
        <img
          src={favicon}
          alt=""
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => event.currentTarget.remove()}
        />
      ) : null}
    </span>
  );
}

export function sourcePresentationKind(
  citationId: string | undefined,
  viewportWidth: number,
): "preview" | "collection" {
  return citationId && viewportWidth > SOURCE_MOBILE_BREAKPOINT
    ? "preview"
    : "collection";
}

export function sourcesForCitation(
  citation: MessageCitationData,
  sources: readonly MessageSourceData[],
): MessageSourceData[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return citation.sourceIds.flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
}

export function sourceDisplayName(source: MessageSourceData): string {
  const domain = source.domain.toLowerCase().replace(/^www\./, "");
  if (domain === "github.com" || domain.endsWith(".github.com"))
    return "GitHub";
  if (domain === "deepseek.com" || domain.endsWith(".deepseek.com")) {
    return "DeepSeek";
  }
  const stem = domain.split(".")[0];
  return stem && !domain.includes("localhost")
    ? `${stem[0]?.toUpperCase() ?? ""}${stem.slice(1)}`
    : source.domain;
}

export function sourceFaviconUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? new URL("/favicon.ico", parsed.origin).href
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceViewportWidth(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  return window.visualViewport?.width ?? window.innerWidth;
}

function sourceViewportHeight(): number {
  if (typeof window === "undefined") return 800;
  return window.visualViewport?.height ?? window.innerHeight;
}

function parseSourceCitationHref(href: string | undefined): string | undefined {
  if (!href?.startsWith("threadlight-source:")) return;
  const id = href.slice("threadlight-source:".length);
  return /^citation-\d+$/.test(id) ? id : undefined;
}

function citationAnchorId(namespace: string, citationId: string): string {
  return `source-${namespace}-${citationId}`;
}

function sourceCopy(language: Language) {
  return {
    "zh-CN": {
      sources: "来源",
      sourceCount: "{count} 个来源",
      drawerSubtitle: "共 {count} 个网页来源",
      openCitation: "查看引用 {number}",
      openPage: "打开原网页",
      locate: "定位到对应原句",
      supports: "支持 {count} 处内容",
      close: "关闭来源",
      previousSource: "上一个来源",
      nextSource: "下一个来源",
    },
    "zh-TW": {
      sources: "來源",
      sourceCount: "{count} 個來源",
      drawerSubtitle: "共 {count} 個網頁來源",
      openCitation: "查看引用 {number}",
      openPage: "開啟原網頁",
      locate: "定位到對應原句",
      supports: "支援 {count} 處內容",
      close: "關閉來源",
      previousSource: "上一個來源",
      nextSource: "下一個來源",
    },
    en: {
      sources: "Sources",
      sourceCount: "{count} sources",
      drawerSubtitle: "{count} web sources",
      openCitation: "View citation {number}",
      openPage: "Open original page",
      locate: "Locate cited sentence",
      supports: "Supports {count} passages",
      close: "Close sources",
      previousSource: "Previous source",
      nextSource: "Next source",
    },
    ja: {
      sources: "出典",
      sourceCount: "{count} 件の出典",
      drawerSubtitle: "ウェブ出典 {count} 件",
      openCitation: "引用 {number} を表示",
      openPage: "元のページを開く",
      locate: "引用文へ移動",
      supports: "{count} 箇所を裏付け",
      close: "出典を閉じる",
      previousSource: "前の出典",
      nextSource: "次の出典",
    },
    ko: {
      sources: "출처",
      sourceCount: "출처 {count}개",
      drawerSubtitle: "웹 출처 {count}개",
      openCitation: "인용 {number} 보기",
      openPage: "원본 페이지 열기",
      locate: "인용 문장으로 이동",
      supports: "{count}개 문단 지원",
      close: "출처 닫기",
      previousSource: "이전 출처",
      nextSource: "다음 출처",
    },
  }[language];
}

interface ContextMenuPosition {
  left: number;
  top: number;
  originX: "left" | "right";
  originY: "top" | "bottom";
}

const LOCAL_FILE_MENU_WIDTH = 208;
const LOCAL_FILE_MENU_HEIGHT = 122;
const LOCAL_FILE_MENU_MARGIN = 8;

export function localFileContextMenuPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): ContextMenuPosition {
  const availableWidth = Math.max(
    0,
    viewportWidth - LOCAL_FILE_MENU_MARGIN * 2,
  );
  const availableHeight = Math.max(
    0,
    viewportHeight - LOCAL_FILE_MENU_MARGIN * 2,
  );
  const width = Math.min(LOCAL_FILE_MENU_WIDTH, availableWidth);
  const height = Math.min(LOCAL_FILE_MENU_HEIGHT, availableHeight);
  const left = Math.max(
    LOCAL_FILE_MENU_MARGIN,
    Math.min(x, viewportWidth - width - LOCAL_FILE_MENU_MARGIN),
  );
  const top = Math.max(
    LOCAL_FILE_MENU_MARGIN,
    Math.min(y, viewportHeight - height - LOCAL_FILE_MENU_MARGIN),
  );
  return {
    left,
    top,
    originX: x > left + width / 2 ? "right" : "left",
    originY: y > top + height / 2 ? "bottom" : "top",
  };
}

function LocalFileLink({
  reference,
  onOpen,
  onReveal,
  children,
  ...props
}: Omit<React.ComponentPropsWithoutRef<"a">, "onClick" | "onContextMenu"> & {
  reference: LocalFileReference;
  onOpen(reference: LocalFileReference): void;
  onReveal?(reference: LocalFileReference): void | Promise<void>;
}) {
  const { t } = useI18n();
  const menuId = useId();
  const link = useRef<HTMLAnchorElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState<ContextMenuPosition>();
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!position) return;
    const focusFrame = requestAnimationFrame(() => items.current[0]?.focus());
    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || link.current?.contains(target))
        return;
      setPosition(undefined);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPosition(undefined);
      link.current?.focus();
    };
    const close = () => setPosition(undefined);
    window.addEventListener("pointerdown", closeFromPointer);
    window.addEventListener("keydown", closeFromKeyboard);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", close, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeFromPointer);
      window.removeEventListener("keydown", closeFromKeyboard);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [position]);

  function openMenu(x: number, y: number) {
    if (!onReveal) return;
    setError(undefined);
    setPosition(
      localFileContextMenuPosition(x, y, window.innerWidth, window.innerHeight),
    );
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (!onReveal) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.clientX, event.clientY);
  }

  function handleLinkKeyDown(event: ReactKeyboardEvent<HTMLAnchorElement>) {
    if (
      !onReveal ||
      (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
    ) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openMenu(bounds.left + Math.min(20, bounds.width / 2), bounds.bottom);
  }

  function handleMenuKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % 2;
    if (event.key === "ArrowUp") nextIndex = (index + 1) % 2;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    items.current[nextIndex]?.focus();
  }

  async function revealInFinder() {
    if (!onReveal || revealing) return;
    setRevealing(true);
    setError(undefined);
    try {
      await onReveal(reference);
      setPosition(undefined);
    } catch (reason) {
      setError(
        t("revealFileFailed", {
          message: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    } finally {
      setRevealing(false);
    }
  }

  const menuStyle = position
    ? ({
        left: position.left,
        top: position.top,
        "--context-menu-origin-x": position.originX,
        "--context-menu-origin-y": position.originY,
      } as CSSProperties)
    : undefined;

  return (
    <>
      <a
        ref={link}
        {...props}
        title={localFileTitle(reference)}
        aria-haspopup={onReveal ? "menu" : undefined}
        aria-expanded={onReveal ? Boolean(position) : undefined}
        aria-controls={position ? menuId : undefined}
        onClick={(event) => {
          event.preventDefault();
          setPosition(undefined);
          onOpen(reference);
        }}
        onContextMenu={handleContextMenu}
        onKeyDown={handleLinkKeyDown}
      >
        <FileCode2 size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>{children}</span>
        {reference.line && (
          <span className="local-file-link-line">(line {reference.line})</span>
        )}
      </a>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            className="local-file-context-menu"
            role="menu"
            aria-label={t("fileActions")}
            style={menuStyle}
          >
            <button
              ref={(element) => {
                items.current[0] = element;
              }}
              type="button"
              className="local-file-context-option pressable"
              role="menuitem"
              onClick={() => {
                setPosition(undefined);
                onOpen(reference);
              }}
              onKeyDown={(event) => handleMenuKeyDown(event, 0)}
            >
              <Eye size={16} aria-hidden="true" />
              <span>{t("previewInThreadlight")}</span>
            </button>
            <button
              ref={(element) => {
                items.current[1] = element;
              }}
              type="button"
              className="local-file-context-option pressable"
              role="menuitem"
              disabled={revealing}
              onClick={() => void revealInFinder()}
              onKeyDown={(event) => handleMenuKeyDown(event, 1)}
            >
              {revealing ? (
                <LoaderCircle className="spin" size={16} aria-hidden="true" />
              ) : (
                <FolderOpen size={16} aria-hidden="true" />
              )}
              <span>{t("revealInFinder")}</span>
            </button>
            {error && (
              <p className="local-file-context-error" role="status">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function parseLocalFileReference(
  value: string | undefined,
): LocalFileReference | undefined {
  if (!value) return undefined;
  let path = value.trim();
  if (!path) return undefined;

  if (path.startsWith("file://")) {
    try {
      const url = new URL(path);
      if (url.protocol !== "file:") return undefined;
      path = url.pathname;
    } catch {
      return undefined;
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !isWindowsPath(path)) {
    return undefined;
  }

  let line: number | undefined;
  let column: number | undefined;
  const fragment = path.match(/#L([1-9]\d*)(?:C([1-9]\d*))?$/i);
  if (fragment) {
    line = Number(fragment[1]);
    column = fragment[2] ? Number(fragment[2]) : undefined;
    path = path.slice(0, -fragment[0].length);
  } else {
    const suffix = path.match(/:([1-9]\d*)(?::([1-9]\d*))?$/);
    if (suffix) {
      line = Number(suffix[1]);
      column = suffix[2] ? Number(suffix[2]) : undefined;
      path = path.slice(0, -suffix[0].length);
    }
  }

  try {
    path = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (!looksLikeLocalPath(path)) return undefined;

  return {
    path,
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
  };
}

export function workspaceFileReference(
  reference: LocalFileReference,
  workspaceRoot: string,
): WorkspaceFileReference | undefined {
  const root = normalizePath(workspaceRoot).replace(/\/+$/, "");
  const path = normalizePath(reference.path);
  const comparisonRoot = isWindowsPath(root) ? root.toLocaleLowerCase() : root;
  const comparisonPath = isWindowsPath(path) ? path.toLocaleLowerCase() : path;
  let relativePath: string;

  if (isAbsolutePath(path)) {
    if (!comparisonPath.startsWith(`${comparisonRoot}/`)) return undefined;
    relativePath = path.slice(root.length + 1);
  } else {
    relativePath = path.replace(/^\.\//, "");
  }

  const segments = relativePath.split("/");
  if (
    !relativePath ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return undefined;
  }

  return {
    path: relativePath,
    ...(reference.line ? { line: reference.line } : {}),
    ...(reference.column ? { column: reference.column } : {}),
  };
}

export function fileReaderReference(
  reference: LocalFileReference,
  workspaceRoot: string,
): FileReaderReference | undefined {
  const root = normalizeAbsolutePath(workspaceRoot);
  if (!root) return undefined;
  const input = normalizePath(reference.path);
  const absolutePath = isAbsolutePath(input)
    ? normalizeAbsolutePath(input)
    : normalizeAbsolutePath(`${root}/${input}`);
  if (!absolutePath) return undefined;

  const windows = isWindowsPath(root);
  const comparisonRoot = windows ? root.toLocaleLowerCase() : root;
  const comparisonPath = windows
    ? absolutePath.toLocaleLowerCase()
    : absolutePath;
  const rootPrefix = comparisonRoot.endsWith("/")
    ? comparisonRoot
    : `${comparisonRoot}/`;
  const insideWorkspace =
    comparisonPath !== comparisonRoot && comparisonPath.startsWith(rootPrefix);

  return {
    source: insideWorkspace ? "workspace" : "system",
    path: insideWorkspace
      ? absolutePath.slice(root.endsWith("/") ? root.length : root.length + 1)
      : absolutePath,
    ...(reference.line ? { line: reference.line } : {}),
    ...(reference.column ? { column: reference.column } : {}),
  };
}

function isWebUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeLocalPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("./") ||
    path.startsWith("../") ||
    isWindowsPath(path) ||
    /^[^?#]+[/\\][^?#]+$/.test(path) ||
    /^[^/?#]+\.[a-z\d]+$/i.test(path)
  );
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsPath(path);
}

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeAbsolutePath(path: string): string | undefined {
  const normalized = normalizePath(path);
  const windows = isWindowsPath(normalized);
  if (!windows && !normalized.startsWith("/")) return undefined;
  const prefix = windows ? `${normalized.slice(0, 2)}/` : "/";
  const rest = windows ? normalized.slice(3) : normalized.slice(1);
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const result = `${prefix}${segments.join("/")}`;
  return result.length > prefix.length ? result.replace(/\/+$/, "") : result;
}

function localFileTitle(reference: LocalFileReference): string {
  const position = reference.line
    ? `:${reference.line}${reference.column ? `:${reference.column}` : ""}`
    : "";
  return `${reference.path}${position}`;
}
