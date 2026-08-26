import type {
  ModelAttachment,
  RunController,
  Tool,
} from "@threadlight/agent-loop";
import {
  PlanExecutionController,
  createRequestPlanInputTool,
  USER_SELECTED_PLAN_INSTRUCTIONS,
} from "@threadlight/builtin-tools";
import type {
  ConversationAccessMode,
  MessageCitationData,
  MessageSourceData,
  TurnMode,
} from "@threadlight/protocol";

import type { ThreadRuntime } from "./app-server.js";
import {
  createAttachmentRuntime,
  type AttachmentProvider,
} from "./attachment-runtime.js";
import { CapabilityResourceController } from "./capability-resource-controller.js";
import type { CapabilityResource } from "./capability-registry.js";
import { ExecutionPolicyRunController } from "./execution-policy-controller.js";
import type { ExecutionApprovalRequester } from "./execution-policy-controller.js";
import {
  promptBlocksFromSnapshot,
  type PromptBlock,
  type PromptSnapshot,
} from "./prompt-composer.js";
import {
  composeRunControllers,
  ProjectMemoryReminderController,
  ResearchCoverageRunController,
  UserActionRunController,
} from "./run-controllers.js";
import { SkillReadRequirementController } from "./skill-read-requirement-controller.js";
import {
  SourceCitationRunController,
  type FinalizedSourceCitations,
} from "./source-citations.js";
import { TurnCapabilityController } from "./turn-capability-controller.js";
import { uniquePromptBlocks } from "./app-server-support.js";

const CONTROLLER_ORDER = {
  executionPolicy: 100,
  plan: 200,
  capability: 300,
  skillRead: 400,
  citations: 500,
  projectMemory: 600,
  researchCoverage: 700,
  attachments: 800,
} as const;

const PROMPT_ORDER = {
  snapshot: 100,
  runtime: 200,
  capability: 300,
  plan: 400,
} as const;

const TOOL_ORDER = {
  agent: 100,
  plan: 200,
  attachments: 300,
  capability: 400,
  extension: 1_000,
} as const;

/** A typed service exposed by one turn module to the runtime host or another module. */
export class TurnRuntimeServiceKey<Service> {
  readonly token: symbol;
  declare private readonly serviceType: Service;

  constructor(readonly name: string) {
    this.token = Symbol(name);
  }
}

export interface TurnPlanService {
  controller: PlanExecutionController;
}

export interface TurnCapabilityService {
  controller?: TurnCapabilityController;
}

export interface TurnCitationService {
  controller: SourceCitationRunController;
}

export const TURN_PLAN_SERVICE = new TurnRuntimeServiceKey<TurnPlanService>(
  "threadlight.turn.plan",
);
export const TURN_CAPABILITY_SERVICE =
  new TurnRuntimeServiceKey<TurnCapabilityService>(
    "threadlight.turn.capabilities",
  );
export const TURN_CITATION_SERVICE =
  new TurnRuntimeServiceKey<TurnCitationService>("threadlight.turn.citations");

export interface TurnRuntimeModuleContext {
  threadId: string;
  mode: TurnMode;
  accessMode: ConversationAccessMode;
  taskInput: string;
  input: string;
  provider?: string;
  attachments: readonly ModelAttachment[];
  capabilityRefs: readonly string[];
  signal: AbortSignal;
  agentTools: readonly Tool[];
  promptSnapshot: PromptSnapshot;
  threadRuntime?: ThreadRuntime;
  attachmentProvider?: AttachmentProvider;
  approval: {
    enabled: boolean;
    requester: ExecutionApprovalRequester;
  };
}

export interface TurnRuntimeModule {
  /** Stable id used for diagnostics, replacement, and duplicate detection. */
  id: string;
  setup(
    context: TurnRuntimeModuleContext,
    registrar: TurnRuntimeRegistrar,
  ):
    | void
    | TurnRuntimeModuleDisposer
    | Promise<void | TurnRuntimeModuleDisposer>;
}

export type TurnRuntimeModuleDisposer = () => void | Promise<void>;

export interface TurnRuntimeRegistrar {
  addTools(tools: readonly Tool[], order?: number): void;
  addPromptBlocks(blocks: readonly PromptBlock[], order?: number): void;
  addController(controller: RunController, order?: number): void;
  addChildController(factory: () => RunController, order?: number): void;
  wrapController(
    wrapper: (controller: RunController | undefined) => RunController,
    order?: number,
  ): void;
  wrapChildController(
    wrapper: (controller: RunController | undefined) => RunController,
    order?: number,
  ): void;
  addInputHandler(handler: TurnInputHandler): void;
  addOutputFinalizer(finalizer: TurnOutputFinalizer, order?: number): void;
  provide<Service>(key: TurnRuntimeServiceKey<Service>, service: Service): void;
  service<Service>(key: TurnRuntimeServiceKey<Service>): Service | undefined;
}

