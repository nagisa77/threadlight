import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  FolderTree,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";
import { createBrowserUuid } from "@threadlight/client";
import { MarkdownContent } from "./markdown.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme } from "./theme.js";
import { languageForPath } from "./source-language.js";
import type { HighlightSegment } from "./syntax-highlighter.js";
import type {
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceFile,
} from "./features/delivery/workspace-types.js";
import { PanelState } from "./features/delivery/workspace-primitives.js";
import { terminalTabLabel } from "./terminal-context.js";
import type { WorkspaceTab } from "./workspace-panel.js";

export function FileView({
  adapter,
  projectId,
  threadId,
  projectName,
  path,
  source = "workspace",
  line,
  revealRequest,
  hidden = false,
  onSelectFile,
  onOpenSystemFile,
  remoteSystemFiles = false,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  threadId?: string;
  projectName: string;
  path?: string;
  source?: "workspace" | "system";
  line?: number;
  revealRequest?: number;
  hidden?: boolean;
  onSelectFile(path: string): void;
  onOpenSystemFile?(): Promise<void>;
  remoteSystemFiles?: boolean;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<WorkspaceFile>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [treeVisible, setTreeVisible] = useState(true);
  const [choosingSystemFile, setChoosingSystemFile] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();

  useEffect(() => {
    if (!path) {
      setFile(undefined);
      setLoading(false);
      setError(undefined);
      setRevealError(undefined);
      setDownloadError(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    setRevealError(undefined);
    setDownloadError(undefined);
    const read =
      source === "system"
        ? adapter.readSystemFile
          ? adapter.readSystemFile(path)
          : Promise.reject(new Error(t("systemFileAccessUnavailable")))
        : adapter.read(projectId, path, threadId);
    void read
      .then((next) => {
        if (active) setFile(next);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, path, projectId, revealRequest, source, t, threadId]);

  useEffect(() => {
    if (source === "system" || isPlanDocumentPath(path)) {
      setTreeVisible(false);
    }
  }, [path, source]);

  async function chooseSystemFile() {
    if (!onOpenSystemFile || choosingSystemFile) return;
    setChoosingSystemFile(true);
    setError(undefined);
    try {
      await onOpenSystemFile();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setChoosingSystemFile(false);
    }
  }

  const canReveal = Boolean(
    path &&
    !remoteSystemFiles &&
    (source === "system" ? adapter.revealSystemFile : adapter.reveal),
  );
  const canDownload = Boolean(
    path &&
    remoteSystemFiles &&
    (source === "system" ? adapter.downloadSystemFile : adapter.download),
  );

  async function revealFile() {
    if (!path || !canReveal || revealing) return;
    setRevealing(true);
    setRevealError(undefined);
    try {
      if (source === "system") {
        await adapter.revealSystemFile?.(path);
      } else {
        await adapter.reveal?.(projectId, path, threadId);
      }
    } catch (reason) {
      setRevealError(t("revealFileFailed", { message: errorMessage(reason) }));
    } finally {
      setRevealing(false);
    }
  }

  async function downloadFile() {
    if (!path || !canDownload || downloading) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const content =
        source === "system"
          ? await adapter.downloadSystemFile?.(path)
          : await adapter.download?.(projectId, path, threadId);
      if (!content) throw new Error(t("fileDownloadUnavailable"));
      saveDownloadedFile(file?.name ?? fileName(path), content);
    } catch (reason) {
      setDownloadError(
        t("downloadFileFailed", { message: errorMessage(reason) }),
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="file-view" role="tabpanel" hidden={hidden}>
      <div className="file-view-toolbar">
        <Breadcrumb
          projectName={projectName}
          path={path}
          source={source}
          remoteSystemFiles={remoteSystemFiles}
        />
        <div className="file-view-actions">
          {source === "system" &&
            path &&
            !remoteSystemFiles &&
            adapter.revealSystemFile && (
              <button
                type="button"
                className="panel-icon-button pressable"
                aria-label={t("revealInFinder")}
                title={t("revealInFinder")}
                disabled={revealing}
                onClick={() => void revealFile()}
              >
                {revealing ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <FolderOpen size={16} />
                )}
              </button>
            )}
          {onOpenSystemFile && (
            <button
              type="button"
              className="panel-icon-button pressable"
              aria-label={
                remoteSystemFiles ? t("openRemoteFile") : t("openSystemFile")
              }
              title={
                remoteSystemFiles ? t("openRemoteFile") : t("openSystemFile")
              }
              disabled={choosingSystemFile}
              onClick={() => void chooseSystemFile()}
            >
              {choosingSystemFile ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FileCode2 size={16} />
              )}
            </button>
          )}
          <button
            type="button"
            className={`panel-icon-button pressable ${treeVisible ? "active" : ""}`}
            aria-label={treeVisible ? t("hideFileTree") : t("showFileTree")}
            aria-pressed={treeVisible}
            title={treeVisible ? t("hideFileTree") : t("showFileTree")}
            onClick={() => setTreeVisible((visible) => !visible)}
          >
            <FolderTree size={16} />
          </button>
        </div>
      </div>
      <div className={`file-view-body ${treeVisible ? "has-tree" : ""}`}>
        <div className="file-preview">
          {loading ? (
            <PanelState icon={<LoaderCircle className="spin" size={20} />}>
              {t("openingFile")}
            </PanelState>
          ) : error ? (
            <PanelState icon={<FileCode2 size={20} />} error>
              {error}
            </PanelState>
          ) : !path ? (
            <PanelState icon={<FolderOpen size={22} />}>
              <strong>{t("openFile")}</strong>
              <span>{t("selectFile")}</span>
              {onOpenSystemFile && (
                <button
                  type="button"
                  className="panel-empty-action pressable"
                  disabled={choosingSystemFile}
                  onClick={() => void chooseSystemFile()}
                >
                  {choosingSystemFile ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <FileCode2 size={14} />
                  )}
                  {remoteSystemFiles
                    ? t("openRemoteFile")
                    : t("openSystemFile")}
                </button>
              )}
            </PanelState>
          ) : file?.binary || file?.content === undefined ? (
            <PanelState icon={<FileCode2 size={20} />}>
              <strong>{t("binaryPreview")}</strong>
              {file && (
                <span>
                  {t("fileSize", { size: formatFileSize(file.size) })}
                </span>
              )}
              {canDownload ? (
                <button
                  type="button"
                  className="panel-empty-action pressable"
                  aria-label={t("downloadFile")}
                  disabled={downloading}
                  onClick={() => void downloadFile()}
                >
                  {downloading ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {t("downloadFile")}
                </button>
              ) : canReveal ? (
                <button
                  type="button"
                  className="panel-empty-action pressable"
                  disabled={revealing}
                  onClick={() => void revealFile()}
                >
                  {revealing ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <FolderOpen size={14} />
                  )}
                  {t("revealInFinder")}
                </button>
              ) : null}
              {(downloadError || revealError) && (
                <span className="workspace-panel-inline-error" role="status">
                  {downloadError ?? revealError}
                </span>
              )}
            </PanelState>
          ) : isPlanDocumentPath(file.path) ? (
            <PlanDocument content={file.content} />
          ) : (
            <FileSource
              name={file.name}
              content={file.content}
              line={line}
              revealRequest={revealRequest}
            />
          )}
          {revealError && file?.content !== undefined && (
            <p className="workspace-panel-inline-error" role="status">
              {revealError}
            </p>
          )}
        </div>
        {treeVisible && (
          <WorkspaceTree
            adapter={adapter}
            projectId={projectId}
            threadId={threadId}
            selectedPath={path}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </div>
  );
}

function saveDownloadedFile(name: string, content: ArrayBuffer): void {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(content)], { type: "application/octet-stream" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PlanDocument({ content }: { content: string }) {
  return (
    <article className="plan-document">
      <MarkdownContent>{content}</MarkdownContent>
    </article>
  );
}

export function isPlanDocumentPath(path: string | undefined): path is string {
  return !!path && /^\.threadlight\/plans\/[A-Za-z0-9_-]+\.md$/.test(path);
}

export function FileSource({
  name,
  content,
  line,
  revealRequest,
}: {
  name: string;
  content: string;
  line?: number;
  revealRequest?: number;
}) {
  const { t } = useI18n();
  const source = useRef<HTMLDivElement>(null);
  const plainLines = useMemo(() => plainFileLines(content), [content]);
  const [highlighted, setHighlighted] = useState<{
    name: string;
    content: string;
    lines: HighlightSegment[][];
  }>();
  const lines =
    highlighted?.name === name && highlighted.content === content
      ? highlighted.lines
      : plainLines;
  const targetLine = line && line <= lines.length ? line : undefined;

  useEffect(() => {
    if (!languageForPath(name)) return;
    let current = true;
    void import("./syntax-highlighter.js")
      .then(({ highlightedFileLines }) => {
        if (!current) return;
        setHighlighted({
          name,
          content,
          lines: highlightedFileLines(name, content),
        });
      })
      .catch(() => {
        // Plain text remains readable if syntax highlighting cannot load.
      });
    return () => {
      current = false;
    };
  }, [content, name]);

  useEffect(() => {
    if (!targetLine || !revealRequest) return;
    source.current
      ?.querySelector<HTMLElement>(`[data-line="${targetLine}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [revealRequest, targetLine]);

  return (
    <div
      ref={source}
      className="file-source"
      role="region"
      aria-label={t("sourceCode", { name })}
    >
      {lines.map((segments, index) => (
        <div
          className={`file-source-line ${index + 1 === targetLine ? "target" : ""}`}
          data-line={index + 1}
          key={index}
        >
          <span className="file-source-line-number" aria-hidden="true">
            {index + 1}
          </span>
          <code>
            {segments.length > 0
              ? segments.map((segment, segmentIndex) => (
                  <span
                    className={segment.className}
                    key={`${segmentIndex}-${segment.text.length}`}
                  >
                    {segment.text}
                  </span>
                ))
              : "\u200b"}
          </code>
        </div>
      ))}
    </div>
  );
}

function plainFileLines(content: string): HighlightSegment[][] {
  return content.split("\n").map((text) => (text ? [{ text }] : []));
}

export function WorkspaceTree({
  adapter,
  projectId,
  threadId,
  selectedPath,
  onSelectFile,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  threadId?: string;
  selectedPath?: string;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [entries, setEntries] = useState<
    Map<string, readonly WorkspaceEntry[]>
  >(() => new Map());
  const [loading, setLoading] = useState<Set<string>>(() => new Set([""]));
  const [error, setError] = useState<string>();

  const loadDirectory = useCallback(
    async (path = "") => {
      setLoading((current) => new Set(current).add(path));
      setError(undefined);
      try {
        const next = await adapter.list(projectId, path || undefined, threadId);
        setEntries((current) => new Map(current).set(path, next));
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [adapter, projectId, threadId],
  );

  useEffect(() => {
    setEntries(new Map());
    setExpanded(new Set());
    void loadDirectory();
  }, [loadDirectory]);

  async function toggleDirectory(path: string) {
    const isExpanded = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded && !entries.has(path)) await loadDirectory(path);
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();

  return (
    <aside className="workspace-tree" aria-label={t("workspaceTree")}>
      <label className="workspace-tree-search">
        <span className="visually-hidden">{t("filterFiles")}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("filterFiles")}
        />
      </label>
      <div className="workspace-tree-scroll">
        {error && <p className="workspace-tree-error">{error}</p>}
        {loading.has("") && !entries.has("") ? (
          <div className="workspace-tree-loading">
            <LoaderCircle className="spin" size={15} /> {t("loading")}
          </div>
        ) : (
          <TreeLevel
            directory=""
            depth={0}
            entries={entries}
            expanded={expanded}
            loading={loading}
            query={normalizedQuery}
            selectedPath={selectedPath}
            onToggle={(path) => void toggleDirectory(path)}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </aside>
  );
}

function TreeLevel({
  directory,
  depth,
  entries,
  expanded,
  loading,
  query,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  directory: string;
  depth: number;
  entries: Map<string, readonly WorkspaceEntry[]>;
  expanded: Set<string>;
  loading: Set<string>;
  query: string;
  selectedPath?: string;
  onToggle(path: string): void;
  onSelectFile(path: string): void;
}) {
  const children = entries.get(directory) ?? [];
  return (
    <>
      {children.map((entry) => {
        const matches =
          !query || entry.name.toLocaleLowerCase().includes(query);
        const isDirectory = entry.type === "directory";
        const isExpanded = expanded.has(entry.path);
        return (
          <div key={entry.path} hidden={!matches && !isDirectory}>
            <button
              type="button"
              className={`workspace-tree-row pressable ${entry.path === selectedPath ? "selected" : ""}`}
              style={{ paddingInlineStart: `${10 + depth * 15}px` }}
              onClick={() =>
                isDirectory ? onToggle(entry.path) : onSelectFile(entry.path)
              }
              title={entry.path}
            >
              {isDirectory ? (
                <>
                  {isExpanded ? (
                    <ChevronDown className="tree-chevron" size={14} />
                  ) : (
                    <ChevronRight className="tree-chevron" size={14} />
                  )}
                  {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                </>
              ) : (
                <>
                  <span className="tree-chevron-spacer" />
                  <FileCode2 size={14} />
                </>
              )}
              <span className="workspace-tree-name">{entry.name}</span>
              {isDirectory && loading.has(entry.path) && (
                <LoaderCircle className="spin tree-loading" size={12} />
              )}
            </button>
            {isDirectory && isExpanded && (
              <TreeLevel
                directory={entry.path}
                depth={depth + 1}
                entries={entries}
                expanded={expanded}
                loading={loading}
                query={query}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function Breadcrumb({
  projectName,
  path,
  source = "workspace",
  remoteSystemFiles = false,
}: {
  projectName: string;
  path?: string;
  source?: "workspace" | "system";
  remoteSystemFiles?: boolean;
}) {
  const { t } = useI18n();
  const parts = path?.replaceAll("\\", "/").split("/").filter(Boolean) ?? [];
  return (
    <nav
      className="file-breadcrumb"
      aria-label={t("filePath")}
      title={source === "system" ? path : undefined}
    >
      <span>
        {source === "system"
          ? remoteSystemFiles
            ? t("remoteFiles")
            : t("systemFiles")
          : projectName}
      </span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          <ChevronRight size={14} />
          <strong
            aria-current={index === parts.length - 1 ? "page" : undefined}
          >
            {part}
          </strong>
        </span>
      ))}
    </nav>
  );
}

export function WorkspacePanelEmpty({ onAdd }: { onAdd(): void }) {
  const { t } = useI18n();
  return (
    <PanelState icon={<FolderTree size={22} />}>
      <strong>{t("noOpenTabs")}</strong>
      <button
        type="button"
        className="panel-empty-action pressable"
        onClick={onAdd}
      >
        <Plus size={14} /> {t("newFileTab")}
      </button>
    </PanelState>
  );
}

export function createReviewTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "review",
    title: t("review"),
  };
}

export function createDeliveryTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "delivery",
    title: t("deliveryCenter"),
  };
}

export function createAgentTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "agents",
    title: t("agents"),
  };
}

export function createFileTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "file",
    title: t("openFile"),
  };
}

export function createBrowserTab(t: Translate): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: "browser",
    title: t("newBrowserTab"),
  };
}

export function createTerminalTab(
  workspace: "task" | "original",
  branch: string | undefined,
  t: Translate,
): WorkspaceTab {
  return {
    id: createBrowserUuid(),
    kind: workspace === "original" ? "original-terminal" : "terminal",
    title: terminalTabLabel(workspace, branch, undefined, t),
    branch,
  };
}

export function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

export function formatFileSize(size: number): string {
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  if (size < 1_000_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  return `${(size / 1_000_000_000).toFixed(1)} GB`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
