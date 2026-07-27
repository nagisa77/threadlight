import type {
  RunController,
  RunControllerContext,
  RunControllerModelDirective,
  RunControllerToolDecision,
  Tool,
  ToolCall,
  ToolResult,
} from "@threadlight/agent-loop";

import {
  parsePlanSnapshot,
  type PlanItem,
  type PlanSnapshot,
  UPDATE_PLAN_TOOL_NAME,
} from "./update-plan.js";

export type PlanExecutionPhase = "research" | "execution" | "complete";

/**
 * Turns a model-authored plan into runtime execution control.
 *
 * The controller deliberately depends only on provider-neutral loop hooks:
 * adapters continue to receive ordinary instructions, tools, calls, results,
 * and opaque model state.
 */
export class PlanExecutionController implements RunController {
  private snapshotValue: PlanSnapshot | undefined;
  private readonly pendingUpdates = new Map<string, PlanSnapshot>();
  private readonly successfulTools: string[] = [];

  get snapshot(): PlanSnapshot | undefined {
    return this.snapshotValue;
  }

  get phase(): PlanExecutionPhase {
    if (!this.snapshotValue) return "research";
    return this.snapshotValue.plan.every(
      (item) => item.status === "completed",
    )
      ? "complete"
      : "execution";
  }

  beforeModel(
    context: RunControllerContext,
  ): RunControllerModelDirective {
    if (this.phase === "research") {
      return {
        tools: context.tools.filter(isResearchTool),
        instructions: [
          "PLAN CONTROL — RESEARCH PHASE",
          "Inspect the relevant workspace and context before creating the plan.",
          "Only read-only tools and update_plan are available. Do not claim implementation work has started.",
          "When the evidence is sufficient, call update_plan with an ordered plan containing no completed steps and exactly one in_progress step.",
        ].join("\n"),
      };
    }

    const snapshot = this.snapshotValue as PlanSnapshot;
    if (this.phase === "complete") {
      return {
        tools: context.tools.filter(isResearchTool),
        instructions: [
          "PLAN CONTROL — COMPLETE",
          "Every controlled plan step is completed. Summarize the outcome and the recorded verification evidence.",
          "Do not perform additional write operations unless the plan is explicitly revised first.",
        ].join("\n"),
      };
    }

    const activeIndex = snapshot.plan.findIndex(
      (item) => item.status === "in_progress",
    );
    const active = snapshot.plan[activeIndex] as PlanItem;
    const recentTools =
      this.successfulTools.length > 0
        ? this.successfulTools.slice(-8).join(", ")
        : "none yet";
    return {
      instructions: [
        "PLAN CONTROL — EXECUTION PHASE",
        `Current step ${activeIndex + 1}/${snapshot.plan.length}: ${active.step}`,
        `Details: ${active.details}`,
        "Acceptance criteria:",
        ...active.acceptanceCriteria.map(
          (criterion, index) => `${index + 1}. ${criterion}`,
        ),
        `Successful tools observed for this step: ${recentTools}`,
        "Work only on this current step. Do not skip pending steps or silently change their definitions.",
        "Before advancing, verify the acceptance criteria, then call update_plan with completionEvidence for this step and make the immediately following step in_progress.",
        "If new evidence invalidates the remaining plan, revise it with a non-empty revisionReason while preserving completed steps.",
      ].join("\n"),
    };
  }

  beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
  ): RunControllerToolDecision {
    if (call.name === UPDATE_PLAN_TOOL_NAME) {
      let next: PlanSnapshot;
      try {
        next = parsePlanSnapshot(call.arguments);
        validatePlanTransition(this.snapshotValue, next);
      } catch (error) {
        return {
          allowed: false,
          message: `Plan update rejected by runtime control: ${errorMessage(error)}`,
        };
      }
      this.pendingUpdates.set(call.id, next);
      return { allowed: true };
    }

    if (this.phase === "research" && tool?.mutability !== "read") {
      return {
        allowed: false,
        message:
          "Write-capable tools are unavailable during Plan research. Inspect with read-only tools, then create the initial plan with update_plan.",
      };
    }

    if (this.phase === "complete" && tool?.mutability !== "read") {
      return {
        allowed: false,
        message:
          "The controlled plan is already complete. Revise the plan with revisionReason before performing additional writes.",
      };
    }

    return { allowed: true };
  }

  afterToolCall(
    call: ToolCall,
    result: ToolResult,
  ): void {
    if (call.name === UPDATE_PLAN_TOOL_NAME) {
      const pending = this.pendingUpdates.get(call.id);
      this.pendingUpdates.delete(call.id);
      if (!result.isError && pending) {
        const previousActive = activeStep(this.snapshotValue);
        this.snapshotValue = pending;
        if (activeStep(pending) !== previousActive) {
          this.successfulTools.length = 0;
        }
      }
      return;
    }

    if (!result.isError && this.phase === "execution") {
      this.successfulTools.push(call.name);
    }
  }

  validateCompletion(): string | undefined {
    if (!this.snapshotValue) {
      return [
        "The runtime rejected this final answer because Plan mode is still in research.",
        "Use the available read-only tools as needed, then call update_plan with the initial ordered execution plan.",
      ].join(" ");
    }

    const activeIndex = this.snapshotValue.plan.findIndex(
      (item) => item.status === "in_progress",
    );
    if (activeIndex >= 0) {
      const active = this.snapshotValue.plan[activeIndex] as PlanItem;
      return [
        `The runtime rejected this final answer because plan step ${activeIndex + 1}/${this.snapshotValue.plan.length} is still in_progress: ${active.step}.`,
        "Continue that step, verify its acceptance criteria, and update the plan with completionEvidence before attempting to finish.",
      ].join(" ");
    }

    const pending = this.snapshotValue.plan.findIndex(
      (item) => item.status === "pending",
    );
    if (pending >= 0) {
      return [
        `The runtime rejected this final answer because plan step ${pending + 1}/${this.snapshotValue.plan.length} is still pending.`,
        "Activate and execute it in order with update_plan.",
      ].join(" ");
    }
  }
}

