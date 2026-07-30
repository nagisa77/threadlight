import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  LoaderCircle,
  LocateFixed,
  X,
} from "lucide-react";
import Markdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  MessageCitationData,
  MessageSourceData,
} from "@threadlight/protocol";

import { useI18n, type Language } from "./i18n.js";

export interface MarkdownContentProps {
  children: string;
  onOpenLocalFile?(reference: LocalFileReference): void;
  onRevealLocalFile?(
    reference: LocalFileReference,
  ): void | Promise<void>;
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
  const sourceTrigger = useRef<HTMLButtonElement>(null);
  const lastSourceOpener = useRef<HTMLElement | null>(null);
  const [sourceDrawer, setSourceDrawer] = useState<{
    citationId?: string;
  }>();
  const citationById = new Map(
    citations.map((citation) => [citation.id, citation]),
  );

  function openSources(citationId: string | undefined, opener: HTMLElement) {
    lastSourceOpener.current = opener;
    setSourceDrawer(citationId ? { citationId } : {});
  }

  function closeSources() {
    setSourceDrawer(undefined);
    requestAnimationFrame(() => lastSourceOpener.current?.focus());
  }

  function locateCitation(citationId: string) {
    setSourceDrawer(undefined);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const marker = document.getElementById(
          citationAnchorId(citationNamespace, citationId),
        );
        const target =
          marker?.closest("p, li, blockquote, td, th") ?? marker;
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

  const components: Components = {
    a({ href, node: _node, className, children: linkChildren, ...props }) {
      const citationId = parseSourceCitationHref(href);
      const citation = citationId
        ? citationById.get(citationId)
        : undefined;
      if (citation) {
        return (
          <button
            type="button"
            id={citationAnchorId(citationNamespace, citation.id)}
            className="source-citation-marker pressable"
            aria-label={labels.openCitation.replace(
              "{number}",
              String(linkChildren),
            )}
            onClick={(event) =>
              openSources(citation.id, event.currentTarget)
            }
          >
            {linkChildren}
          </button>
        );
      }
      const localFile = parseLocalFileReference(href);
      if (localFile && onOpenLocalFile) {
        return (
          <LocalFileLink
            href={href}
            {...props}
            className={["local-file-link", className]
              .filter(Boolean)
              .join(" ")}
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
    },
  };

  return (
    <div className="markdown-content">
      <Markdown
        components={components}
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          url.startsWith("threadlight-source:")
            ? url
            : defaultUrlTransform(url)
        }
      >
        {children}
      </Markdown>
      {sources.length > 0 && citations.length > 0 ? (
        <button
          ref={sourceTrigger}
          type="button"
          className="message-sources-trigger pressable"
          onClick={(event) => openSources(undefined, event.currentTarget)}
        >
          <BookOpen size={13} />
          {labels.sourceCount.replace(
            "{count}",
            String(sources.length),
          )}
        </button>
      ) : null}
      {sourceDrawer
        ? createPortal(
            <SourceDrawer
              sources={sources}
              citations={citations}
              activeCitationId={sourceDrawer.citationId}
              onClose={closeSources}
              onLocate={locateCitation}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function SourceDrawer({
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
  const drawer = useRef<HTMLElement>(null);
  const titleId = useId();
  const activeCitation = citations.find(
    (citation) => citation.id === activeCitationId,
  );
  const orderedSources = [...sources].sort((left, right) => {
    const leftActive = activeCitation?.sourceIds.includes(left.id) ? 0 : 1;
    const rightActive = activeCitation?.sourceIds.includes(right.id) ? 0 : 1;
    return leftActive - rightActive;
  });

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="source-drawer-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawer}
        className="source-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = [
            ...(drawer.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
            ) ?? []),
          ];
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="source-drawer-header">
          <div>
            <h2 id={titleId}>{labels.sources}</h2>
            <p>
              {labels.drawerSubtitle.replace(
                "{count}",
                String(sources.length),
              )}
            </p>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="source-drawer-close pressable"
            aria-label={labels.close}
            title={labels.close}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="source-drawer-list">
          {orderedSources.map((source) => {
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
                className={`source-card ${active ? "active" : ""}`}
              >
                <div className="source-card-domain">
                  <span className="source-card-number">
                    {sourceNumber(source, sources)}
                  </span>
                  <span>{source.domain}</span>
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
                <button
                  type="button"
                  className="source-card-title pressable"
                  onClick={() =>
                    preferredCitation &&
                    onLocate(preferredCitation.id)
                  }
                >
                  <strong>{source.title}</strong>
                  {source.description ? (
                    <span>{source.description}</span>
                  ) : null}
                  <small>
                    <LocateFixed size={12} />
                    {labels.locate}
                  </small>
                </button>
                {sourceCitations.length > 1 ? (
                  <div className="source-card-citations">
                    <p>
                      {labels.supports.replace(
                        "{count}",
                        String(sourceCitations.length),
                      )}
                    </p>
                    {sourceCitations.map((citation) => (
                      <button
                        key={citation.id}
                        type="button"
                        className={`source-card-excerpt pressable ${
                          citation.id === activeCitationId ? "active" : ""
                        }`}
                        onClick={() => onLocate(citation.id)}
                      >
                        “{citation.excerpt}”
                      </button>
                    ))}
                  </div>
                ) : preferredCitation?.excerpt ? (
                  <button
                    type="button"
                    className="source-card-excerpt pressable"
                    onClick={() => onLocate(preferredCitation.id)}
                  >
                    “{preferredCitation.excerpt}”
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function parseSourceCitationHref(href: string | undefined): string | undefined {
  if (!href?.startsWith("threadlight-source:")) return;
  const id = href.slice("threadlight-source:".length);
  return /^citation-\d+$/.test(id) ? id : undefined;
}

function citationAnchorId(namespace: string, citationId: string): string {
  return `source-${namespace}-${citationId}`;
}

function sourceNumber(
  source: MessageSourceData,
  sources: readonly MessageSourceData[],
): number {
  const encoded = /^s(\d+)$/.exec(source.id)?.[1];
  return encoded ? Number(encoded) : sources.indexOf(source) + 1;
}

function sourceCopy(language: Language) {
  return {
    "zh-CN": {
      sources: "来源",
      sourceCount: "{count} 个来源",
      drawerSubtitle: "{count} 个网页来源，点击可定位到对应原句",
      openCitation: "查看引用 {number}",
      openPage: "打开原网页",
      locate: "定位到对应原句",
      supports: "支持 {count} 处内容",
      close: "关闭来源",
    },
    "zh-TW": {
      sources: "來源",
      sourceCount: "{count} 個來源",
      drawerSubtitle: "{count} 個網頁來源，點擊可定位到對應原句",
      openCitation: "查看引用 {number}",
      openPage: "開啟原網頁",
      locate: "定位到對應原句",
      supports: "支援 {count} 處內容",
      close: "關閉來源",
    },
    en: {
      sources: "Sources",
      sourceCount: "{count} sources",
      drawerSubtitle: "{count} web sources · select one to locate its sentence",
      openCitation: "View citation {number}",
      openPage: "Open original page",
      locate: "Locate cited sentence",
      supports: "Supports {count} passages",
      close: "Close sources",
    },
    ja: {
      sources: "出典",
      sourceCount: "{count} 件の出典",
      drawerSubtitle: "{count} 件のウェブ出典・選択すると該当文へ移動",
      openCitation: "引用 {number} を表示",
      openPage: "元のページを開く",
      locate: "引用文へ移動",
      supports: "{count} 箇所を裏付け",
      close: "出典を閉じる",
    },
    ko: {
      sources: "출처",
      sourceCount: "출처 {count}개",
      drawerSubtitle: "웹 출처 {count}개 · 선택하면 인용 문장으로 이동",
      openCitation: "인용 {number} 보기",
      openPage: "원본 페이지 열기",
      locate: "인용 문장으로 이동",
      supports: "{count}개 문단 지원",
      close: "출처 닫기",
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
  const availableWidth = Math.max(0, viewportWidth - LOCAL_FILE_MENU_MARGIN * 2);
  const availableHeight = Math.max(0, viewportHeight - LOCAL_FILE_MENU_MARGIN * 2);
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
      if (menu.current?.contains(target) || link.current?.contains(target)) return;
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
      localFileContextMenuPosition(
        x,
        y,
        window.innerWidth,
        window.innerHeight,
      ),
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
          <span className="local-file-link-line">
            (line {reference.line})
          </span>
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
  const rootPrefix =
    comparisonRoot.endsWith("/") ? comparisonRoot : `${comparisonRoot}/`;
  const insideWorkspace =
    comparisonPath !== comparisonRoot &&
    comparisonPath.startsWith(rootPrefix);

  return {
    source: insideWorkspace ? "workspace" : "system",
    path: insideWorkspace
      ? absolutePath.slice(
          root.endsWith("/") ? root.length : root.length + 1,
        )
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
