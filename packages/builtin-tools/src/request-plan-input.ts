import { defineTool } from "@threadlight/agent-loop";

export const REQUEST_PLAN_INPUT_TOOL_NAME = "request_plan_input";

export function createRequestPlanInputTool() {
  return defineTool({
    name: REQUEST_PLAN_INPUT_TOOL_NAME,
    mutability: "read",
    description:
      "End the current Plan-mode turn with one blocking question before a plan is created. Use only when essential user input is missing and no valid turn-scoped plan can proceed without it. Never use this to answer an informational request, ask what future task to do, or avoid an available execution capability.",
    parameters: {
      type: "object",
      properties: {
        missing_information: {
          type: "string",
          minLength: 1,
          maxLength: 1000,
          description:
            "The specific user-supplied fact or decision that is required before any valid plan can proceed.",
        },
        question: {
          type: "string",
          minLength: 1,
          maxLength: 8000,
          description:
            "The complete, self-contained user-facing blocking question. Include every option or piece of context it references; never refer to hidden text as above, below, or earlier.",
        },
      },
      required: ["missing_information", "question"],
      additionalProperties: false,
    },
    async execute(arguments_) {
      if (!isObject(arguments_)) {
        throw new Error("request_plan_input arguments must be an object");
      }
      const missingInformation =
        typeof arguments_.missing_information === "string"
          ? arguments_.missing_information.trim()
          : "";
      if (!missingInformation || missingInformation.length > 1000) {
        throw new Error(
          "request_plan_input missing_information must be 1-1000 characters",
        );
      }
      const question =
        typeof arguments_.question === "string"
          ? arguments_.question.trim()
          : "";
      if (!question || question.length > 8000) {
        throw new Error(
          "request_plan_input question must be 1-8000 characters",
        );
      }
      return question;
    },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
