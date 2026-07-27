import { defineTool, type ToolContext } from "@threadlight/agent-loop";

export const UPDATE_PLAN_TOOL_NAME = "update_plan";

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  step: string;
  status: PlanItemStatus;
}

export interface PlanSnapshot {
  explanation?: string;
  plan: readonly PlanItem[];
}

export interface UpdatePlanToolOptions {
  onUpdate?(
    snapshot: PlanSnapshot,
    context: ToolContext,
  ): void | Promise<void>;
}

export const USER_SELECTED_PLAN_INSTRUCTIONS = [
  "The user explicitly selected Plan mode for this turn.",
  "Before using any other tool, call update_plan with a concise, actionable plan.",
  "Keep exactly one step in_progress while work remains, mark steps completed as you finish them, and call update_plan whenever the active step changes.",
  "Do not end the turn while plan steps remain pending or in_progress unless you are genuinely blocked; if blocked, explain why in the final response.",
].join(" ");

export function createUpdatePlanTool(
  options: UpdatePlanToolOptions = {},
) {
  return defineTool({
    name: UPDATE_PLAN_TOOL_NAME,
    description:
      "Create or update the task plan shown to the user. Use this proactively for multi-step work that benefits from explicit progress tracking, even when the user did not select Plan mode. Keep steps concise, use pending/in_progress/completed statuses, and keep at most one step in_progress.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description:
            "Optional concise reason for creating or materially changing the plan.",
        },
        plan: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              step: {
                type: "string",
                minLength: 1,
                maxLength: 200,
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
            required: ["step", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["plan"],
      additionalProperties: false,
    },
    async execute(arguments_, context) {
      const snapshot = parsePlanSnapshot(arguments_);
      await options.onUpdate?.(snapshot, context);
      return snapshot;
    },
  });
}

export function parsePlanSnapshot(value: unknown): PlanSnapshot {
  if (!isObject(value) || !Array.isArray(value.plan)) {
    throw new Error("plan must be an array");
  }
  if (value.plan.length < 1 || value.plan.length > 20) {
    throw new Error("plan must contain between 1 and 20 steps");
  }

  let activeSteps = 0;
  const seen = new Set<string>();
  const plan = value.plan.map((candidate, index): PlanItem => {
    if (!isObject(candidate)) {
      throw new Error(`plan[${index}] must be an object`);
    }
    const step =
      typeof candidate.step === "string"
        ? candidate.step.replace(/\s+/g, " ").trim()
        : "";
    if (!step || step.length > 200) {
      throw new Error(`plan[${index}].step must be 1-200 characters`);
    }
    if (seen.has(step)) {
      throw new Error("plan steps must be unique");
    }
    seen.add(step);

    const status = candidate.status;
    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "completed"
    ) {
      throw new Error(
        `plan[${index}].status must be pending, in_progress, or completed`,
      );
    }
    if (status === "in_progress") activeSteps += 1;
    return { step, status };
  });
  if (activeSteps > 1) {
    throw new Error("plan may have at most one in_progress step");
  }

  const explanation =
    typeof value.explanation === "string"
      ? value.explanation.replace(/\s+/g, " ").trim()
      : undefined;
  if (value.explanation !== undefined && !explanation) {
    throw new Error("explanation must not be empty");
  }
  if (explanation && explanation.length > 500) {
    throw new Error("explanation must be at most 500 characters");
  }
  return {
    ...(explanation ? { explanation } : {}),
    plan,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
