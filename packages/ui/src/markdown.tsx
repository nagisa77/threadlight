import { FileCode2 } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownContentProps {
  children: string;
  onOpenLocalFile?(reference: LocalFileReference): void;
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

export function MarkdownContent({
  children,
  onOpenLocalFile,
}: MarkdownContentProps) {
  const components: Components = {
    a({ href, node: _node, className, children: linkChildren, ...props }) {
      const localFile = parseLocalFileReference(href);
      if (localFile && onOpenLocalFile) {
        return (
          <a
            href={href}
            {...props}
            className={["local-file-link", className]
              .filter(Boolean)
              .join(" ")}
            title={localFileTitle(localFile)}
            onClick={(event) => {
              event.preventDefault();
              onOpenLocalFile(localFile);
            }}
          >
            <FileCode2 size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>{linkChildren}</span>
            {localFile.line && (
              <span className="local-file-link-line">
                (line {localFile.line})
              </span>
            )}
          </a>
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

function localFileTitle(reference: LocalFileReference): string {
  const position = reference.line
    ? `:${reference.line}${reference.column ? `:${reference.column}` : ""}`
    : "";
  return `${reference.path}${position}`;
}
