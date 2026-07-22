import { useEffect, useState } from "react";
import {
  ExternalLink,
  FileText,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { MarkdownContent } from "./markdown.js";

export interface ProjectMemorySnapshot {
  path: string;
  content: string;
  revision: string;
}

export interface ProjectMemoryAdapter {
  load(projectId: string): Promise<ProjectMemorySnapshot>;
  open(projectId: string): Promise<void>;
}

export function ProjectMemoryPage({
  adapter,
  projectId,
  projectName,
}: {
  adapter: ProjectMemoryAdapter;
  projectId: string;
  projectName: string;
}) {
  const [snapshot, setSnapshot] = useState<ProjectMemorySnapshot>();
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void adapter
      .load(projectId)
      .then((memory) => {
        if (active) setSnapshot(memory);
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
  }, [adapter, projectId, reload]);

  async function openFile() {
    if (opening) return;
    setOpening(true);
    setError(undefined);
    try {
      await adapter.open(projectId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <header className="workspace-header memory-header">
        <div>
          <h1>项目记忆</h1>
          <p>{projectName} · {snapshot?.path ?? ".threadlight/MEMORY.md"}</p>
        </div>
        <button
          type="button"
          className="memory-open-button pressable"
          disabled={loading || opening || !snapshot}
          onClick={() => void openFile()}
        >
          {opening ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <ExternalLink size={13} />
          )}
          {opening ? "正在打开…" : "在默认编辑器中打开"}
        </button>
      </header>

      <section className="memory-scroll">
        <div className="memory-page">
          <div className="memory-intro">
            <h2>项目的长期上下文</h2>
            <p>
              Threadlight 会在每个新任务开始时载入这份 Markdown。内容应当简短、稳定、可验证；已有任务保持创建时的快照。
            </p>
          </div>

          {error && (
            <div className="memory-error" role="alert">
              <TriangleAlert size={15} />
              <div>
                <strong>无法读取项目记忆</strong>
                <p>{error}</p>
              </div>
            </div>
          )}

          {loading && !snapshot ? (
            <div className="memory-loading">
              <LoaderCircle className="spin" size={16} /> 正在读取记忆…
            </div>
          ) : snapshot ? (
            <MemoryDocument
              snapshot={snapshot}
              refreshing={loading}
              onRefresh={() => setReload((value) => value + 1)}
            />
          ) : (
            <button
              type="button"
              className="memory-retry-button pressable"
              onClick={() => setReload((value) => value + 1)}
            >
              重试
            </button>
          )}
        </div>
      </section>
    </>
  );
}

export function MemoryDocument({
  snapshot,
  refreshing,
  onRefresh,
}: {
  snapshot: ProjectMemorySnapshot;
  refreshing: boolean;
  onRefresh(): void;
}) {
  const [mode, setMode] = useState<"preview" | "source">("preview");

  return (
    <section className="memory-document" aria-label="项目记忆文件">
      <div className="memory-document-toolbar">
        <div className="memory-file-label" title={snapshot.path}>
          <FileText size={14} />
          <span>{snapshot.path}</span>
        </div>
        <div className="memory-document-actions">
          <div className="memory-mode-switch" role="tablist" aria-label="查看方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              预览
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "source"}
              onClick={() => setMode("source")}
            >
              Markdown
            </button>
          </div>
          <button
            type="button"
            className="memory-refresh-button pressable"
            title="重新读取文件"
            aria-label="重新读取记忆文件"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? "spin" : undefined} size={14} />
          </button>
        </div>
      </div>
      <div className="memory-document-body" role="tabpanel">
        {mode === "preview" ? (
          <MarkdownContent>{snapshot.content}</MarkdownContent>
        ) : (
          <pre className="memory-source">{snapshot.content}</pre>
        )}
      </div>
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
