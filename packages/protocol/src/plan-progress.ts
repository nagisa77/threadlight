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
    event.type === "tool.completed" &&
    event.result.name === UPDATE_PLAN_TOOL_NAME &&
    !event.result.isError
  ) {
    const document = parsePlanDocumentResult(event.result.output);
    if (!document) return plan;
    return {
      ...(plan ?? {
        source: "model",
        items: document.items ?? [],
      }),
      ...(document.explanation
        ? { explanation: document.explanation }
        : {}),
      ...(document.items ? { items: document.items } : {}),
      documentPath: document.documentPath,
      documentVersion: document.documentVersion,
    };
  }
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
    ...(plan?.documentPath
      ? { documentPath: plan.documentPath }
      : {}),
    ...(plan?.documentVersion
      ? { documentVersion: plan.documentVersion }
      : {}),
  };
}

function parsePlanDocumentResult(output: string): {
  explanation?: string;
  items?: readonly PlanItemData[];
  documentPath: string;
  documentVersion: string;
} | undefined {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return;
  }
  if (
    !isObject(value) ||
    typeof value.documentPath !== "string" ||
    !/^\.threadlight\/plans\/[A-Za-z0-9_-]+\.md$/.test(
      value.documentPath,
    ) ||
    typeof value.documentVersion !== "string" ||
    !/^[a-f0-9]{16}$/.test(value.documentVersion)
  ) {
    return;
  }
  const update = parsePlanUpdate(value);
  return {
    documentPath: value.documentPath,
    documentVersion: value.documentVersion,
    ...(update?.explanation
      ? { explanation: update.explanation }
      : {}),
    ...(update ? { items: update.items } : {}),
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
    if (!step || step.length > 120 || seen.has(step)) return;
    seen.add(step);
    const details =
      typeof candidate.details === "string"
        ? candidate.details.replace(/\s+/g, " ").trim()
        : undefined;
    if (
      candidate.details !== undefined &&
      (!details || details.length > 2000)
    ) {
      return;
    }
    let acceptanceCriteria: readonly string[] | undefined;
    if (candidate.acceptanceCriteria !== undefined) {
      if (
        !Array.isArray(candidate.acceptanceCriteria) ||
        candidate.acceptanceCriteria.length < 1 ||
        candidate.acceptanceCriteria.length > 8
      ) {
        return;
      }
      const criteriaSeen = new Set<string>();
      const criteria: string[] = [];
      for (const criterion of candidate.acceptanceCriteria) {
        const normalized =
          typeof criterion === "string"
            ? criterion.replace(/\s+/g, " ").trim()
            : "";
        if (
          !normalized ||
          normalized.length > 500 ||
          criteriaSeen.has(normalized)
        ) {
          return;
        }
        criteriaSeen.add(normalized);
        criteria.push(normalized);
      }
      acceptanceCriteria = criteria;
    }
    let completionEvidence: readonly string[] | undefined;
    if (candidate.completionEvidence !== undefined) {
      if (
        !Array.isArray(candidate.completionEvidence) ||
        candidate.completionEvidence.length < 1 ||
        candidate.completionEvidence.length > 8
      ) {
        return;
      }
      const evidenceSeen = new Set<string>();
      const evidence: string[] = [];
      for (const item of candidate.completionEvidence) {
        const normalized =
          typeof item === "string"
            ? item.replace(/\s+/g, " ").trim()
            : "";
        if (
          !normalized ||
          normalized.length > 500 ||
          evidenceSeen.has(normalized)
        ) {
          return;
        }
        evidenceSeen.add(normalized);
        evidence.push(normalized);
      }
      completionEvidence = evidence;
    }
    const status = candidate.status;
    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "completed"
    ) {
      return;
    }
    if (status === "in_progress") activeSteps += 1;
    items.push({
      step,
      ...(details ? { details } : {}),
      ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
      ...(completionEvidence ? { completionEvidence } : {}),
      status,
    });
  }
  if (activeSteps > 1) return;

  const explanation =
    typeof value.explanation === "string"
      ? value.explanation.replace(/\s+/g, " ").trim()
      : undefined;
  if (
    value.explanation !== undefined &&
    (!explanation || explanation.length > 2000)
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
