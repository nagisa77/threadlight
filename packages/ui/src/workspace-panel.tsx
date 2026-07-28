import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  File,
  FileCode2,
  FileDiff,
  Folder,
  FolderOpen,
  FolderTree,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rows3,
  Terminal,
  X,
} from "lucide-react";
import DiffViewer from "react-diff-viewer-continued";
import { refractor } from "refractor";
import tsx from "refractor/tsx";

import { PanelAddMenu, type PanelViewKind } from "./panel-add-menu.js";
import { MarkdownContent } from "./markdown.js";
import { useI18n, type Translate } from "./i18n.js";
import { useTheme } from "./theme.js";
import {
  TerminalView,
  type TerminalAdapter,
} from "./terminal.js";

refractor.register(tsx);

const MAX_SIMULTANEOUS_REVIEW_FILES = 50;

export interface ConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface ConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly ConversationFileChange[];
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface WorkspaceFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export interface WorkspaceAdapter {
  getChanges(
    projectId: string,
    threadId: string,
  ): Promise<ConversationChangesSnapshot>;
  list(
    projectId: string,
    path?: string,
  ): Promise<readonly WorkspaceEntry[]>;
  read(projectId: string, path: string): Promise<WorkspaceFile>;
  reveal?(projectId: string, path: string): Promise<void>;
}

export interface WorkspaceFileOpenRequest {
  id: number;
  path: string;
  activate?: boolean;
  line?: number;
  column?: number;
}

interface WorkspaceTab {
  id: string;
  kind: "review" | PanelViewKind;
  path?: string;
  title: string;
  line?: number;
  column?: number;
  revealRequest?: number;
}

