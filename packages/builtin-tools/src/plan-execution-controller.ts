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
  ADVANCE_PLAN_TOOL_NAME,
  advancePlanSnapshot,
  parseCompletionEvidence,
  parsePlanSnapshot,
  type PlanItem,
  type PlanSnapshot,
  UPDATE_PLAN_TOOL_NAME,
} from "./update-plan.js";
import { PROJECT_MEMORY_TOOL_NAME } from "./project-memory.js";
import { REQUEST_PLAN_INPUT_TOOL_NAME } from "./request-plan-input.js";

export type PlanExecutionPhase =
  | "inactive"
  | "research"
  | "execution"
  | "needs_input"
  | "complete";

export interface PlanExecutionControllerOptions {
  /**
   * User-selected Plan mode requires research and a completed plan. Default
   * turns stay inactive until the model voluntarily creates a plan.
   */
  requirePlan?: boolean;
}

interface ToolIssueResolution {
  callId: string;
  resolution: string;
}

/**
 * Turns a model-authored plan into runtime execution control.
 *
 * The controller deliberately depends only on provider-neutral loop hooks:
 * adapters continue to receive ordinary instructions, tools, calls, results,
 * and opaque model state.
 */
export class PlanExecutionController implements RunController {
  private snapshotValue: PlanSnapshot | undefined;
  private turnResponse: string | undefined;
  private readonly pendingUpdates = new Map<string, PlanSnapshot>();
  private readonly successfulTools: string[] = [];
  private readonly unresolvedToolIssues = new Map<
    string,
    { name: string; outcome: "failed" | "warning" }
  >();
  private readonly pendingIssueResolutions = new Map<
    string,
    readonly ToolIssueResolution[]
  >();
  private readonly completedIssueResolutions: ToolIssueResolution[] = [];
  private readonly requirePlan: boolean;
  private advanceAvailable = false;

  constructor(options: PlanExecutionControllerOptions = {}) {
    this.requirePlan = options.requirePlan ?? true;
  }

  get snapshot(): PlanSnapshot | undefined {
    return this.snapshotValue;
  }

  get phase(): PlanExecutionPhase {
    if (this.turnResponse !== undefined) return "needs_input";
    if (!this.snapshotValue) {
      return this.requirePlan ? "research" : "inactive";
    }
    return this.snapshotValue.plan.every(
      (item) => item.status === "completed",
    )
      ? "complete"
      : "execution";
  }

