import { messagesFor, type Language } from "./i18n.js";
import { AUTOMATION_COPY, type AutomationCopy } from "./automation-copy.js";
import type {
  Automation,
  AutomationDraft,
  AutomationKind,
  AutomationSchedule,
  AutomationTemplate,
} from "./automations.js";

export type AutomationFilter = "all" | "enabled" | "paused";

export function filterAutomations(
  automations: readonly Automation[],
  filter: AutomationFilter,
  query: string,
  language: Language,
  kindLabels: Record<AutomationKind, string>,
): readonly Automation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase(language);
  return automations.filter((automation) => {
    if (filter === "enabled" && !automation.enabled) return false;
    if (filter === "paused" && automation.enabled) return false;
    if (!normalizedQuery) return true;
    return [automation.name, automation.prompt, kindLabels[automation.kind]]
      .join(" ")
      .toLocaleLowerCase(language)
      .includes(normalizedQuery);
  });
}

export function defaultDraft(
  kind: AutomationKind,
  language: Language,
  prompts: Record<AutomationKind, string>,
): AutomationDraft {
  const copy = messagesFor(AUTOMATION_COPY, language);
  return {
    name: copy.defaultName[kind],
    kind,
    prompt: prompts[kind],
    enabled: true,
    schedule:
      kind === "issue-triage"
        ? { cadence: "weekly", weekday: 1, time: "09:00" }
        : kind === "dependencies"
          ? { cadence: "weekdays", time: "09:30" }
          : { cadence: "daily", time: "09:00" },
  };
}

export function draftFromTemplate(
  template: AutomationTemplate,
): AutomationDraft {
  return {
    name: template.name,
    kind: template.kind,
    prompt: template.prompt,
    enabled: true,
    schedule: { ...template.schedule },
  };
}

export function formatSchedule(
  schedule: AutomationSchedule,
  language: Language,
  copy: AutomationCopy,
): string {
  return schedule.cadence === "weekly"
    ? `${copy.weekdays[schedule.weekday ?? 1]} ${schedule.time}`
    : `${copy.cadenceLabel[schedule.cadence]} ${schedule.time}`;
}

export function formatDateTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function automationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