export function WorkspacePanel({
  adapter,
  terminal,
  projectId,
  projectName,
  changes,
  changesLoading,
  changesError,
  reviewRequest,
  fileOpenRequest,
  hidden,
  onResizeStart,
  onResizeBy,
  onResetSize,
  onRefreshChanges,
  toolbarActions,
}: {
  adapter: WorkspaceAdapter;
  terminal?: TerminalAdapter;
  projectId: string;
  projectName: string;
  changes?: ConversationChangesSnapshot;
  changesLoading: boolean;
  changesError?: string;
  reviewRequest: number;
  fileOpenRequest?: WorkspaceFileOpenRequest;
  hidden: boolean;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeBy(delta: number): void;
  onResetSize(): void;
  onRefreshChanges(): void;
  toolbarActions?: ReactNode;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createFileTab(t),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [diffLayout, setDiffLayout] = useState<"unified" | "split">("unified");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  useEffect(() => {
    if (reviewRequest === 0) return;
    setTabs((current) => {
      const review = current.find((tab) => tab.kind === "review");
      if (review) {
        setActiveTabId(review.id);
        return current;
      }
      const next = createReviewTab(t);
      setActiveTabId(next.id);
      return [...current, next];
    });
  }, [reviewRequest]);

  useEffect(() => {
    if (!fileOpenRequest) return;
    setTabs((current) => {
      const existing = current.find(
        (tab) =>
          tab.kind === "file" && tab.path === fileOpenRequest.path,
      );
      if (existing) {
        if (fileOpenRequest.activate !== false) {
          setActiveTabId(existing.id);
        }
        return current.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                line: fileOpenRequest.line,
                column: fileOpenRequest.column,
                revealRequest: fileOpenRequest.id,
              }
            : tab,
        );
      }

      const empty =
        current.find(
          (tab) =>
            tab.kind === "file" &&
            !tab.path &&
            tab.id === activeTabId,
        ) ??
        current.find((tab) => tab.kind === "file" && !tab.path);
      if (empty) {
        if (fileOpenRequest.activate !== false) {
          setActiveTabId(empty.id);
        }
        return current.map((tab) =>
          tab.id === empty.id
            ? {
                ...tab,
                path: fileOpenRequest.path,
                title: fileName(fileOpenRequest.path),
                line: fileOpenRequest.line,
                column: fileOpenRequest.column,
                revealRequest: fileOpenRequest.id,
              }
            : tab,
        );
      }

      const next: WorkspaceTab = {
        ...createFileTab(t),
        path: fileOpenRequest.path,
        title: fileName(fileOpenRequest.path),
        line: fileOpenRequest.line,
        column: fileOpenRequest.column,
        revealRequest: fileOpenRequest.id,
      };
      if (fileOpenRequest.activate !== false) {
        setActiveTabId(next.id);
      }
      return [...current, next];
    });
  }, [fileOpenRequest?.id]);

  useEffect(() => {
    setTabs([createFileTab(t)]);
    setActiveTabId("");
    setDiffLayout("unified");
  }, [projectId]);

  useEffect(() => {
    setTabs((current) =>
      current.map((tab) => ({
        ...tab,
        title:
          tab.kind === "review"
            ? t("review")
            : tab.kind === "terminal"
              ? t("terminal")
              : tab.path
                ? tab.title
                : t("openFile"),
      })),
    );
  }, [t]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [activeTabId, tabs]);

  function addTab(kind: PanelViewKind) {
    const tab =
      kind === "terminal" ? createTerminalTab(t) : createFileTab(t);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function addFileTab() {
    addTab("file");
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId) {
        const replacement = next[Math.min(index, next.length - 1)];
        setActiveTabId(replacement?.id ?? "");
      }
      return next;
    });
  }

  function selectFile(path: string) {
    if (!activeTab || activeTab.kind !== "file") return;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              path,
              title: fileName(path),
              line: undefined,
              column: undefined,
              revealRequest: undefined,
            }
          : tab,
      ),
    );
  }

  return (
    <aside
      className="workspace-panel"
      aria-label={t("rightPanel")}
      aria-hidden={hidden}
      hidden={hidden}
    >
      <div
        className="workspace-split-handle"
        role="separator"
        aria-label={t("resizeRightPanel")}
        aria-orientation="vertical"
        tabIndex={0}
        title={t("resizeRightPanelHint")}
        onPointerDown={onResizeStart}
        onDoubleClick={onResetSize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResizeBy(24);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onResizeBy(-24);
          } else if (event.key === "Home") {
            event.preventDefault();
            onResetSize();
          }
        }}
      />
      <div className="workspace-panel-tabs">
        <div className="workspace-panel-tab-flow">
          <div
            className="workspace-tab-strip"
            role="tablist"
            aria-label={t("panelTabs")}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                className={`workspace-tab pressable ${tab.id === activeTab?.id ? "active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.kind === "review" ? (
                  <FileDiff size={14} />
                ) : tab.kind === "terminal" ? (
                  <Terminal size={14} />
                ) : (
                  <File size={14} />
                )}
                <span>{tab.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="workspace-tab-close pressable"
                  aria-label={t("closeTab", { title: tab.title })}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={13} />
                </span>
              </button>
            ))}
          </div>
          <PanelAddMenu
            available={terminal ? ["terminal", "file"] : ["file"]}
            onSelect={addTab}
          />
        </div>
        {toolbarActions && (
          <div className="workspace-panel-actions">{toolbarActions}</div>
        )}
      </div>

      <div className="workspace-panel-stage">
        {terminal &&
          tabs
            .filter((tab) => tab.kind === "terminal")
            .map((tab) => (
              <TerminalView
                key={tab.id}
                adapter={terminal}
                projectId={projectId}
                hidden={tab.id !== activeTab?.id}
                label={tab.title}
              />
            ))}
        {activeTab?.kind === "review" ? (
          <ReviewView
            changes={changes}
            loading={changesLoading}
            error={changesError}
            layout={diffLayout}
            onLayoutChange={setDiffLayout}
            onRefresh={onRefreshChanges}
          />
        ) : activeTab?.kind === "file" ? (
          <FileView
            key={activeTab.id}
            adapter={adapter}
            projectId={projectId}
            projectName={projectName}
            path={activeTab.path}
            line={activeTab.line}
            revealRequest={activeTab.revealRequest}
            onSelectFile={selectFile}
          />
        ) : activeTab?.kind === "terminal" ? null : (
          <WorkspacePanelEmpty onAdd={addFileTab} />
        )}
      </div>
    </aside>
  );
}

export function ReviewView({
  changes,
  loading,
  error,
  layout,
  onLayoutChange,
  onRefresh,
}: {
  changes?: ConversationChangesSnapshot;
  loading: boolean;
  error?: string;
  layout: "unified" | "split";
  onLayoutChange(layout: "unified" | "split"): void;
  onRefresh(): void;
}) {
  const { t } = useI18n();
  const largeChangeSet =
    (changes?.files.length ?? 0) > MAX_SIMULTANEOUS_REVIEW_FILES;
  const [treeVisible, setTreeVisible] = useState(largeChangeSet);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    changes?.files[0]?.path,
  );

  useEffect(() => {
    if (!changes?.files.length) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath || !changes.files.some((file) => file.path === selectedPath)) {
      setSelectedPath(changes.files[0].path);
    }
  }, [changes, selectedPath]);

  useEffect(() => {
    if (largeChangeSet) setTreeVisible(true);
  }, [largeChangeSet]);

  function selectChangedFile(path: string) {
    setSelectedPath(path);
    if (!largeChangeSet) {
      document.getElementById(reviewFileId(path))?.scrollIntoView({
        block: "start",
      });
    }
  }

  const reviewFiles =
    largeChangeSet && selectedPath
      ? changes?.files.filter((file) => file.path === selectedPath)
      : changes?.files;

  return (
    <div className="review-view">
      <div className="review-toolbar">
        <div className="review-summary">
          <strong>{t("thisConversation")}</strong>
          {changes && (
            <ChangeCounts
              additions={changes.additions}
              deletions={changes.deletions}
            />
          )}
        </div>
        <div className="review-actions">
          <button
            type="button"
            className="panel-icon-button pressable"
            aria-label={t("refreshChanges")}
            title={t("refresh")}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : undefined} size={15} />
          </button>
          <div className="diff-layout-toggle" aria-label={t("diffLayout")}>
            <button
              type="button"
              className={`pressable ${layout === "unified" ? "active" : ""}`}
              aria-label={t("unifiedDiff")}
              aria-pressed={layout === "unified"}
              title={t("unifiedDiff")}
              onClick={() => onLayoutChange("unified")}
            >
              <Rows3 size={15} />
            </button>
            <button
              type="button"
              className={`pressable ${layout === "split" ? "active" : ""}`}
              aria-label={t("splitDiff")}
              aria-pressed={layout === "split"}
              title={t("splitDiff")}
              onClick={() => onLayoutChange("split")}
            >
              <Columns2 size={15} />
            </button>
          </div>
          <button
            type="button"
            className={`panel-icon-button pressable ${treeVisible ? "active" : ""}`}
            aria-label={treeVisible ? t("hideChangesTree") : t("showChangesTree")}
            aria-pressed={treeVisible}
            title={treeVisible ? t("hideChangesTree") : t("showChangesTree")}
            onClick={() => setTreeVisible((visible) => !visible)}
          >
            <FolderTree size={16} />
          </button>
        </div>
      </div>

      <div className={`review-view-body ${treeVisible ? "has-tree" : ""}`}>
        <div className="review-scroll">
          {loading && !changes ? (
            <PanelState icon={<LoaderCircle className="spin" size={20} />}>
              {t("loadingChanges")}
            </PanelState>
          ) : error ? (
            <PanelState icon={<FileDiff size={20} />} error>
              {error}
            </PanelState>
          ) : !changes || changes.files.length === 0 ? (
            <PanelState icon={<FileDiff size={20} />}>
              {t("noChanges")}
            </PanelState>
          ) : (
            <>
              {largeChangeSet && (
                <p className="review-large-change-notice">
                  {t("largeChangeSet", { count: changes.files.length })}
                </p>
              )}
              {reviewFiles?.map((file) => (
                <ReviewFile key={file.path} file={file} layout={layout} />
              ))}
            </>
          )}
        </div>
        {treeVisible && changes && changes.files.length > 0 && (
          <ReviewChangesTree
            files={changes.files}
            selectedPath={selectedPath}
            onSelectFile={selectChangedFile}
          />
        )}
      </div>
    </div>
  );
}

function ReviewFile({
  file,
  layout,
}: {
  file: ConversationFileChange;
  layout: "unified" | "split";
}) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  return (
    <section className="review-file" id={reviewFileId(file.path)}>
      <header className="review-file-header">
        <FileCode2 size={14} />
        <span title={file.path}>{file.path}</span>
        <ChangeCounts additions={file.additions} deletions={file.deletions} />
      </header>
      {file.binary || file.oldContent === undefined && file.newContent === undefined ? (
        <div className="review-binary">{t("binaryDiff")}</div>
      ) : (
        <div className="review-diff">
          <DiffViewer
            oldValue={file.oldContent ?? ""}
            newValue={file.newContent ?? ""}
            splitView={layout === "split"}
            useDarkTheme={resolvedTheme === "dark"}
            showDiffOnly
            extraLinesSurroundingDiff={3}
            hideSummary
            disableWorker
            highlightLanguage={languageForPath(file.path)}
            styles={diffStyles}
          />
        </div>
      )}
    </section>
  );
}

export function FileView({
  adapter,
  projectId,
  projectName,
  path,
  line,
  revealRequest,
  hidden = false,
  onSelectFile,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  projectName: string;
  path?: string;
  line?: number;
  revealRequest?: number;
  hidden?: boolean;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<WorkspaceFile>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [treeVisible, setTreeVisible] = useState(true);

  useEffect(() => {
    if (!path) {
      setFile(undefined);
      setError(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    void adapter
      .read(projectId, path)
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
  }, [adapter, path, projectId, revealRequest]);

  useEffect(() => {
    if (isPlanDocumentPath(path)) setTreeVisible(false);
  }, [path]);

  return (
    <div className="file-view" role="tabpanel" hidden={hidden}>
      <div className="file-view-toolbar">
        <Breadcrumb projectName={projectName} path={path} />
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
            </PanelState>
          ) : file?.binary || file?.content === undefined ? (
            <PanelState icon={<FileCode2 size={20} />}>
              {t("binaryPreview")}
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
        </div>
        {treeVisible && (
          <WorkspaceTree
            adapter={adapter}
            projectId={projectId}
            selectedPath={path}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </div>
  );
}

export function PlanDocument({ content }: { content: string }) {
  return (
    <article className="plan-document">
      <MarkdownContent>{content}</MarkdownContent>
    </article>
  );
}

export function isPlanDocumentPath(
  path: string | undefined,
): path is string {
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
  const lines = useMemo(
    () => highlightedFileLines(name, content),
    [content, name],
  );
  const targetLine = line && line <= lines.length ? line : undefined;

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

interface HighlightSegment {
  text: string;
  className?: string;
}

interface HighlightNode {
  type: string;
  value?: string;
  properties?: {
    className?: string | readonly string[];
  };
  children?: readonly HighlightNode[];
}

export function highlightedFileLines(
  name: string,
  content: string,
): HighlightSegment[][] {
  const language = languageForPath(name);
  if (!language || !refractor.registered(language)) {
    return content.split("\n").map((text) => text ? [{ text }] : []);
  }

  try {
    const root = refractor.highlight(content, language) as HighlightNode;
    const lines: HighlightSegment[][] = [[]];

    const appendText = (text: string, classNames: readonly string[]) => {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (part) {
          lines[lines.length - 1].push({
            text: part,
            ...(classNames.length > 0
              ? { className: [...new Set(classNames)].join(" ") }
              : {}),
          });
        }
        if (index < parts.length - 1) lines.push([]);
      });
    };

    const visit = (
      node: HighlightNode,
      inheritedClassNames: readonly string[],
    ) => {
      if (node.type === "text") {
        appendText(node.value ?? "", inheritedClassNames);
        return;
      }
      const ownClassName = node.properties?.className;
      const ownClassNames = Array.isArray(ownClassName)
        ? ownClassName.filter(
            (className): className is string => typeof className === "string",
          )
        : typeof ownClassName === "string"
          ? ownClassName.split(/\s+/).filter(Boolean)
          : [];
      const classNames = [...inheritedClassNames, ...ownClassNames];
      for (const child of node.children ?? []) visit(child, classNames);
    };

    visit(root, []);
    return lines;
  } catch {
    return content.split("\n").map((text) => text ? [{ text }] : []);
  }
}

interface ChangeTreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  children: ChangeTreeNode[];
  change?: ConversationFileChange;
}

export function ReviewChangesTree({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: readonly ConversationFileChange[];
  selectedPath?: string;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildChangeTree(files), [files]);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  function toggleDirectory(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <aside
      className="workspace-tree review-changes-tree"
      aria-label={t("changesTree")}
    >
      <label className="workspace-tree-search">
        <span className="visually-hidden">{t("filterChangedFiles")}</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("filterFiles")}
        />
      </label>
      <div className="workspace-tree-scroll">
        <ChangeTreeLevel
          nodes={tree}
          depth={0}
          collapsed={collapsed}
          query={normalizedQuery}
          selectedPath={selectedPath}
          onToggle={toggleDirectory}
          onSelectFile={onSelectFile}
        />
      </div>
    </aside>
  );
}

function ChangeTreeLevel({
  nodes,
  depth,
  collapsed,
  query,
  selectedPath,
  onToggle,
  onSelectFile,
}: {
  nodes: readonly ChangeTreeNode[];
  depth: number;
  collapsed: Set<string>;
  query: string;
  selectedPath?: string;
  onToggle(path: string): void;
  onSelectFile(path: string): void;
}) {
  const { t } = useI18n();
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.type === "directory";
        const isCollapsed = collapsed.has(node.path);
        const matches =
          !query ||
          node.path.toLocaleLowerCase().includes(query) ||
          node.children.some((child) =>
            changeTreeContainsQuery(child, query),
          );
        if (!matches) return null;
        return (
          <div key={node.path}>
            <button
              type="button"
              className={`workspace-tree-row pressable ${node.path === selectedPath ? "selected" : ""}`}
              style={{ paddingInlineStart: `${10 + depth * 15}px` }}
              onClick={() =>
                isDirectory ? onToggle(node.path) : onSelectFile(node.path)
              }
              title={node.path}
            >
              {isDirectory ? (
                <>
                  {isCollapsed ? (
                    <ChevronRight className="tree-chevron" size={14} />
                  ) : (
                    <ChevronDown className="tree-chevron" size={14} />
                  )}
                  {isCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}
                </>
              ) : (
                <>
                  <span className="tree-chevron-spacer" />
                  <FileCode2 size={14} />
                </>
              )}
              <span className="workspace-tree-name">{node.name}</span>
              {isDirectory ? (
                <span
                  className="review-change-directory-indicator"
                  aria-label={t("containsChanges")}
                />
              ) : node.change ? (
                <ChangeStatus status={node.change.status} />
              ) : null}
            </button>
            {isDirectory && !isCollapsed && (
              <ChangeTreeLevel
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
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

function ChangeStatus({
  status,
}: {
  status: ConversationFileChange["status"];
}) {
  const { t } = useI18n();
  const label =
    status === "added"
      ? t("added")
      : status === "deleted"
        ? t("deleted")
        : t("modified");
  return (
    <span className={`review-change-status ${status}`} aria-label={label}>
      {status === "added" ? "+" : status === "deleted" ? "−" : "•"}
    </span>
  );
}

export function WorkspaceTree({
  adapter,
  projectId,
  selectedPath,
  onSelectFile,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
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
        const next = await adapter.list(projectId, path || undefined);
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
    [adapter, projectId],
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
}: {
  projectName: string;
  path?: string;
}) {
  const { t } = useI18n();
  const parts = path?.split("/") ?? [];
  return (
    <nav className="file-breadcrumb" aria-label={t("filePath")}>
      <span>{projectName}</span>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          <ChevronRight size={14} />
          <strong aria-current={index === parts.length - 1 ? "page" : undefined}>
            {part}
          </strong>
        </span>
      ))}
    </nav>
  );
}

function ChangeCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="change-counts">
      <span className="change-additions">+{additions}</span>
      <span className="change-deletions">-{deletions}</span>
    </span>
  );
}

function PanelState({
  icon,
  error,
  children,
}: {
  icon: ReactNode;
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`workspace-panel-state ${error ? "error" : ""}`}>
      <span>{icon}</span>
      {typeof children === "string" ? <p>{children}</p> : children}
    </div>
  );
}

function WorkspacePanelEmpty({ onAdd }: { onAdd(): void }) {
  const { t } = useI18n();
  return (
    <PanelState icon={<FolderTree size={22} />}>
      <strong>{t("noOpenTabs")}</strong>
      <button type="button" className="panel-empty-action pressable" onClick={onAdd}>
        <Plus size={14} /> {t("newFileTab")}
      </button>
    </PanelState>
  );
}

function createReviewTab(t: Translate): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    kind: "review",
    title: t("review"),
  };
}

function createFileTab(t: Translate): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    kind: "file",
    title: t("openFile"),
  };
}

function createTerminalTab(t: Translate): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    kind: "terminal",
    title: t("terminal"),
  };
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function buildChangeTree(
  files: readonly ConversationFileChange[],
): ChangeTreeNode[] {
  const root: ChangeTreeNode[] = [];

  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    const parts = file.path.split("/").filter(Boolean);
    let children = root;
    let currentPath = "";
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = children.find(
        (candidate) =>
          candidate.path === currentPath &&
          candidate.type === (isFile ? "file" : "directory"),
      );
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "directory",
          children: [],
          ...(isFile ? { change: file } : {}),
        };
        children.push(node);
      }
      children = node.children;
    });
  }

  sortChangeTree(root);
  return root;
}

function sortChangeTree(nodes: ChangeTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortChangeTree(node.children);
}

function changeTreeContainsQuery(node: ChangeTreeNode, query: string): boolean {
  return (
    node.path.toLocaleLowerCase().includes(query) ||
    node.children.some((child) => changeTreeContainsQuery(child, query))
  );
}

function reviewFileId(path: string): string {
  return `review-file-${encodeURIComponent(path)}`;
}

function languageForPath(path: string): string | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return {
    bash: "bash",
    c: "c",
    cjs: "javascript",
    cpp: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    kt: "kotlin",
    less: "less",
    lua: "lua",
    md: "markdown",
    mjs: "javascript",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sass: "sass",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    ts: "typescript",
    tsx: "tsx",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  }[extension ?? ""];
}

const diffStyles = {
  variables: {
    light: {
      diffViewerBackground: "#ffffff",
      diffViewerColor: "#33332f",
      addedBackground: "#edf7ee",
      addedColor: "#286a3d",
      removedBackground: "#fff0ef",
      removedColor: "#9f3934",
      wordAddedBackground: "#ccebd2",
      wordRemovedBackground: "#f4cfcc",
      addedGutterBackground: "#def0e1",
      removedGutterBackground: "#f7dfdd",
      gutterBackground: "#f7f7f4",
      gutterBackgroundDark: "#efefeb",
      highlightBackground: "#fffbdd",
      highlightGutterBackground: "#fff5b1",
      codeFoldGutterBackground: "#f2f2ee",
      codeFoldBackground: "#f7f7f4",
      emptyLineBackground: "#fafaf8",
      gutterColor: "#8b8a83",
      addedGutterColor: "#2f8149",
      removedGutterColor: "#b14942",
      codeFoldContentColor: "#77766f",
    },
    dark: {
      diffViewerBackground: "#202124",
      diffViewerColor: "#dededa",
      addedBackground: "#183426",
      addedColor: "#83c596",
      removedBackground: "#3b2224",
      removedColor: "#ef938c",
      wordAddedBackground: "#285239",
      wordRemovedBackground: "#613237",
      addedGutterBackground: "#203e2d",
      removedGutterBackground: "#48282b",
      gutterBackground: "#25262a",
      gutterBackgroundDark: "#2d2e32",
      highlightBackground: "#423b24",
      highlightGutterBackground: "#554b29",
      codeFoldGutterBackground: "#292a2e",
      codeFoldBackground: "#25262a",
      emptyLineBackground: "#222326",
      gutterColor: "#858581",
      addedGutterColor: "#79bb8b",
      removedGutterColor: "#e1857f",
      codeFoldContentColor: "#a7a7a2",
    },
  },
  diffContainer: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "12px",
    lineHeight: 1.6,
  },
  lineNumber: {
    minWidth: "44px",
  },
  contentText: {
    padding: "0 10px",
  },
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