export interface TurnRuntimeOutput {
  text: string;
  sources: readonly MessageSourceData[];
  citations: readonly MessageCitationData[];
}

export interface TurnRuntimeComposition {
  /** Mutable by scoped capability activation while the turn is running. */
  readonly tools: readonly Tool[];
  readonly promptBlocks: readonly PromptBlock[];
  readonly controller?: RunController;
  readonly input: string;
  processInput(
    input: string,
    attachments: readonly ModelAttachment[],
  ): Promise<string>;
  createChildController(): RunController | undefined;
  finalizeOutput(text: string): Promise<TurnRuntimeOutput>;
  service<Service>(key: TurnRuntimeServiceKey<Service>): Service | undefined;
  dispose(): Promise<void>;
}

type TurnInputHandler = (
  input: string,
  attachments: readonly ModelAttachment[],
) => string | Promise<string>;

type TurnOutputFinalizer = (
  output: TurnRuntimeOutput,
) => TurnRuntimeOutput | Promise<TurnRuntimeOutput>;

interface Ordered<Value> {
  order: number;
  sequence: number;
  value: Value;
}

class TurnRuntimeBuilder implements TurnRuntimeRegistrar {
  private readonly tools: Tool[] = [];
  private readonly toolEntries: Array<Ordered<Tool>> = [];
  private readonly toolNames = new Set<string>();
  private readonly promptBlocks: Array<Ordered<PromptBlock>> = [];
  private readonly controllers: Array<Ordered<RunController>> = [];
  private readonly childControllers: Array<Ordered<() => RunController>> = [];
  private readonly wrappers: Array<
    Ordered<(controller: RunController | undefined) => RunController>
  > = [];
  private readonly childWrappers: Array<
    Ordered<(controller: RunController | undefined) => RunController>
  > = [];
  private readonly inputHandlers: TurnInputHandler[] = [];
  private readonly outputFinalizers: Array<Ordered<TurnOutputFinalizer>> = [];
  private readonly services = new Map<symbol, unknown>();
  private sequence = 0;

  constructor(tools: readonly Tool[], promptBlocks: readonly PromptBlock[]) {
    this.addTools(tools, TOOL_ORDER.agent);
    this.addPromptBlocks(promptBlocks, PROMPT_ORDER.snapshot);
  }

  addTools(tools: readonly Tool[], order: number = TOOL_ORDER.extension): void {
    for (const tool of tools) {
      if (this.toolNames.has(tool.name)) {
        throw new Error(`Duplicate tool: ${tool.name}`);
      }
      this.toolNames.add(tool.name);
      this.toolEntries.push({
        order,
        sequence: this.sequence++,
        value: tool,
      });
    }
    this.tools.splice(0, this.tools.length, ...orderedValues(this.toolEntries));
  }

  addPromptBlocks(blocks: readonly PromptBlock[], order = 0): void {
    for (const block of blocks) {
      this.promptBlocks.push({
        order,
        sequence: this.sequence++,
        value: block,
      });
    }
  }

  addController(controller: RunController, order = 0): void {
    this.controllers.push({
      order,
      sequence: this.sequence++,
      value: controller,
    });
  }

  addChildController(factory: () => RunController, order = 0): void {
    this.childControllers.push({
      order,
      sequence: this.sequence++,
      value: factory,
    });
  }

  wrapController(
    wrapper: (controller: RunController | undefined) => RunController,
    order = 0,
  ): void {
    this.wrappers.push({ order, sequence: this.sequence++, value: wrapper });
  }

  wrapChildController(
    wrapper: (controller: RunController | undefined) => RunController,
    order = 0,
  ): void {
    this.childWrappers.push({
      order,
      sequence: this.sequence++,
      value: wrapper,
    });
  }

  addInputHandler(handler: TurnInputHandler): void {
    this.inputHandlers.push(handler);
  }

  addOutputFinalizer(finalizer: TurnOutputFinalizer, order = 0): void {
    this.outputFinalizers.push({
      order,
      sequence: this.sequence++,
      value: finalizer,
    });
  }

  provide<Service>(
    key: TurnRuntimeServiceKey<Service>,
    service: Service,
  ): void {
    if (this.services.has(key.token)) {
      throw new Error(`Duplicate turn runtime service: ${key.name}`);
    }
    this.services.set(key.token, service);
  }

  service<Service>(key: TurnRuntimeServiceKey<Service>): Service | undefined {
    return this.services.get(key.token) as Service | undefined;
  }

