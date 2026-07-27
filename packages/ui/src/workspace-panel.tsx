import {
  useCallback,
  useEffect,
  useMemo,
  useState,
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
  PanelRightClose,
  Plus,
  RefreshCw,
  Rows3,
  X,
} from "lucide-react";
import DiffViewer from "react-diff-viewer-continued";

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
}

interface WorkspaceTab {
  id: string;
  kind: "review" | "file";
  path?: string;
  title: string;
}

export function WorkspacePanel({
  adapter,
  projectId,
  projectName,
  changes,
  changesLoading,
  changesError,
  reviewRequest,
  hidden,
  onClose,
  onRefreshChanges,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  projectName: string;
  changes?: ConversationChangesSnapshot;
  changesLoading: boolean;
  changesError?: string;
  reviewRequest: number;
  hidden: boolean;
  onClose(): void;
  onRefreshChanges(): void;
}) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createFileTab(),
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
      const next = createReviewTab();
      setActiveTabId(next.id);
      return [...current, next];
    });
  }, [reviewRequest]);

  useEffect(() => {
    setTabs([createFileTab()]);
    setActiveTabId("");
    setDiffLayout("unified");
  }, [projectId]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [activeTabId, tabs]);

  function addFileTab() {
    const tab = createFileTab();
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
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
          ? { ...tab, path, title: fileName(path) }
          : tab,
      ),
    );
  }

  return (
    <aside
      className="workspace-panel"
      aria-label="审阅与文件面板"
      aria-hidden={hidden}
      hidden={hidden}
    >
      <div className="workspace-panel-tabs">
        <div className="workspace-tab-strip" role="tablist" aria-label="面板标签">
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
              ) : (
                <File size={14} />
              )}
              <span>{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                className="workspace-tab-close pressable"
                aria-label={`关闭${tab.title}标签`}
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
          <button
            type="button"
            className="workspace-tab-add pressable"
            aria-label="新建文件标签"
            title="新建文件标签"
            onClick={addFileTab}
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          type="button"
          className="workspace-panel-close pressable"
          aria-label="关闭侧边栏"
          title="关闭侧边栏"
          onClick={onClose}
        >
          <PanelRightClose size={17} />
        </button>
      </div>

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
          onSelectFile={selectFile}
        />
      ) : (
        <WorkspacePanelEmpty onAdd={addFileTab} />
      )}
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
  const [treeVisible, setTreeVisible] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();

  useEffect(() => {
    if (!changes?.files.length) {
      setSelectedPath(undefined);
      return;
    }
    if (!selectedPath || !changes.files.some((file) => file.path === selectedPath)) {
      setSelectedPath(changes.files[0].path);
    }
  }, [changes, selectedPath]);

  function selectChangedFile(path: string) {
    setSelectedPath(path);
    document.getElementById(reviewFileId(path))?.scrollIntoView({
      block: "start",
    });
  }

  return (
    <div className="review-view">
      <div className="review-toolbar">
        <div className="review-summary">
          <strong>本次对话</strong>
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
            aria-label="刷新本次文件修改"
            title="刷新"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? "spin" : undefined} size={15} />
          </button>
          <div className="diff-layout-toggle" aria-label="Diff 显示方式">
            <button
              type="button"
              className={`pressable ${layout === "unified" ? "active" : ""}`}
              aria-label="单边 Diff"
              aria-pressed={layout === "unified"}
              title="单边 Diff"
              onClick={() => onLayoutChange("unified")}
            >
              <Rows3 size={15} />
            </button>
            <button
              type="button"
              className={`pressable ${layout === "split" ? "active" : ""}`}
              aria-label="双边 Diff"
              aria-pressed={layout === "split"}
              title="双边 Diff"
              onClick={() => onLayoutChange("split")}
            >
              <Columns2 size={15} />
            </button>
          </div>
          <button
            type="button"
            className={`panel-icon-button pressable ${treeVisible ? "active" : ""}`}
            aria-label={treeVisible ? "隐藏变更文件树" : "显示变更文件树"}
            aria-pressed={treeVisible}
            title={treeVisible ? "隐藏变更文件树" : "显示变更文件树"}
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
              正在读取本次文件修改…
            </PanelState>
          ) : error ? (
            <PanelState icon={<FileDiff size={20} />} error>
              {error}
            </PanelState>
          ) : !changes || changes.files.length === 0 ? (
            <PanelState icon={<FileDiff size={20} />}>
              本次对话还没有修改文件
            </PanelState>
          ) : (
            changes.files.map((file) => (
              <ReviewFile key={file.path} file={file} layout={layout} />
            ))
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
  return (
    <section className="review-file" id={reviewFileId(file.path)}>
      <header className="review-file-header">
        <FileCode2 size={14} />
        <span title={file.path}>{file.path}</span>
        <ChangeCounts additions={file.additions} deletions={file.deletions} />
      </header>
      {file.binary || file.oldContent === undefined && file.newContent === undefined ? (
        <div className="review-binary">二进制文件或文件过大，无法显示 Diff</div>
      ) : (
        <div className="review-diff">
          <DiffViewer
            oldValue={file.oldContent ?? ""}
            newValue={file.newContent ?? ""}
            splitView={layout === "split"}
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

function FileView({
  adapter,
  projectId,
  projectName,
  path,
  onSelectFile,
}: {
  adapter: WorkspaceAdapter;
  projectId: string;
  projectName: string;
  path?: string;
  onSelectFile(path: string): void;
}) {
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
  }, [adapter, path, projectId]);

  return (
    <div className="file-view">
      <div className="file-view-toolbar">
        <Breadcrumb projectName={projectName} path={path} />
        <button
          type="button"
          className={`panel-icon-button pressable ${treeVisible ? "active" : ""}`}
          aria-label={treeVisible ? "隐藏文件树" : "显示文件树"}
          aria-pressed={treeVisible}
          title={treeVisible ? "隐藏文件树" : "显示文件树"}
          onClick={() => setTreeVisible((visible) => !visible)}
        >
          <FolderTree size={16} />
        </button>
      </div>
      <div className={`file-view-body ${treeVisible ? "has-tree" : ""}`}>
        <div className="file-preview">
          {loading ? (
            <PanelState icon={<LoaderCircle className="spin" size={20} />}>
              正在打开文件…
            </PanelState>
          ) : error ? (
            <PanelState icon={<FileCode2 size={20} />} error>
              {error}
            </PanelState>
          ) : !path ? (
            <PanelState icon={<FolderOpen size={22} />}>
              <strong>打开文件</strong>
              <span>从工作区目录树中选择文件</span>
            </PanelState>
          ) : file?.binary || file?.content === undefined ? (
            <PanelState icon={<FileCode2 size={20} />}>
              该文件是二进制文件或体积过大，无法预览
            </PanelState>
          ) : (
            <FileSource name={file.name} content={file.content} />
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

export function FileSource({
  name,
  content,
}: {
  name: string;
  content: string;
}) {
  const lines = content.split("\n");
  return (
    <div className="file-source" role="region" aria-label={`${name} 源代码`}>
      {lines.map((line, index) => (
        <div className="file-source-line" key={index}>
          <span className="file-source-line-number" aria-hidden="true">
            {index + 1}
          </span>
          <code>{line || "\u200b"}</code>
        </div>
      ))}
    </div>
  );
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
    <aside className="workspace-tree review-changes-tree" aria-label="变更文件树">
      <label className="workspace-tree-search">
        <span className="visually-hidden">筛选变更文件</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="筛选文件…"
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
                  aria-label="包含修改"
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
  const label =
    status === "added" ? "新增" : status === "deleted" ? "删除" : "修改";
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
    <aside className="workspace-tree" aria-label="工作区文件树">
      <label className="workspace-tree-search">
        <span className="visually-hidden">筛选文件</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="筛选文件…"
        />
      </label>
      <div className="workspace-tree-scroll">
        {error && <p className="workspace-tree-error">{error}</p>}
        {loading.has("") && !entries.has("") ? (
          <div className="workspace-tree-loading">
            <LoaderCircle className="spin" size={15} /> 正在读取…
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
  const parts = path?.split("/") ?? [];
  return (
    <nav className="file-breadcrumb" aria-label="文件路径">
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
  return (
    <PanelState icon={<FolderTree size={22} />}>
      <strong>没有打开的标签</strong>
      <button type="button" className="panel-empty-action pressable" onClick={onAdd}>
        <Plus size={14} /> 新建文件标签
      </button>
    </PanelState>
  );
}

function createReviewTab(): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    kind: "review",
    title: "审阅",
  };
}

function createFileTab(): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    kind: "file",
    title: "打开文件",
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
    cjs: "javascript",
    css: "css",
    go: "go",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    mjs: "javascript",
    py: "python",
    rs: "rust",
    sh: "bash",
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
