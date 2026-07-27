import { createHash } from "node:crypto";
import {
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { defineTool, type ToolContext } from "@threadlight/agent-loop";

export const UPDATE_PLAN_TOOL_NAME = "update_plan";

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  step: string;
  details: string;
  acceptanceCriteria: readonly string[];
  completionEvidence?: readonly string[];
  status: PlanItemStatus;
}

export interface PlanSnapshot {
  explanation?: string;
  revisionReason?: string;
  plan: readonly PlanItem[];
  documentPath?: string;
  documentVersion?: string;
}

export interface UpdatePlanToolOptions {
  workspaceRoot?: string;
  onUpdate?(
    snapshot: PlanSnapshot,
    context: ToolContext,
  ): void | Promise<void>;
}

export const USER_SELECTED_PLAN_INSTRUCTIONS = [
  "The user explicitly selected Plan mode for this turn.",
  "Begin by researching the relevant workspace and context with the read-only tools available during the research phase.",
  "After gathering enough evidence, call update_plan with a comprehensive, actionable plan; do not modify workspace or external state before that plan exists.",
  "Give every step a short UI title, concrete implementation details, and observable acceptance criteria so another model could execute it without guessing.",
  "The runtime controls execution order: keep exactly one step in_progress, work only on the injected current step, and provide completionEvidence when marking it completed.",
  "Never skip a pending step. If discoveries invalidate the plan, call update_plan with revisionReason and preserve every completed step.",
  "The runtime will reject premature completion while any step remains pending or in_progress.",
].join(" ");

export function createUpdatePlanTool(
  options: UpdatePlanToolOptions = {},
) {
  return defineTool({
    name: UPDATE_PLAN_TOOL_NAME,
    mutability: "write",
    description:
      "Create or update the structured execution plan for the current turn. Research relevant context before the initial plan. During controlled execution, keep exactly one step in_progress, add completionEvidence before completing it, and include revisionReason when changing the plan structure.",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description:
            "Optional overall goal, constraints, and approach for this turn.",
          maxLength: 2000,
        },
        revisionReason: {
          type: "string",
          description:
            "Why the plan structure must change after execution started. Omit for the initial plan and ordinary status updates.",
          maxLength: 1000,
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
                maxLength: 120,
                description:
                  "A concise action title for compact progress UI. Put implementation specifics in details.",
              },
              details: {
                type: "string",
                minLength: 1,
                maxLength: 2000,
                description:
                  "Concrete execution instructions including scope, relevant components or files, technical approach, edge cases, and constraints when known.",
              },
              acceptanceCriteria: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                description:
                  "Observable conditions that prove this step is complete.",
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: 500,
                },
              },
              completionEvidence: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                description:
                  "Concrete verification evidence for a completed step, such as tests, inspected output, or observed behavior. Required by controlled Plan mode when transitioning a step to completed.",
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: 500,
                },
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
            required: [
              "step",
              "details",
              "acceptanceCriteria",
              "status",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["plan"],
      additionalProperties: false,
    },
    async execute(arguments_, context) {
      const update = parsePlanSnapshot(arguments_);
      const document = options.workspaceRoot
        ? await writePlanDocument(options.workspaceRoot, update, context)
        : undefined;
      const snapshot: PlanSnapshot = {
        ...update,
        ...(document ?? {}),
      };
      await options.onUpdate?.(snapshot, context);
      return snapshot;
    },
  });
}