function isResearchTool(tool: Tool): boolean {
  return (
    tool.name === UPDATE_PLAN_TOOL_NAME ||
    tool.mutability === "read"
  );
}

function validatePlanTransition(
  previous: PlanSnapshot | undefined,
  next: PlanSnapshot,
): void {
  validateLinearStatuses(next.plan);

  if (!previous) {
    if (next.revisionReason) {
      throw new Error("the initial plan must not include revisionReason");
    }
    if (next.plan.some((item) => item.status === "completed")) {
      throw new Error("the initial plan cannot contain completed steps");
    }
    if (!next.plan.some((item) => item.status === "in_progress")) {
      throw new Error("the initial plan requires exactly one in_progress step");
    }
    return;
  }

  if (!samePlanDefinition(previous.plan, next.plan)) {
    validateRevision(previous, next);
    return;
  }

  for (const [index, current] of previous.plan.entries()) {
    const candidate = next.plan[index] as PlanItem;
    if (current.status === "completed") {
      if (candidate.status !== "completed") {
        throw new Error(`completed step ${index + 1} cannot be reopened`);
      }
      if (!sameStrings(
        current.completionEvidence,
        candidate.completionEvidence,
      )) {
        throw new Error(
          `completion evidence for step ${index + 1} is immutable`,
        );
      }
      continue;
    }
    if (
      current.status === "pending" &&
      candidate.status === "completed"
    ) {
      throw new Error(`pending step ${index + 1} cannot be skipped`);
    }
    if (
      current.status === "in_progress" &&
      candidate.status === "completed" &&
      !candidate.completionEvidence?.length
    ) {
      throw new Error(
        `step ${index + 1} requires completionEvidence before completion`,
      );
    }
  }
}

function validateRevision(
  previous: PlanSnapshot,
  next: PlanSnapshot,
): void {
  if (!next.revisionReason) {
    throw new Error(
      "changing plan steps, details, or acceptance criteria requires revisionReason",
    );
  }

  const completed = previous.plan.filter(
    (item) => item.status === "completed",
  );
  for (const [index, item] of completed.entries()) {
    const candidate = next.plan[index];
    if (
      !candidate ||
      candidate.status !== "completed" ||
      !sameItem(item, candidate, true)
    ) {
      throw new Error(
        `revision must preserve completed step ${index + 1} and its evidence`,
      );
    }
  }
  if (
    next.plan
      .slice(completed.length)
      .some((item) => item.status === "completed")
  ) {
    throw new Error("revision cannot mark new steps completed");
  }
  if (
    next.plan.length > completed.length &&
    !next.plan.some((item) => item.status === "in_progress")
  ) {
    throw new Error("revised remaining work requires one in_progress step");
  }
}

function validateLinearStatuses(plan: readonly PlanItem[]): void {
  let phase: "completed" | "active" | "pending" = "completed";
  let active = 0;
  for (const item of plan) {
    if (item.status === "completed") {
      if (phase !== "completed") {
        throw new Error("completed steps must form a leading prefix");
      }
      if (!item.completionEvidence?.length) {
        throw new Error(
          `completed step "${item.step}" requires completionEvidence`,
        );
      }
      continue;
    }
    if (item.status === "in_progress") {
      if (phase !== "completed") {
        throw new Error("only the first unfinished step may be in_progress");
      }
      active += 1;
      phase = "active";
      continue;
    }
    phase = "pending";
  }
  if (active > 1) {
    throw new Error("plan may have only one in_progress step");
  }
  if (
    plan.some((item) => item.status !== "completed") &&
    active !== 1
  ) {
    throw new Error("unfinished work requires exactly one in_progress step");
  }
}

function samePlanDefinition(
  left: readonly PlanItem[],
  right: readonly PlanItem[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) =>
      sameItem(item, right[index] as PlanItem, false),
    )
  );
}

function sameItem(
  left: PlanItem,
  right: PlanItem,
  includeEvidence: boolean,
): boolean {
  return (
    left.step === right.step &&
    left.details === right.details &&
    sameStrings(left.acceptanceCriteria, right.acceptanceCriteria) &&
    (!includeEvidence ||
      sameStrings(left.completionEvidence, right.completionEvidence))
  );
}

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (
    (left?.length ?? 0) === (right?.length ?? 0) &&
    (left ?? []).every((value, index) => value === right?.[index])
  );
}

function activeStep(
  snapshot: PlanSnapshot | undefined,
): string | undefined {
  return snapshot?.plan.find((item) => item.status === "in_progress")?.step;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
