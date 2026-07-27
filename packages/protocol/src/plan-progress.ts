import type {
  AgentEventData,
  AgentPlanData,
  PlanItemData,
} from "./index.js";

export const UPDATE_PLAN_TOOL_NAME = "update_plan";

export function projectAgentPlan(
  plan: AgentPlanData | undefined,
  event: AgentEventData,
): AgentPlanData | undefined {
  if (
    event.type !== "tool.started" ||
    event.call.name !== UPDATE_PLAN_TOOL_NAME
  ) {
    return plan;
  }

  const update = parsePlanUpdate(event.call.arguments);
  if (!update) return plan;
  return {
    source: plan?.source ?? "model",
    ...(update.explanation ? { explanation: update.explanation } : {}),
    items: update.items,
  };
}

export function parsePlanUpdate(
  value: unknown,
): { explanation?: string; items: readonly PlanItemData[] } | undefined {
  if (!isObject(value) || !Array.isArray(value.plan)) return;
  if (value.plan.length < 1 || value.plan.length > 20) return;

  let activeSteps = 0;
  const seen = new Set<string>();
  const items: PlanItemData[] = [];
  for (const candidate of value.plan) {
    if (!isObject(candidate)) return;
    const step =
      typeof candidate.step === "string"
        ? candidate.step.replace(/\s+/g, " ").trim()
        : "";
    if (!step || step.length > 200 || seen.has(step)) return;
    seen.add(step);
    const status = candidate.status;
    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "completed"
    ) {
      return;
    }
    if (status === "in_progress") activeSteps += 1;
    items.push({ step, status });
  }
  if (activeSteps > 1) return;

  const explanation =
    typeof value.explanation === "string"
      ? value.explanation.replace(/\s+/g, " ").trim()
      : undefined;
  if (
    value.explanation !== undefined &&
    (!explanation || explanation.length > 500)
  ) {
    return;
  }
  return {
    ...(explanation ? { explanation } : {}),
    items,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