export function renderPlanDocument(snapshot: PlanSnapshot): string {
  const completed = snapshot.plan.filter(
    (item) => item.status === "completed",
  ).length;
  const lines = [
    "# Plan",
    "",
    `Progress: ${completed} / ${snapshot.plan.length}`,
  ];
  if (snapshot.explanation) {
    lines.push("", snapshot.explanation);
  }
  if (snapshot.revisionReason) {
    lines.push("", `**Revision reason:** ${snapshot.revisionReason}`);
  }
  lines.push("", "## Steps");
  for (const [index, item] of snapshot.plan.entries()) {
    const status =
      item.status === "completed"
        ? "Completed"
        : item.status === "in_progress"
          ? "In progress"
          : "Pending";
    lines.push(
      "",
      `### ${index + 1}. ${item.step}`,
      "",
      `**Status:** ${status}`,
      "",
      item.details,
      "",
      "**Acceptance criteria:**",
      "",
    );
    const checked = item.status === "completed" ? "x" : " ";
    for (const criterion of item.acceptanceCriteria) {
      lines.push(`- [${checked}] ${criterion}`);
    }
    if (item.completionEvidence?.length) {
      lines.push("", "**Completion evidence:**", "");
      for (const evidence of item.completionEvidence) {
        lines.push(`- ${evidence}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
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
    if (!step || step.length > 120) {
      throw new Error(`plan[${index}].step must be 1-120 characters`);
    }
    if (seen.has(step)) {
      throw new Error("plan steps must be unique");
    }
    seen.add(step);

    const details =
      typeof candidate.details === "string"
        ? candidate.details.replace(/\s+/g, " ").trim()
        : "";
    if (!details || details.length > 2000) {
      throw new Error(
        `plan[${index}].details must be 1-2000 characters`,
      );
    }
    if (
      !Array.isArray(candidate.acceptanceCriteria) ||
      candidate.acceptanceCriteria.length < 1 ||
      candidate.acceptanceCriteria.length > 8
    ) {
      throw new Error(
        `plan[${index}].acceptanceCriteria must contain 1-8 items`,
      );
    }
    const criteriaSeen = new Set<string>();
    const acceptanceCriteria = candidate.acceptanceCriteria.map(
      (criterion, criterionIndex) => {
        const normalized =
          typeof criterion === "string"
            ? criterion.replace(/\s+/g, " ").trim()
            : "";
        if (!normalized || normalized.length > 500) {
          throw new Error(
            `plan[${index}].acceptanceCriteria[${criterionIndex}] must be 1-500 characters`,
          );
        }
        if (criteriaSeen.has(normalized)) {
          throw new Error(
            `plan[${index}].acceptanceCriteria items must be unique`,
          );
        }
        criteriaSeen.add(normalized);
        return normalized;
      },
    );
    let completionEvidence: readonly string[] | undefined;
    if (candidate.completionEvidence !== undefined) {
      if (
        !Array.isArray(candidate.completionEvidence) ||
        candidate.completionEvidence.length < 1 ||
        candidate.completionEvidence.length > 8
      ) {
        throw new Error(
          `plan[${index}].completionEvidence must contain 1-8 items`,
        );
      }
      const evidenceSeen = new Set<string>();
      completionEvidence = candidate.completionEvidence.map(
        (evidence, evidenceIndex) => {
          const normalized =
            typeof evidence === "string"
              ? evidence.replace(/\s+/g, " ").trim()
              : "";
          if (!normalized || normalized.length > 500) {
            throw new Error(
              `plan[${index}].completionEvidence[${evidenceIndex}] must be 1-500 characters`,
            );
          }
          if (evidenceSeen.has(normalized)) {
            throw new Error(
              `plan[${index}].completionEvidence items must be unique`,
            );
          }
          evidenceSeen.add(normalized);
          return normalized;
        },
      );
    }

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
    return {
      step,
      details,
      acceptanceCriteria,
      ...(completionEvidence ? { completionEvidence } : {}),
      status,
    };
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
  if (explanation && explanation.length > 2000) {
    throw new Error("explanation must be at most 2000 characters");
  }
  const revisionReason =
    typeof value.revisionReason === "string"
      ? value.revisionReason.replace(/\s+/g, " ").trim()
      : undefined;
  if (value.revisionReason !== undefined && !revisionReason) {
    throw new Error("revisionReason must not be empty");
  }
  if (revisionReason && revisionReason.length > 1000) {
    throw new Error("revisionReason must be at most 1000 characters");
  }
  return {
    ...(explanation ? { explanation } : {}),
    ...(revisionReason ? { revisionReason } : {}),
    plan,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function writePlanDocument(
  workspaceRoot: string,
  snapshot: PlanSnapshot,
  context: ToolContext,
): Promise<Pick<PlanSnapshot, "documentPath" | "documentVersion">> {
  const root = await realpath(resolve(workspaceRoot));
  const threadlightDirectory = resolve(root, ".threadlight");
  await mkdir(threadlightDirectory, { recursive: true, mode: 0o700 });
  const threadlightStorage = await realpath(threadlightDirectory);
  if (
    threadlightStorage !== root &&
    !threadlightStorage.startsWith(`${root}${sep}`)
  ) {
    throw new Error(".threadlight resolves outside the workspace");
  }
  const directory = resolve(threadlightStorage, "plans");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storage = await realpath(directory);
  if (storage !== root && !storage.startsWith(`${root}${sep}`)) {
    throw new Error("Plan document directory resolves outside the workspace");
  }

  const scope = safeDocumentId(context.runId);
  const run = safeDocumentId(context.runId);
  const path = resolve(storage, `${scope}.md`);
  const content = renderPlanDocument(snapshot);
  const temporary = resolve(storage, `.${scope}.${run}.tmp`);
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    documentPath: relative(root, path).split(sep).join("/"),
    documentVersion: createHash("sha256")
      .update(content)
      .digest("hex")
      .slice(0, 16),
  };
}

function safeDocumentId(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : createHash("sha256").update(value).digest("hex").slice(0, 24);
}
