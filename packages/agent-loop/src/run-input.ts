import type { Tool, ToolCall, ToolResult } from "./types.js";

export function mergeAdditionalInput(
  current: string | undefined,
  additional: string | undefined,
): string | undefined {
  const next = additional?.trim();
  if (!next) return current;
  const block = `[Additional user instruction received while the run was active]\n${next}`;
  return current ? `${current}\n\n${block}` : block;
}

export function skippedToolResult(
  call: ToolCall,
  tools: readonly Tool[],
): ToolResult {
  const kind = tools.find(({ name }) => name === call.name)?.kind;
  return {
    callId: call.id,
    name: call.name,
    output:
      "Skipped because the user added a newer instruction. Re-evaluate the task before calling tools again.",
    ...(kind ? { kind } : {}),
    isError: true,
  };
}
