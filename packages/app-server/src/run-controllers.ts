import type {
  ModelAttachment,
  RunController,
  RunControllerContext,
  RunControllerModelDirective,
  RunControllerToolDecision,
  Tool,
  ToolCall,
  ToolResult,
} from "@threadlight/agent-loop";

const USER_ACTION_INSTRUCTIONS =
  "A tool cannot continue until the user completes an action in the host application. Do not call or suggest any tools, shell commands, alternate input modes, or workarounds. Briefly tell the user to follow the host application's prompt, then end the turn.";

export class UserActionRunController implements RunController {
  private waitingForUserAction = false;

  constructor(private readonly delegate?: RunController) {}

  async beforeModel(
    context: RunControllerContext,
  ): Promise<RunControllerModelDirective> {
    if (!this.waitingForUserAction) {
      return (await this.delegate?.beforeModel?.(context)) ?? {};
    }
    return {
      tools: [],
      instructions: USER_ACTION_INSTRUCTIONS,
      outputVisibility: "user",
    };
  }

  beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): RunControllerToolDecision | Promise<RunControllerToolDecision> {
    return this.delegate?.beforeToolCall?.(call, tool, context) ?? {
      allowed: true,
    };
  }

  async afterToolCall(
    call: ToolCall,
    result: ToolResult,
    context: RunControllerContext,
  ): Promise<void> {
    await this.delegate?.afterToolCall?.(call, result, context);
    if (result.error?.userAction) {
      this.waitingForUserAction = true;
    }
  }

  validateCompletion(
    turn: { text: string },
    context: RunControllerContext,
  ): string | undefined | Promise<string | undefined> {
    if (this.waitingForUserAction) return;
    return this.delegate?.validateCompletion?.(turn, context);
  }

  resolveCompletionOutput(
    turn: { text: string },
    context: RunControllerContext,
  ): string | undefined | Promise<string | undefined> {
    if (this.waitingForUserAction) return;
    return this.delegate?.resolveCompletionOutput?.(turn, context);
  }
}

export function composeRunControllers(
  controllers: readonly (RunController | undefined)[],
): RunController | undefined {
  const active = controllers.filter(
    (controller): controller is RunController => controller !== undefined,
  );
  if (active.length === 0) return;
  if (active.length === 1) return active[0];
  return new CompositeRunController(active);
}

class CompositeRunController implements RunController {
  constructor(private readonly controllers: readonly RunController[]) {}

  async beforeModel(
    context: RunControllerContext,
  ): Promise<RunControllerModelDirective> {
    const instructions: string[] = [];
    const attachments: ModelAttachment[] = [];
    let tools: readonly Tool[] | undefined;
    let outputVisibility: RunControllerModelDirective["outputVisibility"];

    for (const controller of this.controllers) {
      const directive = await controller.beforeModel?.(context);
      if (!directive) continue;
      if (directive.instructions) instructions.push(directive.instructions);
      if (directive.tools) {
        tools = narrowTools(tools ?? context.tools, directive.tools);
      }
      if (directive.attachments) attachments.push(...directive.attachments);
      if (directive.outputVisibility) {
        outputVisibility = directive.outputVisibility;
      }
    }

    return {
      ...(instructions.length > 0
        ? { instructions: instructions.join("\n\n") }
        : {}),
      ...(tools ? { tools } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(outputVisibility ? { outputVisibility } : {}),
    };
  }

  async beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): Promise<RunControllerToolDecision> {
    for (const controller of this.controllers) {
      const decision = await controller.beforeToolCall?.(call, tool, context);
      if (decision && !decision.allowed) return decision;
    }
    return { allowed: true };
  }

  async afterToolCall(
    call: ToolCall,
    result: ToolResult,
    context: RunControllerContext,
  ): Promise<void> {
    for (const controller of this.controllers) {
      await controller.afterToolCall?.(call, result, context);
    }
  }

  async validateCompletion(
    turn: { text: string },
    context: RunControllerContext,
  ): Promise<string | undefined> {
    for (const controller of this.controllers) {
      const error = await controller.validateCompletion?.(turn, context);
      if (error) return error;
    }
  }

  async resolveCompletionOutput(
    turn: { text: string },
    context: RunControllerContext,
  ): Promise<string | undefined> {
    for (const controller of this.controllers) {
      const output = await controller.resolveCompletionOutput?.(turn, context);
      if (output !== undefined) return output;
    }
  }
}

function narrowTools(
  current: readonly Tool[],
  requested: readonly Tool[],
): readonly Tool[] {
  const byName = new Map(requested.map((tool) => [tool.name, tool]));
  return current.flatMap((tool) => {
    const replacement = byName.get(tool.name);
    return replacement ? [replacement] : [];
  });
}
