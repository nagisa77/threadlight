import type {
  DesktopAutomation,
  DesktopAutomationRunStatus,
} from "../shared/desktop-api.js";
import { AutomationStore } from "./automation-store.js";

export interface AutomationExecutionResult {
  threadId?: string;
  output?: string;
  error?: string;
  toolError?: boolean;
}

export interface AutomationAlert {
  automation: DesktopAutomation;
  status: "attention" | "failed";
  summary: string;
  threadId?: string;
}

export interface AutomationSchedulerOptions {
  now?: () => Date;
  intervalMs?: number;
  execute(automation: DesktopAutomation): Promise<AutomationExecutionResult>;
  notify(alert: AutomationAlert): void;
  onChange?(projectId: string): void;
}

export class AutomationScheduler {
  private readonly active = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: AutomationStore,
    private readonly options: AutomationSchedulerOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    this.store.recoverInterruptedRuns();
    void this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      this.options.intervalMs ?? 30_000,
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    const due = this.store.due(this.options.now?.() ?? new Date());
    await Promise.all(due.map((automation) => this.run(automation.id, true)));
  }

  runNow(id: string): void {
    void this.run(id, false);
  }

  private async run(id: string, scheduled: boolean): Promise<void> {
    if (this.active.has(id)) return;
    const current = this.store.get(id);
    if (!current) return;
    this.active.add(id);
    const automation = this.store.markStarted(id, { scheduled });
    this.options.onChange?.(automation.projectId);
    try {
      const result = await this.options.execute(automation);
      const classification = classifyAutomationResult(result);
      const completed = this.store.markCompleted(id, {
        status: classification.status,
        ...(result.threadId ? { threadId: result.threadId } : {}),
        summary: classification.summary,
      });
      this.options.onChange?.(automation.projectId);
      if (
        classification.status === "attention" ||
        classification.status === "failed"
      ) {
        this.options.notify({
          automation: completed,
          status: classification.status,
          summary: classification.summary,
          ...(result.threadId ? { threadId: result.threadId } : {}),
        });
      }
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      const completed = this.store.markCompleted(id, {
        status: "failed",
        summary,
      });
      this.options.onChange?.(automation.projectId);
      this.options.notify({
        automation: completed,
        status: "failed",
        summary,
      });
    } finally {
      this.active.delete(id);
    }
  }
}

export function classifyAutomationResult(
  result: AutomationExecutionResult,
): { status: Exclude<DesktopAutomationRunStatus, "running">; summary: string } {
  if (result.error) {
    return { status: "failed", summary: conciseSummary(result.error) };
  }
  const output = result.output?.trim() ?? "";
  const attention =
    result.toolError ||
    /AUTOMATION_STATUS\s*:\s*attention\b/i.test(output);
  const status = attention ? "attention" : "succeeded";
  const withoutMarker = output
    .replace(/AUTOMATION_STATUS\s*:\s*(?:ok|attention)\b/gi, "")
    .trim();
  return {
    status,
    summary: conciseSummary(
      withoutMarker ||
        (status === "succeeded"
          ? "Automation completed successfully."
          : "Automation needs attention."),
    ),
  };
}

function conciseSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}
