import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AutomationStore,
  nextAutomationRun,
} from "../src/main/automation-store.js";
import {
  AutomationScheduler,
  classifyAutomationResult,
  type AutomationAlert,
} from "../src/main/automation-scheduler.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(now: Date) {
  const directory = mkdtempSync(join(tmpdir(), "threadlight-automation-"));
  directories.push(directory);
  return new AutomationStore(join(directory, "automations.json"), {
    createId: () => "automation-1",
    now: () => new Date(now),
  });
}

describe("AutomationStore", () => {
  it("persists project automations and calculates the next daily run", () => {
    const now = new Date(2026, 6, 30, 8, 30);
    const store = createStore(now);
    const snapshot = store.create({
      projectId: "project-1",
      name: "Scheduled tests",
      kind: "tests",
      prompt: "Run npm test",
      enabled: true,
      schedule: { cadence: "daily", time: "09:00" },
    });

    expect(snapshot.automations).toHaveLength(1);
    expect(snapshot.automations[0]).toMatchObject({
      id: "automation-1",
      projectId: "project-1",
      enabled: true,
      nextRunAt: new Date(2026, 6, 30, 9, 0).toISOString(),
    });
    expect(
      new AutomationStore(
        join(directories[0]!, "automations.json"),
      ).snapshot("project-1").automations,
    ).toHaveLength(1);
  });

  it("skips weekends and targets the configured weekly weekday", () => {
    const fridayEvening = new Date(2026, 6, 31, 18, 0);
    expect(
      nextAutomationRun(
        { cadence: "weekdays", time: "09:00" },
        fridayEvening,
      ).getDay(),
    ).toBe(1);
    expect(
      nextAutomationRun(
        { cadence: "weekly", weekday: 3, time: "10:15" },
        fridayEvening,
      ).getDay(),
    ).toBe(3);
  });

  it("recovers an interrupted run as failed on scheduler startup", () => {
    const now = new Date(2026, 6, 30, 8, 30);
    const store = createStore(now);
    store.create({
      projectId: "project-1",
      name: "Dependency audit",
      kind: "dependencies",
      prompt: "Audit dependencies",
      enabled: true,
      schedule: { cadence: "daily", time: "09:00" },
    });
    store.markStarted("automation-1", { scheduled: false });
    store.recoverInterruptedRuns();

    expect(store.get("automation-1")?.lastRun).toMatchObject({
      status: "failed",
      summary: "Threadlight closed before this automation finished.",
    });
  });
});

describe("AutomationScheduler", () => {
  it("runs a due scripted check, records attention, and notifies", async () => {
    const storedNow = new Date(2026, 6, 30, 8, 30);
    const store = createStore(storedNow);
    store.create({
      projectId: "project-1",
      name: "Scheduled tests",
      kind: "tests",
      prompt: "Run tests",
      enabled: true,
      schedule: { cadence: "daily", time: "09:00" },
    });
    const alerts: AutomationAlert[] = [];
    const execute = vi.fn(async () => ({
      threadId: "thread-1",
      output:
        "Two tests failed in workspace-panel.test.tsx.\nAUTOMATION_STATUS: attention",
    }));
    const scheduler = new AutomationScheduler(store, {
      now: () => new Date(2026, 6, 30, 9, 1),
      execute,
      notify: (alert) => alerts.push(alert),
    });

    await scheduler.tick();

    expect(execute).toHaveBeenCalledOnce();
    expect(store.get("automation-1")?.lastRun).toMatchObject({
      status: "attention",
      threadId: "thread-1",
      summary: "Two tests failed in workspace-panel.test.tsx.",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.status).toBe("attention");
  });

  it("keeps successful runs quiet and classifies runtime errors as failures", () => {
    expect(
      classifyAutomationResult({
        output: "All tests passed.\nAUTOMATION_STATUS: ok",
      }),
    ).toEqual({
      status: "succeeded",
      summary: "All tests passed.",
    });
    expect(classifyAutomationResult({ error: "Provider unavailable" })).toEqual({
      status: "failed",
      summary: "Provider unavailable",
    });
  });
});
