import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelRequest,
} from "@threadlight/agent-loop";

import {
  createUpdatePlanTool,
  PlanExecutionController,
} from "../src/index.js";

function item(
  step: string,
  status: "pending" | "in_progress" | "completed",
  completionEvidence?: readonly string[],
) {
  return {
    step,
    details: `Execute ${step} against the inspected implementation.`,
    acceptanceCriteria: [`${step} has observable verification.`],
    ...(completionEvidence ? { completionEvidence } : {}),
    status,
  };
}

describe("PlanExecutionController", () => {
  it("researches read-only, injects the current step, and rejects premature completion", async () => {
    const requests: ModelRequest[] = [];
    let writes = 0;
    const provider = {
      async generate(request: ModelRequest) {
        requests.push(request);
        switch (requests.length) {
          case 1:
            expect(request.tools.map((tool) => tool.name)).toEqual([
              "inspect",
              "update_plan",
            ]);
            expect(request.instructions).toContain("RESEARCH PHASE");
            return {
              text: "I’ll inspect first.",
              toolCalls: [
                { id: "inspect-1", name: "inspect", arguments: {} },
              ],
            };
          case 2:
            return {
              text: "I’ll try to write before planning.",
              toolCalls: [
                { id: "write-too-early", name: "write", arguments: {} },
              ],
            };
          case 3:
            expect(request.toolResults).toMatchObject([
              {
                name: "write",
                isError: true,
                output: expect.stringContaining(
                  "unavailable during Plan research",
                ),
              },
            ]);
            return {
              text: "I have enough evidence.",
              toolCalls: [
                {
                  id: "plan-1",
                  name: "update_plan",
                  arguments: {
                    plan: [item("Implement control", "in_progress")],
                  },
                },
              ],
            };
          case 4:
            expect(request.instructions).toContain(
              "Current step 1/1: Implement control",
            );
            return { text: "Done too early", toolCalls: [] };
          case 5:
            expect(request.input).toContain(
              "runtime rejected this final answer",
            );
            return {
              text: "I’ll execute the active step.",
              toolCalls: [
                { id: "write-1", name: "write", arguments: {} },
              ],
            };
          case 6:
            expect(request.instructions).toContain(
              "Successful tools observed for this step: write",
            );
            return {
              text: "The step is verified.",
              toolCalls: [
                {
                  id: "plan-2",
                  name: "update_plan",
                  arguments: {
                    plan: [
                      item(
                        "Implement control",
                        "completed",
                        ["The scripted write completed successfully."],
                      ),
                    ],
                  },
                },
              ],
            };
          default:
            expect(request.instructions).toContain("PLAN CONTROL — COMPLETE");
            return { text: "Controlled work complete", toolCalls: [] };
        }
      },
    };

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "controlled",
        instructions: "Follow runtime control",
        tools: [
          defineTool({
            name: "inspect",
            mutability: "read",
            description: "Inspect state",
            parameters: { type: "object" },
            async execute() {
              return "inspected";
            },
          }),
          defineTool({
            name: "write",
            mutability: "write",
            description: "Change state",
            parameters: { type: "object" },
            async execute() {
              writes += 1;
              return "written";
            },
          }),
          createUpdatePlanTool(),
        ],
      }),
      "Implement the change",
      { controller: new PlanExecutionController() },
    );

    expect(result.output).toBe("Controlled work complete");
    expect(writes).toBe(1);
    expect(requests).toHaveLength(7);
  });

  it("rejects skipped steps and requires an explicit reason to replan", async () => {
    const controller = new PlanExecutionController();
    const initial = {
      plan: [
        item("Inspect architecture", "in_progress"),
        item("Implement change", "pending"),
      ],
    };
    const accepted = await controller.beforeToolCall?.(
      { id: "plan-1", name: "update_plan", arguments: initial },
      createUpdatePlanTool(),
      { runId: "run-1", step: 1, tools: [] },
    );
    expect(accepted).toEqual({ allowed: true });
    await controller.afterToolCall?.(
      { id: "plan-1", name: "update_plan", arguments: initial },
      {
        callId: "plan-1",
        name: "update_plan",
        output: "{}",
      },
      { runId: "run-1", step: 1, tools: [] },
    );

    const skipped = await controller.beforeToolCall?.(
      {
        id: "plan-2",
        name: "update_plan",
        arguments: {
          plan: [
            item(
              "Inspect architecture",
              "completed",
              ["Architecture inspected."],
            ),
            item(
              "Implement change",
              "completed",
              ["Implementation claimed without activation."],
            ),
          ],
        },
      },
      createUpdatePlanTool(),
      { runId: "run-1", step: 2, tools: [] },
    );
    expect(skipped).toMatchObject({
      allowed: false,
      message: expect.stringContaining("pending step 2 cannot be skipped"),
    });

    const silentReplan = await controller.beforeToolCall?.(
      {
        id: "plan-3",
        name: "update_plan",
        arguments: {
          plan: [item("Replace the approach", "in_progress")],
        },
      },
      createUpdatePlanTool(),
      { runId: "run-1", step: 2, tools: [] },
    );
    expect(silentReplan).toMatchObject({
      allowed: false,
      message: expect.stringContaining("requires revisionReason"),
    });

    const explicitReplan = await controller.beforeToolCall?.(
      {
        id: "plan-4",
        name: "update_plan",
        arguments: {
          revisionReason: "Inspection invalidated the original approach.",
          plan: [item("Replace the approach", "in_progress")],
        },
      },
      createUpdatePlanTool(),
      { runId: "run-1", step: 2, tools: [] },
    );
    expect(explicitReplan).toEqual({ allowed: true });
  });
});
