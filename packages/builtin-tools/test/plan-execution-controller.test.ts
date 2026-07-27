import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type AgentEvent,
  type ModelRequest,
} from "@threadlight/agent-loop";

import {
  createRequestPlanInputTool,
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
  it("preserves the complete blocking question as canonical output", async () => {
    const requests: ModelRequest[] = [];
    const events: AgentEvent[] = [];
    const question = [
      "Choose one direction:",
      "1. Calculate a password",
      "2. Improve the script",
      "3. Inspect firmware",
      "4. Describe another task",
    ].join("\n");
    const provider = {
      async generate(request: ModelRequest, options?: {
        onEvent?: (event: {
          type: "output_text.delta";
          delta: string;
        }) => void;
      }) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain(
            "Plans are scoped to this turn",
          );
          expect(request.tools.map((tool) => tool.name)).toContain(
            "request_plan_input",
          );
          return {
            text: "",
            toolCalls: [
              {
                id: "input-1",
                name: "request_plan_input",
                arguments: {
                  missing_information: "The task direction",
                  question,
                },
              },
            ],
          };
        }

        expect(request.instructions).toContain(
          "PLAN CONTROL — BLOCKING INPUT",
        );
        expect(request.instructions).toContain(
          "Output exactly and only that complete question",
        );
        expect(request.tools).toEqual([]);
        expect(request.toolResults).toMatchObject([
          {
            name: "request_plan_input",
            output: question,
          },
        ]);
        options?.onEvent?.({
          type: "output_text.delta",
          delta: "Choose one direction:\n",
        });
        options?.onEvent?.({
          type: "output_text.delta",
          delta: "1. Calculate a password\n2. Improve the script\n3. Inspect firmware\n4. Describe another task",
        });
        return { text: question, toolCalls: [] };
      },
    };
    const controller = new PlanExecutionController();

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "controlled",
        instructions: "Follow runtime control",
        tools: [
          createRequestPlanInputTool(),
          createUpdatePlanTool(),
        ],
      }),
      "Continue",
      { controller, onEvent: (event) => events.push(event) },
    );

    expect(result.output).toBe(question);
    expect(result.steps).toBe(2);
    expect(controller.snapshot).toBeUndefined();
    expect(controller.phase).toBe("needs_input");
    expect(
      events.filter(
        (event) => event.type === "model.output_text.delta",
      ),
    ).toMatchObject([
      {
        delta: "Choose one direction:\n",
        outputVisibility: "user",
      },
      {
        delta:
          "1. Calculate a password\n2. Improve the script\n3. Inspect firmware\n4. Describe another task",
        outputVisibility: "user",
      },
    ]);
  });

  it("researches read-only, injects the current step, and rejects premature completion", async () => {
    const requests: ModelRequest[] = [];
    const events: AgentEvent[] = [];
    let writes = 0;
    const provider = {
      async generate(request: ModelRequest, options?: {
        onEvent?: (event: {
          type: "output_text.delta";
          delta: string;
        }) => void;
      }) {
        requests.push(request);
        switch (requests.length) {
          case 1:
            expect(request.tools.map((tool) => tool.name)).toEqual([
              "inspect",
              "computer",
              "update_plan",
            ]);
            expect(
              request.tools.find((tool) => tool.name === "computer")
                ?.description,
            ).toContain("Execution-only until update_plan");
            expect(request.instructions).toContain("RESEARCH PHASE");
            expect(request.instructions).toContain(
              "Do not claim a visible execution-only capability is unavailable",
            );
            options?.onEvent?.({
              type: "output_text.delta",
              delta: "I’ll inspect first.",
            });
            return {
              text: "I’ll inspect first.",
              toolCalls: [
                { id: "inspect-1", name: "inspect", arguments: {} },
              ],
            };
          case 2:
            return {
              text: "I’ll try the computer before planning.",
              toolCalls: [
                {
                  id: "computer-too-early",
                  name: "computer",
                  arguments: {},
                },
              ],
            };
          case 3:
            expect(request.toolResults).toMatchObject([
              {
                name: "computer",
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
                { id: "computer-1", name: "computer", arguments: {} },
              ],
            };
          case 6:
            expect(request.instructions).toContain(
              "Successful tools observed for this step: computer",
            );
            expect(
              request.tools.find((tool) => tool.name === "computer")
                ?.description,
            ).toBe("Control the visible computer");
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
            expect(request.tools.map((tool) => tool.name)).toContain(
              "computer",
            );
            options?.onEvent?.({
              type: "output_text.delta",
              delta: "Controlled work ",
            });
            options?.onEvent?.({
              type: "output_text.delta",
              delta: "complete",
            });
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
            name: "computer",
            kind: "computer",
            mutability: "write",
            description: "Control the visible computer",
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
      {
        controller: new PlanExecutionController(),
        onEvent: (event) => events.push(event),
      },
    );

    expect(result.output).toBe("Controlled work complete");
    expect(writes).toBe(1);
    expect(requests).toHaveLength(7);
    expect(
      events.filter(
        (event) => event.type === "model.output_text.delta",
      ),
    ).toMatchObject([
      {
        delta: "I’ll inspect first.",
        outputVisibility: "provisional",
      },
      {
        delta: "Controlled work ",
        outputVisibility: "user",
      },
      {
        delta: "complete",
        outputVisibility: "user",
      },
    ]);
  });

  it("does not request blocking input after the plan is created", async () => {
    const controller = new PlanExecutionController();
    const initial = {
      plan: [item("Implement control", "in_progress")],
    };
    await controller.beforeToolCall?.(
      { id: "plan-1", name: "update_plan", arguments: initial },
      createUpdatePlanTool(),
      { runId: "run-1", step: 1, tools: [] },
    );
    await controller.afterToolCall?.(
      { id: "plan-1", name: "update_plan", arguments: initial },
      {
        callId: "plan-1",
        name: "update_plan",
        output: "{}",
      },
      { runId: "run-1", step: 1, tools: [] },
    );

    const decision = await controller.beforeToolCall?.(
      {
        id: "input-1",
        name: "request_plan_input",
        arguments: {
          missing_information: "The deployment target",
          question: "Which target should I use?",
        },
      },
      createRequestPlanInputTool(),
      { runId: "run-1", step: 2, tools: [] },
    );

    expect(decision).toMatchObject({
      allowed: false,
      message: expect.stringContaining("before the turn-scoped plan"),
    });
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
