import { describe, expect, it } from "vitest";

import type { ToolCall, ToolResult } from "@threadlight/agent-loop";

import { SkillReadRequirementController } from "../src/skill-read-requirement-controller.js";
import type { SkillReadRequirement } from "../src/capability-registry.js";

const REQUIREMENT: SkillReadRequirement = {
  ref: "skill:abc123",
  invocationName: "review-code",
  resources: [
    "/tmp/skills/review-code/references/checklist.md",
    "/tmp/skills/review-code/references/templates/issue.md",
  ],
};

function skillReadCall(skill: string, isError = false): { call: ToolCall; result: ToolResult } {
  return {
    call: { id: "c1", name: "skill_read", arguments: { skill } },
    result: {
      callId: "c1",
      name: "skill_read",
      output: isError ? "Unknown skill" : "REVIEW_WORKFLOW",
      ...(isError ? { isError: true } : {}),
    },
  };
}

function resourceReadCall(path: string, isError = false): { call: ToolCall; result: ToolResult } {
  return {
    call: { id: "c2", name: "capability_resource_read", arguments: { path } },
    result: {
      callId: "c2",
      name: "capability_resource_read",
      output: isError ? "not readable" : "CONTENT",
      ...(isError ? { isError: true } : {}),
    },
  };
}

describe("SkillReadRequirementController", () => {
  it("reminds the model until the skill has been read and rejects premature completion", () => {
    const controller = new SkillReadRequirementController([REQUIREMENT]);

    expect(controller.beforeModel().instructions).toContain(
      "Required skill read",
    );
    expect(controller.beforeModel().instructions).toContain("$review-code");
    expect(controller.validateCompletion()).toContain(
      "skill_read not called yet",
    );

    const { call, result } = skillReadCall("review-code");
    controller.afterToolCall(call, result);

    expect(controller.beforeModel()).toEqual({});
    // Skill read, but bundled resources are still missing.
    expect(controller.validateCompletion()).toContain(
      "bundled resources not read",
    );
  });

  it("accepts completion only after every bundled resource has been read", () => {
    const controller = new SkillReadRequirementController([REQUIREMENT]);
    controller.afterToolCall(...Object.values(skillReadCall("review-code")));

    controller.afterToolCall(
      ...Object.values(resourceReadCall(REQUIREMENT.resources[0]!)),
    );
    expect(controller.validateCompletion()).toContain(
      "bundled resources not read",
    );

    // Failed attempts still count: unreadable assets represent a full read.
    controller.afterToolCall(
      ...Object.values(resourceReadCall(REQUIREMENT.resources[1]!, true)),
    );
    expect(controller.validateCompletion()).toBeUndefined();
  });

  it("matches skill_read arguments by invocation name, capability ref, and skill id", () => {
    for (const argument of [
      "review-code",
      "skill:abc123",
      "abc123",
      "$review-code",
    ]) {
      const controller = new SkillReadRequirementController([REQUIREMENT]);
      controller.afterToolCall(...Object.values(skillReadCall(argument)));
      expect(
        controller.validateCompletion(),
        `argument ${argument}`,
      ).toContain("bundled resources not read");
    }
  });

  it("ignores failed skill_read calls and unrelated tools", () => {
    const controller = new SkillReadRequirementController([REQUIREMENT]);
    controller.afterToolCall(...Object.values(skillReadCall("review-code", true)));
    controller.afterToolCall({
      call: { id: "c3", name: "workspace_inspect", arguments: {} },
      result: { callId: "c3", name: "workspace_inspect", output: "{}" },
    } as never);
    expect(controller.validateCompletion()).toContain(
      "skill_read not called yet",
    );
  });

  it("rejects completion when a resource path is never touched", () => {
    const controller = new SkillReadRequirementController([
      {
        ref: "skill:def456",
        invocationName: "release-check",
        resources: ["/tmp/skills/release-check/checklist.md"],
      },
    ]);
    controller.afterToolCall(
      ...Object.values(skillReadCall("release-check")),
    );
    expect(controller.validateCompletion()).toContain("checklist.md");
  });
});
