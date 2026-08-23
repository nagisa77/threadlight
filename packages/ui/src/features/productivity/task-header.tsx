import { useEffect, useRef, useState } from "react";
import type { ActiveTurnMetricsData } from "@threadlight/protocol";
import { ArrowDown, ArrowUp, LoaderCircle, Radio, Timer } from "lucide-react";

import { useI18n } from "../../i18n.js";
import { TaskProductivityMenu } from "./task-actions.js";

export function TaskHeader({
  title,
  context,
  taskId,
  running,
  runMetrics,
  connectionReady,
  bookmarkCount,
  taskLinksEnabled,
  onCopyReference,
  onExport,
  onOpenBookmarks,
}: {
  title: string;
  context: string;
  taskId: string;
  running: boolean;
  runMetrics?: ActiveTurnMetricsData;
  connectionReady: boolean;
  bookmarkCount: number;
  taskLinksEnabled?: boolean;
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
        {running && <RunningStatus metrics={runMetrics} />}
        <TaskProductivityMenu
          disabled={!connectionReady}
          bookmarkCount={bookmarkCount}
          taskLinksEnabled={taskLinksEnabled}
          onCopyReference={onCopyReference}
          onExport={onExport}
          onOpenBookmarks={onOpenBookmarks}
        />
      </div>
    </header>
  );
}

const STREAM_RATE_WINDOW_MS = 1_000;

function RunningStatus({ metrics }: { metrics?: ActiveTurnMetricsData }) {
  const { language, t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const samples = useRef<Array<{ at: number; bytes: number }>>([]);
  const previous = useRef<
    { startedAt: string; streamedBytes: number } | undefined
  >(undefined);
  const tooltipId = "running-task-metrics";

  useEffect(() => {
    if (!metrics) {
      previous.current = undefined;
      samples.current = [];
      return;
    }
    const observedAt = Date.now();
    const prior = previous.current;
    if (!prior || prior.startedAt !== metrics.startedAt) {
      samples.current = [];
    } else {
      samples.current = samples.current.filter(
        (sample) => sample.at > observedAt - STREAM_RATE_WINDOW_MS,
      );
      const streamedBytes = metrics.streamedBytes - prior.streamedBytes;
      if (streamedBytes > 0) {
        samples.current.push({ at: observedAt, bytes: streamedBytes });
      }
    }
    previous.current = {
      startedAt: metrics.startedAt,
      streamedBytes: metrics.streamedBytes,
    };
  }, [metrics]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const threshold = now - STREAM_RATE_WINDOW_MS;
  const recentSamples = samples.current.filter(
    (sample) => sample.at > threshold,
  );
  const streamedBytesPerSecond = recentSamples.reduce(
    (total, sample) => total + sample.bytes,
    0,
  );
  const tokenRate =
    metrics && metrics.modelDurationMs > 0
      ? (metrics.usage.outputTokens * 1_000) / metrics.modelDurationMs
      : undefined;
  const startedAt = metrics ? Date.parse(metrics.startedAt) : Number.NaN;
  const elapsedMs = Number.isFinite(startedAt)
    ? Math.max(0, now - startedAt)
    : 0;
  const currentModelStartedAt = metrics?.currentModelStartedAt
    ? Date.parse(metrics.currentModelStartedAt)
    : Number.NaN;
  const pendingTtftMs = Number.isFinite(currentModelStartedAt)
    ? Math.max(0, now - currentModelStartedAt)
    : undefined;
  const currentTtftMs = metrics?.currentTtftMs ?? pendingTtftMs;
  const averageTtftMs = metrics?.ttftSamples
    ? metrics.totalTtftMs / metrics.ttftSamples
    : undefined;
  const waitingForFirstText =
    metrics?.currentTtftMs === undefined && pendingTtftMs !== undefined;
  const confirmed = Boolean(metrics?.completedModelSteps);

  return (
    <div className="running-status">
      <button
        type="button"
        className="running-badge"
        aria-label={t("runMetricsLabel")}
        aria-describedby={tooltipId}
      >
        <span className="running-badge-state">
          <LoaderCircle size={12} aria-hidden="true" />
          <span>{t("running")}</span>
        </span>
      </button>
      <div id={tooltipId} className="run-metrics-popover" role="tooltip">
        <div className="run-metrics-heading">
          <span>
            <i aria-hidden="true" />
            {t("runMetrics")}
          </span>
          <time>{formatElapsed(elapsedMs)}</time>
        </div>
        <div className="run-metrics-ttft">
          <span>
            <small>
              <Timer size={12} aria-hidden="true" />
              {t("currentTtft")}
            </small>
            <strong
              title={waitingForFirstText ? t("waitingForFirstText") : undefined}
            >
              {currentTtftMs === undefined
                ? "—"
                : `${formatLatency(currentTtftMs, language)}${waitingForFirstText ? "…" : ""}`}
            </strong>
          </span>
          <span>
            <small>{t("averageTtft")}</small>
            <strong>
              {averageTtftMs === undefined
                ? "—"
                : formatLatency(averageTtftMs, language)}
            </strong>
          </span>
        </div>
        <div className="run-metrics-secondary">
          <span>
            <small>{t("tokenRate")}</small>
            <strong>
              {tokenRate === undefined
                ? "—"
                : `${formatRate(tokenRate, language)} tok/s`}
            </strong>
          </span>
          <span>
            <small>
              <ArrowUp size={11} aria-hidden="true" />
              {t("inputTokens")}
            </small>
            <strong>
              {formatCount(metrics?.usage.inputTokens ?? 0, language)}
            </strong>
          </span>
          <span>
            <small>
              <ArrowDown size={11} aria-hidden="true" />
              {t("outputTokens")}
            </small>
            <strong>
              {formatCount(metrics?.usage.outputTokens ?? 0, language)}
            </strong>
          </span>
        </div>
        <div className="run-metrics-model">
          {confirmed
            ? `${metrics?.completedModelSteps ?? 0} ${t("modelSteps")} · ${t("providerConfirmed")}`
            : t("waitingForUsage")}
        </div>
        <div className="run-metrics-stream">
          <Radio size={12} aria-hidden="true" />
          <span>{t("liveStreamRate")}</span>
          <strong>{formatByteRate(streamedBytesPerSecond, language)}</strong>
        </div>
      </div>
    </div>
  );
}

function formatCount(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatRate(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: value < 100 ? 1 : 0,
    maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0,
  }).format(value);
}

function formatByteRate(bytes: number, language: string): string {
  if (bytes < 1_000) return `${formatCount(bytes, language)} B/s`;
  if (bytes < 1_000_000) return `${formatRate(bytes / 1_000, language)} KB/s`;
  return `${formatRate(bytes / 1_000_000, language)} MB/s`;
}

function formatLatency(milliseconds: number, language: string): string {
  if (milliseconds < 1_000) {
    return `${formatCount(Math.round(milliseconds), language)} ms`;
  }
  return `${formatRate(milliseconds / 1_000, language)} s`;
}

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60)
    return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}