  async build(
    input: string,
    attachments: readonly ModelAttachment[],
    disposers: readonly TurnRuntimeModuleDisposer[],
  ): Promise<TurnRuntimeComposition> {
    const processInput = async (
      nextInput: string,
      nextAttachments: readonly ModelAttachment[],
    ): Promise<string> => {
      let transformed = nextInput;
      for (const handler of this.inputHandlers) {
        transformed = await handler(transformed, nextAttachments);
      }
      return transformed;
    };
    const orderedControllers = orderedValues(this.controllers);
    let controller = composeRunControllers(orderedControllers);
    for (const wrapper of orderedValues(this.wrappers)) {
      controller = wrapper(controller);
    }
    const finalizers = orderedValues(this.outputFinalizers);
    const childControllerFactories = orderedValues(this.childControllers);
    const childWrappers = orderedValues(this.childWrappers);
    const services = this.services;
    let disposed = false;
    return {
      tools: this.tools,
      promptBlocks: uniquePromptBlocks(orderedValues(this.promptBlocks)),
      ...(controller ? { controller } : {}),
      input: await processInput(input, attachments),
      processInput,
      createChildController() {
        let childController = composeRunControllers(
          childControllerFactories.map((factory) => factory()),
        );
        for (const wrapper of childWrappers) {
          childController = wrapper(childController);
        }
        return childController;
      },
      async finalizeOutput(text) {
        let output: TurnRuntimeOutput = { text, sources: [], citations: [] };
        for (const finalizer of finalizers) output = await finalizer(output);
        return output;
      },
      service<Service>(
        key: TurnRuntimeServiceKey<Service>,
      ): Service | undefined {
        return services.get(key.token) as Service | undefined;
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        for (const disposer of [...disposers].reverse()) await disposer();
      },
    };
  }
}

function orderedValues<Value>(entries: readonly Ordered<Value>[]): Value[] {
  return [...entries]
    .sort((left, right) =>
      left.order === right.order
        ? left.sequence - right.sequence
        : left.order - right.order,
    )
    .map(({ value }) => value);
}

export async function composeTurnRuntime(
  modules: readonly TurnRuntimeModule[],
  context: TurnRuntimeModuleContext,
): Promise<TurnRuntimeComposition> {
  const ids = new Set<string>();
  const disposers: TurnRuntimeModuleDisposer[] = [];
  const builder = new TurnRuntimeBuilder(
    context.agentTools,
    promptBlocksFromSnapshot(context.promptSnapshot),
  );
  try {
    for (const module of modules) {
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(module.id)) {
        throw new Error(`Invalid turn runtime module id: ${module.id}`);
      }
      if (ids.has(module.id)) {
        throw new Error(`Duplicate turn runtime module: ${module.id}`);
      }
      ids.add(module.id);
      const disposer = await module.setup(context, builder);
      if (disposer) disposers.push(disposer);
    }
    return await builder.build(context.input, context.attachments, disposers);
  } catch (error) {
    for (const disposer of [...disposers].reverse()) await disposer();
    throw error;
  }
}

const runtimePromptModule: TurnRuntimeModule = {
  id: "threadlight.runtime-prompts",
  async setup(context, registrar) {
    registrar.addPromptBlocks(
      (await context.threadRuntime?.promptBlocksForTurn?.(context.taskInput)) ??
        [],
      PROMPT_ORDER.runtime,
    );
  },
};

const executionPolicyModule: TurnRuntimeModule = {
  id: "threadlight.execution-policy",
  setup(context, registrar) {
    if (!context.approval.enabled || context.accessMode === "full") return;
    registrar.addController(
      new ExecutionPolicyRunController(
        context.threadId,
        context.approval.requester,
        context.signal,
      ),
      CONTROLLER_ORDER.executionPolicy,
    );
    registrar.addChildController(
      () =>
        new ExecutionPolicyRunController(
          context.threadId,
          context.approval.requester,
          context.signal,
        ),
      CONTROLLER_ORDER.executionPolicy,
    );
  },
};

const planModule: TurnRuntimeModule = {
  id: "threadlight.plan",
  setup(context, registrar) {
    const controller = new PlanExecutionController({
      requirePlan: context.mode === "plan",
    });
    registrar.provide(TURN_PLAN_SERVICE, { controller });
    registrar.addController(controller, CONTROLLER_ORDER.plan);
    if (context.mode !== "plan") return;
    registrar.addTools([createRequestPlanInputTool()], TOOL_ORDER.plan);
    registrar.addPromptBlocks(
      [
        {
          id: "turn.plan-mode",
          version: 1,
          authority: "turn",
          source: "app-server",
          content: USER_SELECTED_PLAN_INSTRUCTIONS,
        },
      ],
      PROMPT_ORDER.plan,
    );
  },
};

