import { serializeValue } from "./runtime-value.js";
import type {
  ModelConversationMessage,
  ToolCall,
  ToolResult,
} from "./types.js";

export function modelConversationMessageText(
  message: ModelConversationMessage,
): string {
  return [
    message.text,
    ...(message.toolCalls ?? []).map(toolCallText),
    ...(message.toolResults ?? []).map(toolResultText),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function toolCallText(call: ToolCall): string {
  return `<tool_call name=${JSON.stringify(call.name)} call_id=${JSON.stringify(call.id)}>\n${serializeValue(call.arguments)}\n</tool_call>`;
}

function toolResultText(result: ToolResult): string {
  return `<tool_result name=${JSON.stringify(result.name)} call_id=${JSON.stringify(result.callId)}${result.isError ? ' error="true"' : ""}>\n${result.output}\n</tool_result>`;
}
