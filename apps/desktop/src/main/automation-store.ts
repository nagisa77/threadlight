import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  DesktopAutomation,
  DesktopAutomationCreateRequest,
  DesktopAutomationRun,
  DesktopAutomationSchedule,
  DesktopAutomationsSnapshot,
  DesktopAutomationUpdateRequest,
} from "../shared/desktop-api.js";

interface StoredAutomations {
  version: 1;
  automations: DesktopAutomation[];
}

const EMPTY_AUTOMATIONS: StoredAutomations = {
  version: 1,
  automations: [],
};

export interface AutomationStoreOptions {
  createId?: () => string;
  now?: () => Date;
}

export class AutomationStore {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly path: string,
    options: AutomationStoreOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  snapshot(projectId: string): DesktopAutomationsSnapshot {
    return {
      projectId,
      generatedAt: this.now().toISOString(),
      automations: this.read()
        .automations.filter((automation) => automation.projectId === projectId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    };
  }

  all(): readonly DesktopAutomation[] {
    return this.read().automations;
  }

  get(id: string): DesktopAutomation | undefined {
    return this.read().automations.find((automation) => automation.id === id);
  }

  create(request: DesktopAutomationCreateRequest): DesktopAutomationsSnapshot {
    validateAutomationInput(request);
    const stored = this.read();
    const now = this.now();
    const timestamp = now.toISOString();
    stored.automations.push({
      id: this.createId(),
      projectId: request.projectId,
      name: request.name.trim(),
      kind: request.kind,
      prompt: request.prompt.trim(),
      enabled: request.enabled,
      schedule: normalizeSchedule(request.schedule),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(request.enabled
        ? { nextRunAt: nextAutomationRun(request.schedule, now).toISOString() }
        : {}),
    });
    this.write(stored);
    return this.snapshot(request.projectId);
  }

  update(request: DesktopAutomationUpdateRequest): DesktopAutomationsSnapshot {
    validateAutomationInput(request);
    const stored = this.read();
    const automation = stored.automations.find(
      (candidate) =>
        candidate.id === request.id &&
        candidate.projectId === request.projectId,
    );
    if (!automation) throw new Error("Unknown automation");
    const now = this.now();
    const schedule = normalizeSchedule(request.schedule);
    const scheduleChanged =
      JSON.stringify(automation.schedule) !== JSON.stringify(schedule);
    const enabledChanged = automation.enabled !== request.enabled;
    automation.name = request.name.trim();
    automation.kind = request.kind;
    automation.prompt = request.prompt.trim();
    automation.enabled = request.enabled;
    automation.schedule = schedule;
    automation.updatedAt = now.toISOString();
    if (!request.enabled) {
      delete automation.nextRunAt;
    } else if (scheduleChanged || enabledChanged || !automation.nextRunAt) {
      automation.nextRunAt = nextAutomationRun(schedule, now).toISOString();
    }
    this.write(stored);
    return this.snapshot(request.projectId);
  }

  delete(projectId: string, id: string): DesktopAutomationsSnapshot {
    const stored = this.read();
    const target = stored.automations.find(
      (automation) =>
        automation.id === id && automation.projectId === projectId,
    );
    if (!target) throw new Error("Unknown automation");
    if (target.lastRun?.status === "running") {
      throw new Error("A running automation cannot be deleted");
    }
    const before = stored.automations.length;
    stored.automations = stored.automations.filter(
      (automation) =>
        automation.id !== id || automation.projectId !== projectId,
    );
    if (stored.automations.length === before) throw new Error("Unknown automation");
    this.write(stored);
    return this.snapshot(projectId);
  }

  due(at = this.now()): readonly DesktopAutomation[] {
    const timestamp = at.getTime();
    return this.read().automations.filter(
      (automation) =>
        automation.enabled &&
        !!automation.nextRunAt &&
        Date.parse(automation.nextRunAt) <= timestamp &&
        automation.lastRun?.status !== "running",
    );
  }

  markStarted(
    id: string,
    options: { scheduled: boolean },
  ): DesktopAutomation {
    const stored = this.read();
    const automation = stored.automations.find(
      (candidate) => candidate.id === id,
    );
    if (!automation) throw new Error("Unknown automation");
    const now = this.now();
    automation.lastRun = {
      status: "running",
      startedAt: now.toISOString(),
    };
    if (options.scheduled && automation.enabled) {
      automation.nextRunAt = nextAutomationRun(
        automation.schedule,
        now,
      ).toISOString();
    }
    automation.updatedAt = now.toISOString();
    this.write(stored);
    return structuredClone(automation);
  }

  markCompleted(
    id: string,
    run: Pick<DesktopAutomationRun, "status" | "threadId" | "summary">,
  ): DesktopAutomation {
    const stored = this.read();
    const automation = stored.automations.find(
      (candidate) => candidate.id === id,
    );
    if (!automation) throw new Error("Unknown automation");
    const completedAt = this.now().toISOString();
    automation.lastRun = {
      status: run.status,
      startedAt: automation.lastRun?.startedAt ?? completedAt,
      completedAt,
      ...(run.threadId ? { threadId: run.threadId } : {}),
      ...(run.summary ? { summary: run.summary } : {}),
    };
    automation.updatedAt = completedAt;
    this.write(stored);
    return structuredClone(automation);
  }

  recoverInterruptedRuns(): void {
    const stored = this.read();
    let changed = false;
    const completedAt = this.now().toISOString();
    for (const automation of stored.automations) {
      if (automation.lastRun?.status !== "running") continue;
      automation.lastRun = {
        ...automation.lastRun,
        status: "failed",
        completedAt,
        summary: "Threadlight closed before this automation finished.",
      };
      automation.updatedAt = completedAt;
      changed = true;
    }
    if (changed) this.write(stored);
  }

  private read(): StoredAutomations {
    let source: string;
    try {
      source = readFileSync(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return structuredClone(EMPTY_AUTOMATIONS);
      }
      throw error;
    }
    const value = JSON.parse(source) as unknown;
    if (!isStoredAutomations(value)) {
      throw new Error("Automations file has an unsupported format");
    }
    return value;
  }

  private write(value: StoredAutomations): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, this.path);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

export function nextAutomationRun(
  schedule: DesktopAutomationSchedule,
  after: Date,
): Date {
  const normalized = normalizeSchedule(schedule);
  const [hour, minute] = normalized.time.split(":").map(Number);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setDate(after.getDate() + offset);
    candidate.setHours(hour!, minute!, 0, 0);
    if (candidate.getTime() <= after.getTime()) continue;
    const weekday = candidate.getDay();
    if (
      normalized.cadence === "weekdays" &&
      (weekday === 0 || weekday === 6)
    ) {
      continue;
    }
    if (
      normalized.cadence === "weekly" &&
      weekday !== normalized.weekday
    ) {
      continue;
    }
    return candidate;
  }
  throw new Error("Unable to calculate the next automation run");
}

