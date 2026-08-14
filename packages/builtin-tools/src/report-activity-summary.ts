import { defineTool } from "@threadlight/agent-loop";

export const REPORT_ACTIVITY_SUMMARY_TOOL_NAME = "report_activity_summary";

export const REPORT_ACTIVITY_SUMMARY_INSTRUCTIONS =
  "Whenever a response contains one or more user-facing tool calls, also call report_activity_summary exactly once in the same response. Keep the normal user-facing preamble such as “I’ll inspect the configuration first,” and never mention this helper tool to the user. The summary must be a concise, neutral action phrase in the user's language: omit first-person wording, sequencing language, and unverified outcome claims. Do not call report_activity_summary by itself or for a batch containing only update_plan, advance_plan, or request_plan_input.";

export function createReportActivitySummaryTool() {
  return defineTool({
    name: REPORT_ACTIVITY_SUMMARY_TOOL_NAME,
    mutability: "read",
    presentation: {
      visibility: "hidden",
      activitySummaryArgument: "summary",
    },
    description:
      "Attach one concise, neutral display label to the other user-facing tool calls in this same response. Keep the normal user-facing preamble. Call this exactly once alongside the real tools, never by itself. Describe intended actions without first-person wording, sequencing language, or unverified outcomes.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description:
            "A concise neutral action phrase in the user's language, for example '检查配置并运行测试'.",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
    async execute(arguments_) {
      const summary = parseActivitySummary(arguments_);
      return { accepted: true, summary };
    },
  });
}

export function parseActivitySummary(arguments_: unknown): string {
  if (!isObject(arguments_)) {
    throw new Error("report_activity_summary arguments must be an object");
  }
  const summary =
    typeof arguments_.summary === "string"
      ? arguments_.summary.trim().replace(/\s+/g, " ")
      : "";
  if (!summary || summary.length > 80) {
    throw new Error("report_activity_summary summary must be 1-80 characters");
  }
  return summary;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
