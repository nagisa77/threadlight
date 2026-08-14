import { LoaderCircle } from "lucide-react";

import { useI18n } from "../../i18n.js";
import { TaskProductivityMenu } from "./task-actions.js";

export function TaskHeader({
  title,
  context,
  taskId,
  running,
  connectionReady,
  bookmarkCount,
  onCopyReference,
  onExport,
  onOpenBookmarks,
}: {
  title: string;
  context: string;
  taskId: string;
  running: boolean;
  connectionReady: boolean;
  bookmarkCount: number;
  onCopyReference(): Promise<void>;
  onExport(): void;
  onOpenBookmarks(): void;
}) {
  const { t } = useI18n();
  return (
    <header className="workspace-header">
      <div className="workspace-header-drag-region" aria-hidden="true" />
      <div className="workspace-header-title">
        <h1 key={title} className="header-title" title={title}>
          {title}
        </h1>
        <p title={`${context} · ${taskId}`}>
          {context} · {taskId}
        </p>
      </div>
      <div className="workspace-header-actions">
        <TaskProductivityMenu
          disabled={!connectionReady}
          bookmarkCount={bookmarkCount}
          onCopyReference={onCopyReference}
          onExport={onExport}
          onOpenBookmarks={onOpenBookmarks}
        />
        {running && (
          <span className="running-badge" role="status">
            <LoaderCircle size={13} aria-hidden="true" /> {t("running")}
          </span>
        )}
      </div>
    </header>
  );
}
