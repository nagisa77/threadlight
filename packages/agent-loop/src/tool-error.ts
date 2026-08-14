import type { ToolErrorMetadata } from "./types.js";

export class ToolExecutionError extends Error {
  readonly toolError: ToolErrorMetadata;

  constructor(message: string, toolError: ToolErrorMetadata) {
    super(message);
    this.name = "ToolExecutionError";
    this.toolError = toolError;
  }
}

export function toolErrorMetadata(
  error: unknown,
): ToolErrorMetadata | undefined {
  return error instanceof ToolExecutionError ? error.toolError : undefined;
}
