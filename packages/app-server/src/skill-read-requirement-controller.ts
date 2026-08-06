import type {
  RunController,
  RunControllerModelDirective,
  ToolCall,
  ToolResult,
} from "@threadlight/agent-loop";

import type { SkillReadRequirement } from "./capability-registry.js";

interface PendingSkillRead {
  requirement: SkillReadRequirement;
  skillRead: boolean;
  readResources: Set<string>;
}

/**
 * Enforces that every explicitly requested skill is actually read by the
 * model before the turn may complete.
 *
 * Full skill bodies are no longer injected for explicit skills; instead a
 * short required-read directive is injected and this controller:
 * - reminds the model each step until skill_read has been called,
 * - records capability_resource_read attempts for every bundled resource
 *   (recursive subdirectory resources under references/, agents/, scripts/
 *   and assets/), and
 * - rejects completion until the skill and all of its bundled resources
 *   have been read, so the model must keep working.
 */
export class SkillReadRequirementController implements RunController {
  private readonly pending: readonly PendingSkillRead[];

  constructor(requirements: readonly SkillReadRequirement[]) {
    this.pending = requirements.map((requirement) => ({
      requirement,
      skillRead: false,
      readResources: new Set(),
    }));
  }

  beforeModel(): RunControllerModelDirective {
    const pendingSkills = this.pending.filter(({ skillRead }) => !skillRead);
    if (pendingSkills.length === 0) return {};

    const lines: string[] = [
      "[BINDING] Required skill read",
      "The explicitly requested skill(s) below have not been loaded yet. Do this now before anything else:",
    ];
    for (const { requirement } of pendingSkills) {
      lines.push(
        `- $${requirement.invocationName}: call skill_read(skill="${requirement.invocationName}"), then read every bundled resource below with capability_resource_read.`,
      );
    }
    return { instructions: lines.join("\n") };
  }

  afterToolCall(call: ToolCall, result: ToolResult): void {
    if (call.name === "skill_read" && !result.isError) {
      const argument = skillReadArgument(call.arguments);
      if (argument === undefined) return;
      const pending = this.pending.find(({ requirement }) =>
        matchesSkillReference(requirement, argument),
      );
      if (pending) pending.skillRead = true;
      return;
    }
    if (call.name === "capability_resource_read") {
      const path = resourceReadPath(call.arguments);
      if (path === undefined) return;
      for (const pending of this.pending) {
        // Successful or failed attempts both count: unreadable resources
        // (binary assets, oversized files) still represent a full read.
        if (pending.requirement.resources.includes(path)) {
          pending.readResources.add(path);
        }
      }
    }
  }

  validateCompletion(): string | undefined {
    const missing: string[] = [];
    for (const { requirement, skillRead, readResources } of this.pending) {
      if (!skillRead) {
        missing.push(
          `- $${requirement.invocationName}: skill_read not called yet`,
        );
        continue;
      }
      const missingResources = requirement.resources.filter(
        (path) => !readResources.has(path),
      );
      if (missingResources.length > 0) {
        missing.push(
          `- $${requirement.invocationName}: bundled resources not read: ${missingResources.join(", ")}`,
        );
      }
    }
    if (missing.length === 0) return;

    return [
      "Before finishing, you must load the explicitly requested skill(s) in full.",
      ...missing,
      'Call skill_read(skill="<invocation>") for each skill, then call capability_resource_read for every bundled resource path listed in its result (recursive subdirectory resources under references/, agents/, scripts/ and assets/).',
    ].join("\n");
  }
}

function skillReadArgument(arguments_: unknown): string | undefined {
  if (!arguments_ || typeof arguments_ !== "object") return;
  const skill = (arguments_ as Record<string, unknown>).skill;
  if (typeof skill !== "string") return;
  const normalized = skill.trim().replace(/^\$/, "");
  return normalized || undefined;
}

function resourceReadPath(arguments_: unknown): string | undefined {
  if (!arguments_ || typeof arguments_ !== "object") return;
  const path = (arguments_ as Record<string, unknown>).path;
  return typeof path === "string" && path ? path : undefined;
}

function matchesSkillReference(
  requirement: SkillReadRequirement,
  argument: string,
): boolean {
  return (
    argument === requirement.invocationName ||
    argument === requirement.ref ||
    argument === requirement.ref.slice("skill:".length)
  );
}
