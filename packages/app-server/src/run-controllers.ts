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
import {
  ADVANCE_PLAN_TOOL_NAME,
  PROJECT_MEMORY_TOOL_NAME,
  REQUEST_PLAN_INPUT_TOOL_NAME,
  UPDATE_PLAN_TOOL_NAME,
} from "@threadlight/builtin-tools";

const USER_ACTION_INSTRUCTIONS =
  "A tool cannot continue until the user completes an action in the host application. Do not call or suggest any tools, shell commands, alternate input modes, or workarounds. Briefly tell the user to follow the host application's prompt, then end the turn.";

const WEB_SEARCH_TOOL_NAME = "web_search";

export class ProjectMemoryReminderController implements RunController {
  private memoryWasRead = false;
  private lastMemoryWrite = 0;
  private lastDurableMutation = 0;
  private sequence = 0;

  afterToolCall(
    call: ToolCall,
    result: ToolResult,
    context: RunControllerContext,
  ): void {
    if (result.isError) return;
    this.sequence += 1;

    if (call.name === PROJECT_MEMORY_TOOL_NAME) {
      const action = memoryAction(call.arguments);
      if (action === "read") this.memoryWasRead = true;
      if (action === "write") this.lastMemoryWrite = this.sequence;
      return;
    }

    const tool = context.tools.find(
      (candidate) => candidate.name === call.name,
    );
    if (
      tool?.mutability === "write" &&
      !isControlTool(call.name)
    ) {
      this.lastDurableMutation = this.sequence;
    }
  }

  validateCompletion(turn: { text: string }): string | undefined {
    if (
      !this.memoryWasRead ||
      this.lastDurableMutation <= this.lastMemoryWrite ||
      hasNoMemoryUpdateDecision(turn.text)
    ) {
      return;
    }
    return [
      "Before finishing, make an explicit project-memory decision.",
      "You read project memory and then completed durable changes, but no later memory write was observed.",
      "If the work established stable project-specific facts that will materially help future tasks, read project_memory again and write concise updated memory using its returned read_token.",
      "Otherwise finish after explicitly noting that no durable memory update is warranted.",
    ].join(" ");
  }
}

export class ResearchCoverageRunController implements RunController {
  private readonly broadResearchRequested: boolean;
  private readonly videoRequested: boolean;
  private readonly successfulDiscoveryQueries = new Set<string>();
  private successfulVideoDiscovery = false;
  private webSearchAvailable = false;

  constructor(input: string) {
    this.broadResearchRequested = requestsBroadResearch(input);
    this.videoRequested =
      this.broadResearchRequested && requestsVideoCoverage(input);
  }

  beforeModel(
    context: RunControllerContext,
  ): RunControllerModelDirective {
    if (!this.broadResearchRequested) return {};
    this.webSearchAvailable = context.tools.some(
      (tool) => tool.name === WEB_SEARCH_TOOL_NAME,
    );
    return {
      instructions: [
        "RESEARCH COVERAGE CONTROL",
        "Opening known URLs validates selected sources; it is not discovery search and does not justify claims of comprehensive or exhaustive coverage.",
        this.webSearchAvailable
          ? "Use web_search with multiple relevant queries before claiming broad internet coverage."
          : "web_search is unavailable in this runtime, so the final answer must include an explicit “Coverage limitation:” or “覆盖限制：” statement saying that broad discovery search was not performed.",
        "Keep a truthful boundary between sources actually discovered or checked and areas not searched.",
        this.videoRequested
          ? "The request includes video coverage. Search specifically for video sources; if that is not done, include an explicit “Video coverage limitation:” or “视频覆盖限制：” statement."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  afterToolCall(call: ToolCall, result: ToolResult): void {
    if (result.isError || call.name !== WEB_SEARCH_TOOL_NAME) return;
    const query = searchQuery(call.arguments);
    if (query) this.successfulDiscoveryQueries.add(query);
    const evidence = `${JSON.stringify(call.arguments)} ${result.output}`;
    if (/(?:video|youtube|bilibili|vimeo|视频|影片)/iu.test(evidence)) {
      this.successfulVideoDiscovery = true;
    }
  }

  validateCompletion(turn: { text: string }): string | undefined {
    if (!this.broadResearchRequested) return;
    if (
      this.successfulDiscoveryQueries.size < 2 &&
      !hasCoverageLimitation(turn.text)
    ) {
      return [
        "The final answer overstates research coverage.",
        `Only ${this.successfulDiscoveryQueries.size} distinct successful web_search discovery ${this.successfulDiscoveryQueries.size === 1 ? "query was" : "queries were"} observed; broad coverage requires multiple distinct searches.`,
        "Revise the answer to include an explicit “Coverage limitation:” or “覆盖限制：” statement explaining that broad discovery search was not established; do not call the result comprehensive or exhaustive.",
      ].join(" ");
    }
    if (
      this.videoRequested &&
      !this.successfulVideoDiscovery &&
      !hasVideoCoverageLimitation(turn.text)
    ) {
      return [
        "The requested video-source coverage was not verified.",
        "Revise the answer to include an explicit “Video coverage limitation:” or “视频覆盖限制：” statement, and do not imply that videos were comprehensively searched.",
      ].join(" ");
    }
  }
}

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

function memoryAction(value: unknown): "read" | "write" | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const action = (value as { action?: unknown }).action;
  return action === "read" || action === "write" ? action : undefined;
}

function hasNoMemoryUpdateDecision(text: string): boolean {
  return /(?:no durable (?:project )?memory update (?:is )?(?:needed|warranted)|无需更新.{0,8}(?:项目)?记忆|不需要更新.{0,8}(?:项目)?记忆|没有.{0,8}值得持久化.{0,8}(?:项目)?记忆)/iu.test(
    text,
  );
}

function isControlTool(name: string): boolean {
  return (
    name === UPDATE_PLAN_TOOL_NAME ||
    name === ADVANCE_PLAN_TOOL_NAME ||
    name === REQUEST_PLAN_INPUT_TOOL_NAME
  );
}

function requestsBroadResearch(input: string): boolean {
  return /(?:全面(?:收集|搜集|检索|搜索|调研|研究)|深度调研|互联网.{0,12}(?:资料|资源|来源|研究)|网上.{0,12}(?:资料|资源|来源)|\b(?:comprehensive|exhaustive)\s+(?:web|internet|online|source|research)|\b(?:internet|web)\s+research\b)/iu.test(
    input,
  );
}

function searchQuery(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const query = (value as { query?: unknown }).query;
  if (typeof query !== "string") return;
  const normalized = query.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return normalized || undefined;
}

function requestsVideoCoverage(input: string): boolean {
  return /(?:视频|影片|\bvideos?\b|\byoutube\b|\bbilibili\b)/iu.test(
    input,
  );
}

function hasCoverageLimitation(text: string): boolean {
  return /(?:覆盖限制\s*[：:]|coverage limitation\s*:)/iu.test(text);
}

function hasVideoCoverageLimitation(text: string): boolean {
  return /(?:视频覆盖限制\s*[：:]|video coverage limitation\s*:)/iu.test(
    text,
  );
}
