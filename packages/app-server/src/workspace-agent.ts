import {
  defineAgent,
  type Agent,
  type Tool,
} from "@threadlight/agent-loop";

import {
  loadWorkspaceContext,
  renderWorkspaceContext,
  type LoadWorkspaceContextOptions,
} from "./workspace-context.js";

export interface WorkspaceAgentFactoryOptions {
  workspaceRoot: string;
  baseInstructions: string;
  name?: string;
  model?: string;
  tools?: readonly Tool[];
  maxSteps?: number;
  context?: LoadWorkspaceContextOptions;
}

export const LOCAL_RESOURCE_LINK_INSTRUCTIONS =
  "When mentioning a local file or directory that the user may want to open, format it as a Markdown link using its absolute path, for example [report.pdf](/absolute/path/report.pdf) or [app.ts:42](/absolute/path/app.ts:42). Do not leave useful local resource paths as plain text or inline code.";

export function createWorkspaceAgentFactory(
  options: WorkspaceAgentFactoryOptions,
): () => Promise<Agent> {
  return async () => {
    const context = await loadWorkspaceContext(
      options.workspaceRoot,
      options.context,
    );

    return defineAgent({
      name: options.name ?? "threadlight",
      instructions: [
        options.baseInstructions.trim(),
        LOCAL_RESOURCE_LINK_INSTRUCTIONS,
        renderWorkspaceContext(context),
      ]
        .filter(Boolean)
        .join("\n\n"),
      model: options.model,
      tools: options.tools,
      maxSteps: options.maxSteps,
    });
  };
}
