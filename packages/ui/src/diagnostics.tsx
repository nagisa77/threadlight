import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Cpu,
  Download,
  FolderArchive,
  Gauge,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import type { HostProjectDiagnosticBundle } from "@threadlight/protocol";

import { useI18n } from "./i18n.js";
import { Dialog } from "./dialog.js";

export interface ModelStepDiagnostic {
  step: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ToolCallDiagnostic {
  callId: string;
  name: string;
  durationMs: number;
  isError: boolean;
  errorCode?: string;
}

export interface TurnDiagnostic {
  threadId: string;
  title: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  modelSteps: readonly ModelStepDiagnostic[];
  toolCalls: readonly ToolCallDiagnostic[];
}

export interface ProjectDiagnosticsSnapshot {
  projectId: string;
  projectName: string;
  generatedAt: string;
  totals: {
    turns: number;
    failedTurns: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    modelSteps: number;
    toolCalls: number;
    toolDurationMs: number;
  };
  turns: readonly TurnDiagnostic[];
}

export interface DiagnosticsAdapter {
  load(projectId: string): Promise<ProjectDiagnosticsSnapshot>;
  exportBundle(
    projectId: string,
    conversationIds?: readonly string[],
  ): Promise<HostProjectDiagnosticBundle>;
}

export interface DiagnosticConversationOption {
  id: string;
  title: string;
  updatedAt: string;
}

export async function exportSingleConversationDiagnostic(
  adapter: Pick<DiagnosticsAdapter, "exportBundle">,
  projectId: string,
  conversationId: string,
  save: (
    bundle: HostProjectDiagnosticBundle,
  ) => void = downloadDiagnosticBundle,
): Promise<void> {
  const bundle = await adapter.exportBundle(projectId, [conversationId]);
  save(bundle);
}

export function DiagnosticsPage({
  adapter,
  projectId,
  projectName,
  conversations,
}: {
  adapter: DiagnosticsAdapter;
  projectId: string;
  projectName: string;
  conversations: readonly DiagnosticConversationOption[];
}) {
  const { language, t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProjectDiagnosticsSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"project" | "conversations">(
    "project",
  );
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    readonly string[]
  >([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [exportError, setExportError] = useState<string>();
  const exportButton = useRef<HTMLButtonElement>(null);
  const [exportFeedback, setExportFeedback] = useState<{
    status: "success" | "error";
    message: string;
  }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void adapter
      .load(projectId)
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, projectId, refresh]);

  const totals = snapshot?.totals;
  const averageDuration = totals?.turns ? totals.durationMs / totals.turns : 0;

  function openExportDialog() {
    setExportScope("project");
    setSelectedConversationIds([]);
    setConversationQuery("");
    setExportError(undefined);
    setExportDialogOpen(true);
  }

  function closeExportDialog() {
    setExportDialogOpen(false);
    requestAnimationFrame(() => exportButton.current?.focus());
  }

  function toggleConversation(id: string) {
    setSelectedConversationIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  }

  async function exportBundle(conversationIds?: readonly string[]) {
    setExporting(true);
    setExportFeedback(undefined);
    setExportError(undefined);
    try {
      const bundle = await adapter.exportBundle(projectId, conversationIds);
      downloadDiagnosticBundle(bundle);
      closeExportDialog();
      setExportFeedback({
        status: "success",
        message: t("diagnosticBundleExported", { filename: bundle.filename }),
      });
    } catch (reason) {
      const message = t("diagnosticBundleExportFailed", {
        error: reason instanceof Error ? reason.message : String(reason),
      });
      setExportError(message);
      setExportFeedback({ status: "error", message });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header className="workspace-header diagnostics-header">
        <div>
          <h1>{t("usageDiagnostics")}</h1>
          <p>{t("usageDiagnosticsSubtitle", { project: projectName })}</p>
        </div>
        <div className="diagnostics-header-actions">
          <button
            ref={exportButton}
            type="button"
            className="diagnostics-refresh pressable"
            aria-label={t("refresh")}
            title={t("refresh")}
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {loading ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
          <button
            type="button"
            className="diagnostics-export pressable"
            disabled={exporting}
            onClick={openExportDialog}
          >
            {exporting ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Download size={14} />
            )}
            {exporting
              ? t("exportingDiagnosticBundle")
              : t("exportDiagnosticBundle")}
          </button>
        </div>
      </header>
      <section className="diagnostics-scroll">
        {error ? (
          <div className="diagnostics-empty error">{error}</div>
        ) : !snapshot && loading ? (
          <div className="diagnostics-empty">
            <LoaderCircle className="spin" size={16} />
            {t("loadingDiagnostics")}
          </div>
        ) : (
          <div className="diagnostics-page">
            <div className="diagnostics-export-note">
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <strong>{t("diagnosticBundleContents")}</strong>
                <p>{t("diagnosticBundleDescription")}</p>
              </div>
            </div>
            {exportFeedback && (
              <div
                className={`diagnostics-export-feedback ${exportFeedback.status}`}
                role={exportFeedback.status === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {exportFeedback.status === "success" && (
                  <CheckCircle2 size={15} aria-hidden="true" />
                )}
                <span>{exportFeedback.message}</span>
              </div>
            )}
            <div className="diagnostics-metrics">
              <Metric
                icon={<Gauge size={15} />}
                label={t("totalTokens")}
                value={formatNumber(totals?.totalTokens ?? 0, language)}
                detail={`${t("inputTokens")} ${formatNumber(totals?.inputTokens ?? 0, language)} · ${t("outputTokens")} ${formatNumber(totals?.outputTokens ?? 0, language)}`}
              />
              <Metric
                icon={<Clock3 size={15} />}
                label={t("totalDuration")}
                value={formatDuration(totals?.durationMs ?? 0)}
                detail={`${t("averageTurn")} ${formatDuration(averageDuration)}`}
              />
              <Metric
                icon={<Cpu size={15} />}
                label={t("modelSteps")}
                value={formatNumber(totals?.modelSteps ?? 0, language)}
                detail={`${formatNumber(totals?.turns ?? 0, language)} ${t("turns")} · ${formatNumber(totals?.failedTurns ?? 0, language)} ${t("failed")}`}
              />
              <Metric
                icon={<Wrench size={15} />}
                label={t("toolCalls")}
                value={formatNumber(totals?.toolCalls ?? 0, language)}
                detail={`${t("toolDuration")} ${formatDuration(totals?.toolDurationMs ?? 0)}`}
              />
            </div>

            <section className="diagnostics-turns">
              <div className="diagnostics-section-heading">
                <div>
                  <h2>{t("recentTurns")}</h2>
                  <p>{t("recentTurnsDescription")}</p>
                </div>
                <Activity size={16} />
              </div>
              {snapshot?.turns.length ? (
                <div className="diagnostics-turn-list">
                  {snapshot.turns.map((turn, index) => (
                    <TurnRow
                      key={`${turn.threadId}-${turn.completedAt}-${index}`}
                      turn={turn}
                      language={language}
                    />
                  ))}
                </div>
              ) : (
                <div className="diagnostics-empty compact">
                  {t("noUsageData")}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
      {exportDialogOpen && (
        <DiagnosticExportDialog
          projectName={projectName}
          conversations={conversations}
          scope={exportScope}
          selectedIds={selectedConversationIds}
          query={conversationQuery}
          busy={exporting}
          error={exportError}
          onScopeChange={setExportScope}
          onQueryChange={setConversationQuery}
          onToggle={toggleConversation}
          onSelectAll={() =>
            setSelectedConversationIds((current) =>
              current.length === conversations.length
                ? []
                : conversations.map(({ id }) => id),
            )
          }
          onCancel={() => {
            if (!exporting) closeExportDialog();
          }}
          onExport={() =>
            void exportBundle(
              exportScope === "conversations"
                ? selectedConversationIds
                : undefined,
            )
          }
        />
      )}
    </>
  );
}

export function DiagnosticExportDialog({
  projectName,
  conversations,
  scope,
  selectedIds,
  query,
  busy,
  error,
  onScopeChange,
  onQueryChange,
  onToggle,
  onSelectAll,
  onCancel,
  onExport,
}: {
  projectName: string;
  conversations: readonly DiagnosticConversationOption[];
  scope: "project" | "conversations";
  selectedIds: readonly string[];
  query: string;
  busy: boolean;
  error?: string;
  onScopeChange(scope: "project" | "conversations"): void;
  onQueryChange(query: string): void;
  onToggle(id: string): void;
  onSelectAll(): void;
  onCancel(): void;
  onExport(): void;
}) {
  const { language, t } = useI18n();
  const dialog = useRef<HTMLElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase(language);
  const filteredConversations = useMemo(
    () =>
      conversations.filter((conversation) =>
        `${conversation.title} ${conversation.id}`
          .toLocaleLowerCase(language)
          .includes(normalizedQuery),
      ),
    [conversations, language, normalizedQuery],
  );
  const selected = new Set(selectedIds);
  const canExport = scope === "project" || selectedIds.length > 0;

  return (
    <Dialog
      className="diagnostics-export-dialog"
      aria-labelledby="diagnostics-export-title"
      aria-describedby="diagnostics-export-description"
      aria-busy={busy}
      panelRef={dialog}
      initialFocusRef={dialog}
      dismissDisabled={busy}
      onClose={onCancel}
    >
      <header className="diagnostics-export-dialog-header">
        <span className="diagnostics-export-dialog-icon" aria-hidden="true">
          <Download size={17} />
        </span>
        <div>
          <h2 id="diagnostics-export-title">{t("exportDiagnosticBundle")}</h2>
          <p id="diagnostics-export-description">
            {t("diagnosticExportDialogDescription", {
              project: projectName,
            })}
          </p>
        </div>
        <button
          type="button"
          className="diagnostics-export-close pressable"
          aria-label={t("close")}
          title={t("close")}
          disabled={busy}
          onClick={onCancel}
        >
          <X size={15} />
        </button>
      </header>

      <div
        className="diagnostics-export-scopes"
        role="group"
        aria-label={t("diagnosticExportScope")}
      >
        <button
          type="button"
          className={scope === "project" ? "active" : undefined}
          aria-pressed={scope === "project"}
          disabled={busy}
          onClick={() => onScopeChange("project")}
        >
          <FolderArchive size={16} aria-hidden="true" />
          <span>
            <strong>{t("entireProject")}</strong>
            <small>
              {t("entireProjectDiagnosticDescription", {
                count: conversations.length,
              })}
            </small>
          </span>
        </button>
        <button
          type="button"
          className={scope === "conversations" ? "active" : undefined}
          aria-pressed={scope === "conversations"}
          disabled={busy || conversations.length === 0}
          onClick={() => onScopeChange("conversations")}
        >
          <MessageSquare size={16} aria-hidden="true" />
          <span>
            <strong>{t("selectedConversations")}</strong>
            <small>{t("selectedConversationsDiagnosticDescription")}</small>
          </span>
        </button>
      </div>

      {scope === "conversations" && (
        <div className="diagnostics-conversation-picker">
          <div className="diagnostics-conversation-toolbar">
            <label>
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder={t("searchConversations")}
                aria-label={t("searchConversations")}
                disabled={busy}
                onChange={(event) => onQueryChange(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || conversations.length === 0}
              onClick={onSelectAll}
            >
              {selectedIds.length === conversations.length
                ? t("deselectAll")
                : t("selectAll")}
            </button>
          </div>
          <div className="diagnostics-conversation-list">
            {filteredConversations.length ? (
              filteredConversations.map((conversation) => (
                <label
                  className={
                    selected.has(conversation.id) ? "selected" : undefined
                  }
                  key={conversation.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(conversation.id)}
                    disabled={busy}
                    onChange={() => onToggle(conversation.id)}
                  />
                  <span>
                    <strong>{conversation.title}</strong>
                    <small>
                      {new Intl.DateTimeFormat(language, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }).format(new Date(conversation.updatedAt))}
                      {" · "}
                      {conversation.id}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <div className="diagnostics-conversation-empty">
                {t("noMatchingConversations")}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="diagnostics-export-dialog-notice">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>{t("diagnosticCompleteRecordNotice")}</span>
      </div>
      {error && (
        <div className="diagnostics-export-dialog-error" role="alert">
          {error}
        </div>
      )}
      <footer className="diagnostics-export-dialog-actions">
        <span>
          {scope === "conversations"
            ? t("conversationsSelected", { count: selectedIds.length })
            : t("allConversationsSelected", { count: conversations.length })}
        </span>
        <button
          type="button"
          className="diagnostics-export-cancel pressable"
          disabled={busy}
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          className="diagnostics-export-confirm pressable"
          disabled={busy || !canExport}
          onClick={onExport}
        >
          {busy ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Download size={14} />
          )}
          {busy ? t("exportingDiagnosticBundle") : t("exportDiagnosticBundle")}
        </button>
      </footer>
    </Dialog>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="diagnostics-metric">
      <span className="diagnostics-metric-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TurnRow({
  turn,
  language,
}: {
  turn: TurnDiagnostic;
  language: string;
}) {
  const { t } = useI18n();
  return (
    <details className={`diagnostics-turn ${turn.status}`}>
      <summary>
        <span className={`diagnostics-turn-status ${turn.status}`} />
        <span className="diagnostics-turn-copy">
          <strong>{turn.title}</strong>
          <small>
            {turn.model ?? t("unknownModel")} ·{" "}
            {new Intl.DateTimeFormat(language, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(turn.completedAt))}
          </small>
        </span>
        <span className="diagnostics-turn-stat">
          <strong>{formatNumber(turn.totalTokens, language)}</strong>
          <small>{t("tokens")}</small>
        </span>
        <span className="diagnostics-turn-stat">
          <strong>{formatDuration(turn.durationMs)}</strong>
          <small>{t("duration")}</small>
        </span>
        <span className="diagnostics-turn-chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="diagnostics-turn-details">
        <div className="diagnostics-detail-summary">
          <span>
            {t("inputTokens")}{" "}
            <strong>{formatNumber(turn.inputTokens, language)}</strong>
          </span>
          <span>
            {t("outputTokens")}{" "}
            <strong>{formatNumber(turn.outputTokens, language)}</strong>
          </span>
          <span>
            {t("status")}{" "}
            <strong>
              {turn.status === "completed" ? t("completed") : t("failed")}
            </strong>
          </span>
        </div>
        {turn.modelSteps.length > 0 && (
          <DiagnosticTable
            title={t("modelSteps")}
            rows={turn.modelSteps.map((step) => ({
              id: String(step.step),
              name: `${t("step")} ${step.step}`,
              duration: formatDuration(step.durationMs),
              detail: `${formatNumber(step.totalTokens, language)} ${t("tokens")}`,
              error: false,
            }))}
          />
        )}
        {turn.toolCalls.length > 0 && (
          <DiagnosticTable
            title={t("toolCalls")}
            rows={turn.toolCalls.map((tool) => ({
              id: tool.callId,
              name: tool.name,
              duration: formatDuration(tool.durationMs),
              detail: tool.isError
                ? `${t("failed")}${tool.errorCode ? ` · ${tool.errorCode}` : ""}`
                : t("completed"),
              error: tool.isError,
            }))}
          />
        )}
      </div>
    </details>
  );
}

export function downloadDiagnosticBundle(
  bundle: HostProjectDiagnosticBundle,
): void {
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = bundle.filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DiagnosticTable({
  title,
  rows,
}: {
  title: string;
  rows: readonly {
    id: string;
    name: string;
    duration: string;
    detail: string;
    error: boolean;
  }[];
}) {
  return (
    <div className="diagnostics-detail-group">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div
          className={`diagnostics-detail-row ${row.error ? "error" : ""}`}
          key={row.id}
        >
          <span>{row.name}</span>
          <span>{row.detail}</span>
          <strong>{row.duration}</strong>
        </div>
      ))}
    </div>
  );
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