export function normalizeSchedule(
  schedule: DesktopAutomationSchedule,
): DesktopAutomationSchedule {
  if (
    schedule.cadence !== "daily" &&
    schedule.cadence !== "weekdays" &&
    schedule.cadence !== "weekly"
  ) {
    throw new Error("Invalid automation cadence");
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) {
    throw new Error("Automation time must use HH:mm");
  }
  if (
    schedule.cadence === "weekly" &&
    (!Number.isInteger(schedule.weekday) ||
      schedule.weekday! < 0 ||
      schedule.weekday! > 6)
  ) {
    throw new Error("Weekly automations require a weekday");
  }
  return {
    cadence: schedule.cadence,
    time: schedule.time,
    ...(schedule.cadence === "weekly"
      ? { weekday: schedule.weekday }
      : {}),
  };
}

function validateAutomationInput(
  request: DesktopAutomationCreateRequest,
): void {
  if (!request.projectId.trim()) throw new Error("Project id is required");
  if (!request.name.trim()) throw new Error("Automation name is required");
  if (!request.prompt.trim()) throw new Error("Automation prompt is required");
  if (
    request.kind !== "tests" &&
    request.kind !== "dependencies" &&
    request.kind !== "issue-triage"
  ) {
    throw new Error("Invalid automation kind");
  }
  if (typeof request.enabled !== "boolean") {
    throw new Error("Automation enabled state is required");
  }
  normalizeSchedule(request.schedule);
}

function isStoredAutomations(value: unknown): value is StoredAutomations {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stored = value as Record<string, unknown>;
  return (
    stored.version === 1 &&
    Array.isArray(stored.automations) &&
    stored.automations.every(isAutomation)
  );
}

function isAutomation(value: unknown): value is DesktopAutomation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const automation = value as Record<string, unknown>;
  try {
    normalizeSchedule(automation.schedule as DesktopAutomationSchedule);
  } catch {
    return false;
  }
  return (
    typeof automation.id === "string" &&
    typeof automation.projectId === "string" &&
    typeof automation.name === "string" &&
    (automation.kind === "tests" ||
      automation.kind === "dependencies" ||
      automation.kind === "issue-triage") &&
    typeof automation.prompt === "string" &&
    typeof automation.enabled === "boolean" &&
    typeof automation.createdAt === "string" &&
    typeof automation.updatedAt === "string" &&
    (automation.nextRunAt === undefined ||
      typeof automation.nextRunAt === "string") &&
    (automation.lastRun === undefined || isAutomationRun(automation.lastRun))
  );
}

function isAutomationRun(value: unknown): value is DesktopAutomationRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return (
    (run.status === "running" ||
      run.status === "succeeded" ||
      run.status === "attention" ||
      run.status === "failed") &&
    typeof run.startedAt === "string" &&
    (run.completedAt === undefined || typeof run.completedAt === "string") &&
    (run.threadId === undefined || typeof run.threadId === "string") &&
    (run.summary === undefined || typeof run.summary === "string")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
