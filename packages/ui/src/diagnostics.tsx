import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Cpu,
  Download,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { HostProjectDiagnosticBundle } from "@threadlight/protocol";

import { useI18n } from "./i18n.js";

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
  exportBundle(projectId: string): Promise<HostProjectDiagnosticBundle>;
}

export function DiagnosticsPage({
  adapter,
  projectId,
  projectName,
}: {
  adapter: DiagnosticsAdapter;
  projectId: string;
  projectName: string;
}) {
  const { language, t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProjectDiagnosticsSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
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

  async function exportBundle() {
    setExporting(true);
    setExportFeedback(undefined);
    try {
      const bundle = await adapter.exportBundle(projectId);
      downloadDiagnosticBundle(bundle);
      setExportFeedback({
        status: "success",
        message: t("diagnosticBundleExported", { filename: bundle.filename }),
      });
    } catch (reason) {
      setExportFeedback({
        status: "error",
        message: t("diagnosticBundleExportFailed", {
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      });
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
            onClick={() => void exportBundle()}
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
    </>
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

function downloadDiagnosticBundle(bundle: HostProjectDiagnosticBundle): void {
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
