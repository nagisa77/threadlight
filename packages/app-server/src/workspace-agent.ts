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
import {
  PromptComposer,
  type PromptBlock,
  type PromptSnapshot,
} from "./prompt-composer.js";

export interface WorkspaceAgentFactoryOptions {
  workspaceRoot: string;
  baseInstructions: string;
  name?: string;
  model?: string;
  tools?: readonly Tool[];
  maxSteps?: number;
  context?: LoadWorkspaceContextOptions;
  promptBlocks?: readonly PromptBlock[];
  includeWorkspaceContext?: boolean;
}

export const LOCAL_RESOURCE_LINK_INSTRUCTIONS =
  "When mentioning a local file or directory that the user may want to open, format it as a Markdown link using its absolute path, for example [report.pdf](/absolute/path/report.pdf) or [app.ts:42](/absolute/path/app.ts:42). Do not leave useful local resource paths as plain text or inline code.";

export interface WorkspaceAgent extends Agent {
  promptSnapshot: PromptSnapshot;
}

export function createWorkspaceAgentFactory(
  options: WorkspaceAgentFactoryOptions,
): () => Promise<WorkspaceAgent> {
  return async () => {
    const context =
      options.includeWorkspaceContext === false
        ? undefined
        : await loadWorkspaceContext(
            options.workspaceRoot,
            options.context,
          );
    const composer = new PromptComposer()
      .add({
        id: "host.base",
        version: 1,
        authority: "host",
        source: "workspace-agent",
        content: options.baseInstructions,
      })
      .add({
        id: "host.local-resource-links",
        version: 1,
        authority: "host",
        source: "workspace-agent",
        content: LOCAL_RESOURCE_LINK_INSTRUCTIONS,
      });
    if (context) {
      composer.add({
        id: "project.workspace-context",
        version: 1,
        authority: "project",
        source: context.root,
        content: renderWorkspaceContext(context),
      });
    }
    const promptSnapshot = composer
      .addAll(options.promptBlocks ?? [])
      .compose();

    return {
      ...defineAgent({
        name: options.name ?? "threadlight",
        instructions: promptSnapshot.instructions,
        model: options.model,
        tools: options.tools,
        maxSteps: options.maxSteps,
      }),
      promptSnapshot,
    };
  };
}