const attachmentModule: TurnRuntimeModule = {
  id: "threadlight.attachments",
  setup(context, registrar) {
    const runtime = createAttachmentRuntime(context.attachmentProvider, "", []);
    let toolInstalled = false;
    registrar.addController(runtime.controller, CONTROLLER_ORDER.attachments);
    registrar.addInputHandler((input, attachments) => {
      const routedAttachments = context.provider
        ? attachments.map((attachment) => ({
            ...attachment,
            provider: context.provider,
          }))
        : attachments;
      if (routedAttachments.length > 0 && !toolInstalled) {
        registrar.addTools([runtime.tool], TOOL_ORDER.attachments);
        toolInstalled = true;
      }
      return runtime.addInput(input, routedAttachments);
    });
  },
};

const capabilityModule: TurnRuntimeModule = {
  id: "threadlight.capabilities",
  async setup(context, registrar) {
    const explicitSkillRefs = context.threadRuntime?.explicitSkillRefsForInput
      ? await context.threadRuntime.explicitSkillRefsForInput(context.taskInput)
      : [];
    const refs = [...context.capabilityRefs, ...explicitSkillRefs];
    const resolution = context.threadRuntime?.resolveCapabilities
      ? await context.threadRuntime.resolveCapabilities(
          refs,
          context.signal,
          "explicit",
        )
      : { promptBlocks: [], tools: [], resources: [], skillReads: [] };
    const resources = new CapabilityResourceController(
      resolution.resources ?? [],
    );
    registrar.addTools(resolution.tools, TOOL_ORDER.capability);
    if (resources.hasResources()) {
      registrar.addTools([resources.tool()], TOOL_ORDER.capability);
    }
    registrar.addPromptBlocks(resolution.promptBlocks, PROMPT_ORDER.capability);

    const controller =
      context.threadRuntime?.resolveCapabilities &&
      (context.threadRuntime.capabilities?.length ?? 0) > 0
        ? new TurnCapabilityController({
            capabilities: context.threadRuntime.capabilities ?? [],
            initialRefs: refs,
            resolve: context.threadRuntime.resolveCapabilities.bind(
              context.threadRuntime,
            ),
            addTools: (tools) =>
              registrar.addTools(tools, TOOL_ORDER.capability),
            addResources: (additions: readonly CapabilityResource[]) => {
              if (resources.add(additions)) {
                registrar.addTools([resources.tool()], TOOL_ORDER.capability);
              }
            },
          })
        : undefined;
    registrar.provide(TURN_CAPABILITY_SERVICE, { controller });
    if (controller) {
      registrar.addTools(controller.tools(), TOOL_ORDER.capability);
      registrar.addController(controller, CONTROLLER_ORDER.capability);
    }
    if ((resolution.skillReads ?? []).length > 0) {
      registrar.addController(
        new SkillReadRequirementController(resolution.skillReads ?? []),
        CONTROLLER_ORDER.skillRead,
      );
    }
  },
};

const citationModule: TurnRuntimeModule = {
  id: "threadlight.source-citations",
  setup(_context, registrar) {
    const controller = new SourceCitationRunController();
    registrar.provide(TURN_CITATION_SERVICE, { controller });
    registrar.addController(controller, CONTROLLER_ORDER.citations);
    registrar.addOutputFinalizer((output) => {
      const finalized: FinalizedSourceCitations = controller.finalize(
        output.text,
      );
      return {
        text: finalized.text,
        sources: finalized.sources,
        citations: finalized.citations,
      };
    });
  },
};

const projectMemoryModule: TurnRuntimeModule = {
  id: "threadlight.project-memory-policy",
  setup(_context, registrar) {
    registrar.addController(
      new ProjectMemoryReminderController(),
      CONTROLLER_ORDER.projectMemory,
    );
  },
};

const researchCoverageModule: TurnRuntimeModule = {
  id: "threadlight.research-coverage",
  setup(context, registrar) {
    registrar.addController(
      new ResearchCoverageRunController(context.taskInput),
      CONTROLLER_ORDER.researchCoverage,
    );
  },
};

const userActionModule: TurnRuntimeModule = {
  id: "threadlight.user-action",
  setup(_context, registrar) {
    registrar.wrapController(
      (controller) => new UserActionRunController(controller),
    );
    registrar.wrapChildController(
      (controller) => new UserActionRunController(controller),
    );
  },
};

/**
 * Default first-party turn profile. Callers may supply a different ordered
 * module list through AppServerOptions without changing AppServer itself.
 */
export function defaultTurnRuntimeModules(): readonly TurnRuntimeModule[] {
  return [
    runtimePromptModule,
    executionPolicyModule,
    planModule,
    attachmentModule,
    capabilityModule,
    citationModule,
    projectMemoryModule,
    researchCoverageModule,
    userActionModule,
  ];
}
