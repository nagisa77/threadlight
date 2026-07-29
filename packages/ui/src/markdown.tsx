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
  Eye,
  FileCode2,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useI18n } from "./i18n.js";

export interface MarkdownContentProps {
  children: string;
  onOpenLocalFile?(reference: LocalFileReference): void;
  onRevealLocalFile?(
    reference: LocalFileReference,
  ): void | Promise<void>;
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
}: MarkdownContentProps) {
  const components: Components = {
    a({ href, node: _node, className, children: linkChildren, ...props }) {
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
      <Markdown components={components} remarkPlugins={[remarkGfm]}>
        {children}
      </Markdown>
    </div>
  );
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