  beforeModel(
    context: RunControllerContext,
  ): RunControllerModelDirective {
    this.advanceAvailable = context.tools.some(
      (tool) => tool.name === ADVANCE_PLAN_TOOL_NAME,
    );
    if (this.phase === "inactive") return {};

    if (this.phase === "needs_input") {
      return {
        tools: [],
        outputVisibility: "user",
        instructions: [
          "PLAN CONTROL — BLOCKING INPUT",
          "The preceding request_plan_input tool result contains the complete blocking question for this turn.",
          "Output exactly and only that complete question, character for character. Do not abbreviate it, refer to text above, add an acknowledgement, or introduce new work.",
          "Runtime control will preserve the tool result as the canonical user-facing output.",
        ].join("\n"),
      };
    }

    if (this.phase === "research") {
      return {
        tools: context.tools.map(advertiseResearchTool),
        outputVisibility: "provisional",
        instructions: [
          "PLAN CONTROL — RESEARCH PHASE",
          "Inspect the relevant workspace and context before creating the plan.",
          "All turn capabilities are visible for discovery. Tools marked execution-only cannot be called until update_plan creates the initial plan; runtime control will reject premature calls.",
          "Do not claim a visible execution-only capability is unavailable. Create the plan first, then use it during execution.",
          "Plans are scoped to this turn. Never add a step that waits for the user's next message or future task.",
          "Every answerable request, including informational analysis, must create and complete a plan.",
          "Only if essential user input is missing and no valid plan can proceed, call request_plan_input with one complete, self-contained blocking question. The reply starts a new turn and plan.",
          "When the evidence is sufficient, call update_plan with an ordered plan containing no completed steps and exactly one in_progress step.",
        ].join("\n"),
      };
    }

    const snapshot = this.snapshotValue as PlanSnapshot;
    if (this.phase === "complete") {
      const resolvedIssueSummary =
        this.completedIssueResolutions.length > 0
          ? this.completedIssueResolutions
              .map(
                ({ callId, resolution }) =>
                  `${callId}: ${resolution}`,
              )
              .join("\n")
          : "none";
      return {
        tools: context.tools,
        outputVisibility: "user",
        instructions: [
          "PLAN CONTROL — COMPLETE",
          "Every controlled plan step is completed. Summarize the outcome and the recorded verification evidence.",
          `Tool issues resolved during execution:\n${resolvedIssueSummary}`,
          "Preserve disclosed limitations in the final answer. Never claim a failed or warning check succeeded merely because an alternative path allowed the plan to continue.",
          "All turn tools remain advertised so provider-owned call state stays valid. Runtime control still rejects any tool call that is not allowed in this phase.",
          "Do not perform additional write operations unless the plan is explicitly revised first. A final project_memory read or write requested by runtime memory guidance is allowed without revising the plan.",
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
    const unresolvedIssues =
      this.unresolvedToolIssues.size > 0
        ? [...this.unresolvedToolIssues]
            .map(
              ([callId, issue]) =>
                `${callId} (${issue.name}, ${issue.outcome})`,
            )
            .join(", ")
        : "none";
    return {
      outputVisibility: "provisional",
      instructions: [
        "PLAN CONTROL — EXECUTION PHASE",
        `Current step ${activeIndex + 1}/${snapshot.plan.length}: ${active.step}`,
        `Details: ${active.details}`,
        "Acceptance criteria:",
        ...active.acceptanceCriteria.map(
          (criterion, index) => `${index + 1}. ${criterion}`,
        ),
        `Successful tools observed for this step: ${recentTools}`,
        `Unresolved tool issues for this step: ${unresolvedIssues}`,
        "Work only on this current step. Do not skip pending steps or silently change their definitions.",
        this.advanceAvailable
          ? "Before advancing, verify every acceptance criterion and provide exactly one completionEvidence item per criterion in the same order. If unresolved tool issues are listed, include every call id in issueResolutions with the recovery, alternative evidence, or limitation. Then call advance_plan."
          : "Before advancing, verify every acceptance criterion and provide exactly one completionEvidence item per criterion in the same order. If unresolved tool issues are listed, include every call id in issueResolutions. Then call update_plan with the unchanged full plan and next step in_progress.",
        "If new evidence invalidates the remaining plan, revise it with a non-empty revisionReason while preserving completed steps.",
      ].join("\n"),
    };
  }

  beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
  ): RunControllerToolDecision {
    if (call.name === REQUEST_PLAN_INPUT_TOOL_NAME) {
      if (this.phase !== "research") {
        return {
          allowed: false,
          message:
            "request_plan_input is only available before the turn-scoped plan is created",
        };
      }
      return { allowed: true };
    }

    if (call.name === UPDATE_PLAN_TOOL_NAME) {
      let next: PlanSnapshot;
      try {
        next = parsePlanSnapshot(call.arguments);
        if (
          this.snapshotValue &&
          this.advanceAvailable &&
          !next.revisionReason &&
          completesCurrentStep(this.snapshotValue, next)
        ) {
          throw new Error(
            "ordinary status transitions must use advance_plan with only completionEvidence; do not retransmit the plan",
          );
        }
        validatePlanTransition(this.snapshotValue, next);
        if (
          this.snapshotValue &&
          completesCurrentStep(this.snapshotValue, next)
        ) {
          this.validateIssueResolutions(call);
        }
      } catch (error) {
        return {
          allowed: false,
          message: `Plan update rejected by runtime control: ${errorMessage(error)}`,
        };
      }
      this.pendingUpdates.set(call.id, next);
      return { allowed: true };
    }

    if (call.name === ADVANCE_PLAN_TOOL_NAME) {
      let next: PlanSnapshot;
      try {
        if (this.phase !== "execution" || !this.snapshotValue) {
          throw new Error(
            "advance_plan requires an active in_progress plan step",
          );
        }
        next = advancePlanSnapshot(
          this.snapshotValue,
          parseCompletionEvidence(call.arguments),
        );
        this.validateIssueResolutions(call);
      } catch (error) {
        return {
          allowed: false,
          message: `Plan advance rejected by runtime control: ${errorMessage(error)}`,
        };
      }
      this.pendingUpdates.set(call.id, next);
      return { allowed: true };
    }

    if (
      this.phase === "research" &&
      tool?.mutability !== "read" &&
      !(
        call.name === PROJECT_MEMORY_TOOL_NAME &&
        projectMemoryAction(call.arguments) === "read"
      )
    ) {
      return {
        allowed: false,
        message:
          "Write-capable tools are unavailable during Plan research. Inspect with read-only tools, then create the initial plan with update_plan.",
      };
    }

    if (
      this.phase === "complete" &&
      tool?.mutability !== "read" &&
      call.name !== PROJECT_MEMORY_TOOL_NAME
    ) {
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
    if (call.name === REQUEST_PLAN_INPUT_TOOL_NAME) {
      if (!result.isError && this.phase === "research") {
        this.turnResponse = result.output;
      }
      return;
    }

    if (
      call.name === UPDATE_PLAN_TOOL_NAME ||
      call.name === ADVANCE_PLAN_TOOL_NAME
    ) {
      const pending = this.pendingUpdates.get(call.id);
      this.pendingUpdates.delete(call.id);
      const resolvedIssues = this.pendingIssueResolutions.get(call.id);
      this.pendingIssueResolutions.delete(call.id);
      if (!result.isError && pending) {
        const previousActive = activeStep(this.snapshotValue);
        this.snapshotValue = pending;
        if (activeStep(pending) !== previousActive) {
          this.successfulTools.length = 0;
          for (const resolution of resolvedIssues ?? []) {
            this.unresolvedToolIssues.delete(resolution.callId);
            this.completedIssueResolutions.push(resolution);
          }
        }
      }
      return;
    }

    if (this.phase === "execution") {
      const outcome = toolResultOutcome(result);
      if (outcome === "success") {
        this.successfulTools.push(call.name);
      } else {
        this.unresolvedToolIssues.set(call.id, {
          name: call.name,
          outcome,
        });
      }
    }
  }

  private validateIssueResolutions(call: ToolCall): void {
    const resolutions = parseIssueResolutions(call.arguments);
    const unresolved = [...this.unresolvedToolIssues.keys()];
    if (unresolved.length === 0) {
      if (resolutions.length > 0) {
        throw new Error(
          "issueResolutions must be omitted when there are no unresolved tool issues",
        );
      }
      return;
    }

    const resolved = new Set(resolutions.map(({ callId }) => callId));
    const missing = unresolved.filter((callId) => !resolved.has(callId));
    const unknown = [...resolved].filter(
      (callId) => !this.unresolvedToolIssues.has(callId),
    );
    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(
        [
          missing.length > 0
            ? `issueResolutions is missing: ${missing.join(", ")}`
            : "",
          unknown.length > 0
            ? `issueResolutions contains unknown call ids: ${unknown.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("; "),
      );
    }
    this.pendingIssueResolutions.set(call.id, resolutions);
  }

  validateCompletion(): string | undefined {
    if (this.phase === "needs_input") return;
    if (this.phase === "inactive") return;

    if (!this.snapshotValue) {
      return [
        "The runtime rejected this final answer because Plan mode is still in research.",
        "Use the available read-only tools as needed, then call update_plan with the initial ordered execution plan.",
        "Informational answers still require a completed plan.",
        "Only when essential input prevents any valid plan, call request_plan_input with one self-contained blocking question.",
      ].join(" ");
    }

    const activeIndex = this.snapshotValue.plan.findIndex(
      (item) => item.status === "in_progress",
    );
    if (activeIndex >= 0) {
      const active = this.snapshotValue.plan[activeIndex] as PlanItem;
      return [
        `The runtime rejected this final answer because plan step ${activeIndex + 1}/${this.snapshotValue.plan.length} is still in_progress: ${active.step}.`,
        this.advanceAvailable
          ? "Continue that step, verify its acceptance criteria, and call advance_plan with completionEvidence before attempting to finish."
          : "Continue that step, verify its acceptance criteria, and update the full plan with completionEvidence before attempting to finish.",
      ].join(" ");
    }

    const pending = this.snapshotValue.plan.findIndex(
      (item) => item.status === "pending",
    );
    if (pending >= 0) {
      return [
        `The runtime rejected this final answer because plan step ${pending + 1}/${this.snapshotValue.plan.length} is still pending.`,
        this.advanceAvailable
          ? "The active step must be completed in order with advance_plan before this pending step can begin."
          : "The active step must be completed in order with update_plan before this pending step can begin.",
      ].join(" ");
    }
  }

  resolveCompletionOutput(): string | undefined {
    return this.phase === "needs_input" ? this.turnResponse : undefined;
  }
}

function isResearchTool(tool: Tool): boolean {
  return (
    tool.name === UPDATE_PLAN_TOOL_NAME ||
    tool.name === REQUEST_PLAN_INPUT_TOOL_NAME ||
    tool.mutability === "read"
  );
}

function advertiseResearchTool(tool: Tool): Tool {
  if (isResearchTool(tool)) return tool;
  return {
    ...tool,
    description:
      `[Execution-only until update_plan creates the initial plan. ` +
      `Do not call during research.] ${tool.description}`,
  };
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
      if (
        item.completionEvidence.length !== item.acceptanceCriteria.length
      ) {
        throw new Error(
          `completed step "${item.step}" requires exactly one completionEvidence item per acceptance criterion`,
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

function completesCurrentStep(
  previous: PlanSnapshot,
  next: PlanSnapshot,
): boolean {
  const activeIndex = previous.plan.findIndex(
    (item) => item.status === "in_progress",
  );
  return (
    activeIndex >= 0 &&
    next.plan[activeIndex]?.status === "completed"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectMemoryAction(
  value: unknown,
): "read" | "write" | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const action = (value as { action?: unknown }).action;
  return action === "read" || action === "write" ? action : undefined;
}

function parseIssueResolutions(
  value: unknown,
): readonly ToolIssueResolution[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidate = (value as { issueResolutions?: unknown }).issueResolutions;
  if (candidate === undefined) return [];
  if (
    !Array.isArray(candidate) ||
    candidate.length < 1 ||
    candidate.length > 20
  ) {
    throw new Error("issueResolutions must contain 1-20 items");
  }
  const seen = new Set<string>();
  return candidate.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`issueResolutions[${index}] must be an object`);
    }
    const callId = (item as { callId?: unknown }).callId;
    const resolution = (item as { resolution?: unknown }).resolution;
    if (
      typeof callId !== "string" ||
      !callId.trim() ||
      callId.length > 256
    ) {
      throw new Error(
        `issueResolutions[${index}].callId must be 1-256 characters`,
      );
    }
    if (
      typeof resolution !== "string" ||
      !resolution.trim() ||
      resolution.length > 500
    ) {
      throw new Error(
        `issueResolutions[${index}].resolution must be 1-500 characters`,
      );
    }
    const normalizedCallId = callId.trim();
    if (seen.has(normalizedCallId)) {
      throw new Error("issueResolutions call ids must be unique");
    }
    seen.add(normalizedCallId);
    return {
      callId: normalizedCallId,
      resolution: resolution.replace(/\s+/g, " ").trim(),
    };
  });
}

function toolResultOutcome(
  result: ToolResult,
): "success" | "failed" | "warning" {
  if (result.isError) return "failed";
  try {
    const parsed = JSON.parse(result.output) as { status?: unknown };
    return parsed?.status === "completed_with_warnings"
      ? "warning"
      : "success";
  } catch {
    return "success";
  }
}
