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
