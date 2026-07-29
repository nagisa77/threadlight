import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import type {
  Agent,
  AgentEvent,
  AgentLoop,
  Tool,
} from "@threadlight/agent-loop";
import {
  createRequestPlanInputTool,
  PlanExecutionController,
  USER_SELECTED_PLAN_INSTRUCTIONS,
} from "@threadlight/builtin-tools";
import {
  projectAgentProgress,
  projectAgentPlan,
  projectMessagesProcess,
  projectProgressProcess,
} from "@threadlight/protocol";

import type {
  AttachmentData,
  AgentPlanData,
  CapabilityDescriptor,
  ConnectorStatusData,
  ConversationMessageData,
  ConversationProgressData,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  MessageCapabilityData,
  ProcessSnapshotData,
  SendMessage,
  SuggestionLanguage,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
  TurnMode,
} from "./protocol.js";
import {
  MemoryConversationStore,
  type ConversationStore,
  type StoredConversation,
} from "./conversation-store.js";
import {
  composePrompt,
  promptBlocksFromSnapshot,
  validatePromptSnapshot,
  type PromptBlock,
  type PromptSnapshot,
} from "./prompt-composer.js";
import type {
  CapabilityActivation,
  CapabilityResource,
} from "./capability-registry.js";
import { CapabilityResourceController } from "./capability-resource-controller.js";
import {
  createAttachmentRuntime,
  type AttachmentProvider,
} from "./attachment-runtime.js";
import { ModelStatePersistence } from "./model-state-persistence.js";
import {
  composeRunControllers,
  ProjectMemoryReminderController,
  ResearchCoverageRunController,
  UserActionRunController,
} from "./run-controllers.js";
import { TurnCapabilityController } from "./turn-capability-controller.js";

interface ThreadState {
  agent: Agent;
  promptSnapshot: PromptSnapshot;
  conversation: StoredConversation;
  progress: readonly ConversationProgressData[];
  plan?: AgentPlanData;
  suggestions: Map<
    SuggestionLanguage,
    readonly [string, string, string]
  >;
  suggestionRequests: Map<
    SuggestionLanguage,
    Promise<readonly [string, string, string]>
  >;
  runtime?: ThreadRuntime;
  activeTurn?: {
    id: string;
    controller: AbortController;
  };
}

export interface ProcessController {
  status(sessionId: string): ProcessSnapshotData | Promise<ProcessSnapshotData>;
  read(sessionId: string): ProcessSnapshotData | Promise<ProcessSnapshotData>;
  wait(
    sessionId: string,
    timeoutMs?: number,
  ): ProcessSnapshotData | Promise<ProcessSnapshotData>;
  kill(sessionId: string): ProcessSnapshotData | Promise<ProcessSnapshotData>;
}

interface SharedAppServerOptions {
  loop: AgentLoop;
  send: SendMessage;
  attachmentProvider?: AttachmentProvider;
  modelStatePersistence?: ModelStatePersistence;
  conversationStore?: ConversationStore;
  processes?: ProcessController;
  threadRuntimeFactory?: ThreadRuntimeFactory;
  now?: () => Date;
  attachmentRoot?: string;
  turnCleanup?(context: TurnCleanupContext): void | Promise<void>;
}

export type AgentFactory = () => Agent | Promise<Agent>;

export interface TurnCleanupContext {
  threadId: string;
  turnId: string;
  runId?: string;
}

export interface ThreadRuntime {
  tools?: readonly Tool[];
  promptBlocks?: readonly PromptBlock[];
  capabilities?: readonly CapabilityDescriptor[];
  promptBlocksForTurn?(
    input: string,
  ): readonly PromptBlock[] | Promise<readonly PromptBlock[]>;
  resolveCapabilities?(
    refs: readonly string[],
    signal: AbortSignal,
    activation?: CapabilityActivation,
  ):
    | {
      promptBlocks: readonly PromptBlock[];
      tools: readonly Tool[];
      resources?: readonly CapabilityResource[];
    }
    | Promise<{
        promptBlocks: readonly PromptBlock[];
        tools: readonly Tool[];
        resources?: readonly CapabilityResource[];
      }>;
  connectorStatus?(
    capabilityId: string,
  ): ConnectorStatusData | Promise<ConnectorStatusData>;
  configureConnector?(
    capabilityId: string,
    clientId: string,
    clientSecret: string,
  ): ConnectorStatusData | Promise<ConnectorStatusData>;
  authorizeConnector?(
    capabilityId: string,
    signal: AbortSignal,
  ): ConnectorStatusData | Promise<ConnectorStatusData>;
  disconnectConnector?(
    capabilityId: string,
  ): ConnectorStatusData | Promise<ConnectorStatusData>;
  snapshot?: unknown;
  dispose?(): void | Promise<void>;
}

export type ThreadRuntimeFactory = (restoredSnapshot?: unknown) =>
  | ThreadRuntime
  | Promise<ThreadRuntime>;

export type AppServerOptions = SharedAppServerOptions &
  (
    | { agent: Agent; agentFactory?: never }
    | { agent?: never; agentFactory: AgentFactory }
  );

export class AppServer {
  private readonly loop: AgentLoop;
  private readonly attachmentProvider?: AttachmentProvider;
  private readonly modelStatePersistence: ModelStatePersistence;
  private readonly agentFactory: AgentFactory;
  private readonly send: SendMessage;
  private readonly conversationStore: ConversationStore;
  private readonly processes?: ProcessController;
  private readonly threadRuntimeFactory?: ThreadRuntimeFactory;
  private readonly now: () => Date;
  private readonly attachmentRoot?: string;
  private readonly turnCleanup?: SharedAppServerOptions["turnCleanup"];
  private readonly threads = new Map<string, ThreadState>();
  private initialized = false;

  constructor(options: AppServerOptions) {
    this.loop = options.loop;
    this.attachmentProvider = options.attachmentProvider;
    this.modelStatePersistence =
      options.modelStatePersistence ?? new ModelStatePersistence();
    this.agentFactory = options.agentFactory ?? (() => options.agent);
    this.send = options.send;
    this.conversationStore =
      options.conversationStore ?? new MemoryConversationStore();
    this.processes = options.processes;
    this.threadRuntimeFactory = options.threadRuntimeFactory;
    this.now = options.now ?? (() => new Date());
    this.attachmentRoot = options.attachmentRoot
      ? resolve(options.attachmentRoot)
      : undefined;
    this.turnCleanup = options.turnCleanup;
  }

  async receive(message: JsonRpcRequest): Promise<void> {
    const id = message.id;

    try {
      if (!this.initialized && message.method !== "initialize") {
        throw new RpcError(-32002, "Server is not initialized");
      }

      const result = await this.dispatch(message.method, message.params);
      if (id !== undefined) this.reply(id, result);
    } catch (error) {
      if (id === undefined) return;

      const rpcError =
        error instanceof RpcError
          ? error
          : new RpcError(
              -32603,
              error instanceof Error ? error.message : String(error),
            );

      this.replyError(id, rpcError);
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize":
        this.initialized = true;
        return { name: "threadlight", protocolVersion: "0.1" };
      case "thread/start":
        return this.startThread();
      case "thread/resume":
        return this.resumeThread(params);
      case "thread/delete":
        return this.deleteThread(params);
      case "thread/suggestions":
        return this.suggestQuestions(params);
      case "capability/list":
        return this.listCapabilities(params);
      case "connector/status":
        return this.connectorStatus(params);
      case "connector/configure":
        return this.configureConnector(params);
      case "connector/authorize":
        return this.authorizeConnector(params);
      case "connector/disconnect":
        return this.disconnectConnector(params);
      case "turn/start":
        return this.startTurn(params);
      case "turn/interrupt":
        return this.interruptTurn(params);
      case "process/status":
        return this.processRequest(params, "status");
      case "process/read":
        return this.processRequest(params, "read");
      case "process/wait":
        return this.processRequest(params, "wait");
      case "process/kill":
        return this.processRequest(params, "kill");
      default:
        throw new RpcError(-32601, `Method not found: ${method}`);
    }
  }

  private async startThread(): Promise<{ threadId: string }> {
    const threadId = randomUUID();
    const timestamp = this.now().toISOString();
    const conversation: StoredConversation = {
      version: 1,
      threadId,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    this.threads.set(
      threadId,
      await this.createThreadState(conversation),
    );
    return { threadId };
  }

  private async resumeThread(
    params: unknown,
  ): Promise<{ threadId: string; messages: readonly ConversationMessageData[] }> {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    let thread = this.threads.get(threadId);
    if (!thread) {
      const conversation = await this.conversationStore.load(threadId);
      if (conversation) {
        thread = await this.createThreadState(conversation);
        this.threads.set(threadId, thread);
      }
    }
    if (!thread) {
      throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    }
    return { threadId, messages: thread.conversation.messages };
  }

  private async deleteThread(
    params: unknown,
  ): Promise<{ deleted: boolean }> {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    const thread = this.threads.get(threadId);
    if (thread?.activeTurn) {
      throw new RpcError(-32003, "Cannot delete a thread with an active turn");
    }

    const deletedFromStore = await this.conversationStore.delete(threadId);
    if (thread) await this.disposeThreadRuntime(thread);
    this.threads.delete(threadId);
    return { deleted: !!thread || deletedFromStore };
  }

  private async suggestQuestions(
    params: unknown,
  ): Promise<{ suggestions: readonly [string, string, string] }> {
    const { threadId, language: languageValue } = objectParams(params);
    requireString(threadId, "threadId");
    const language = requireSuggestionLanguage(languageValue);

    const thread = this.threads.get(threadId);
    if (!thread) throw new RpcError(-32001, `Unknown thread: ${threadId}`);

    const cached = thread.suggestions.get(language);
    if (cached) return { suggestions: cached };

    let request = thread.suggestionRequests.get(language);
    if (!request) {
      request = this.generateSuggestedQuestions(thread.agent, language);
      thread.suggestionRequests.set(language, request);
    }

    try {
      const suggestions = await request;
      thread.suggestions.set(language, suggestions);
      return { suggestions };
    } finally {
      if (thread.suggestionRequests.get(language) === request) {
        thread.suggestionRequests.delete(language);
      }
    }
  }

  private listCapabilities(
    params: unknown,
  ): { capabilities: readonly CapabilityDescriptor[] } {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");
    const thread = this.threads.get(threadId);
    if (!thread) throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    return {
      capabilities: (thread.runtime?.capabilities ?? []).map(
        (capability) => ({ ...capability }),
      ),
    };
  }

  private connectorStatus(params: unknown): Promise<ConnectorStatusData> {
    const { runtime, capabilityId } = this.connectorRequest(params);
    if (!runtime.connectorStatus) {
      throw new RpcError(-32040, "Connector management is unavailable");
    }
    return Promise.resolve(runtime.connectorStatus(capabilityId));
  }

  private configureConnector(
    params: unknown,
  ): Promise<ConnectorStatusData> {
    const values = objectParams(params);
    const { runtime, capabilityId } = this.connectorRequest(params);
    requireString(values.clientId, "clientId");
    requireString(values.clientSecret, "clientSecret");
    if (!runtime.configureConnector) {
      throw new RpcError(-32040, "Connector management is unavailable");
    }
    return Promise.resolve(
      runtime.configureConnector(
        capabilityId,
        values.clientId,
        values.clientSecret,
      ),
    );
  }

  private authorizeConnector(
    params: unknown,
  ): Promise<ConnectorStatusData> {
    const { runtime, capabilityId } = this.connectorRequest(params);
    if (!runtime.authorizeConnector) {
      throw new RpcError(-32040, "Connector management is unavailable");
    }
    return Promise.resolve(
      runtime.authorizeConnector(
        capabilityId,
        AbortSignal.timeout(6 * 60 * 1_000),
      ),
    );
  }

  private disconnectConnector(
    params: unknown,
  ): Promise<ConnectorStatusData> {
    const { runtime, capabilityId } = this.connectorRequest(params);
    if (!runtime.disconnectConnector) {
      throw new RpcError(-32040, "Connector management is unavailable");
    }
    return Promise.resolve(runtime.disconnectConnector(capabilityId));
  }

  private connectorRequest(params: unknown): {
    runtime: ThreadRuntime;
    capabilityId: string;
  } {
    const { threadId, capabilityId } = objectParams(params);
    requireString(threadId, "threadId");
    requireString(capabilityId, "capabilityId");
    const thread = this.threads.get(threadId);
    if (!thread) throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    if (!thread.runtime) {
      throw new RpcError(-32040, "Connector management is unavailable");
    }
    return { runtime: thread.runtime, capabilityId };
  }

  private async generateSuggestedQuestions(
    agent: Agent,
    language: SuggestionLanguage,
  ): Promise<readonly [string, string, string]> {
    const result = await this.loop.run(
      {
        ...agent,
        name: `${agent.name}-suggestions`,
        instructions: [
          agent.instructions,
          "Generate opening-screen suggestions only. Do not answer the questions, call tools, or describe your reasoning. Each suggestion must be a concrete, useful question the user could ask about this workspace. Make the three questions meaningfully different from one another.",
        ].join("\n\n"),
        tools: [],
        maxSteps: 1,
      },
      [
        `Create exactly three suggested questions in ${suggestionLanguageName(language)} for the current workspace.`,
        "Keep each question concise and specific to the available project context.",
        "Return only a JSON array of three strings, with no Markdown or commentary.",
      ].join(" "),
    );

    try {
      return parseSuggestedQuestions(result.output);
    } catch {
      throw new RpcError(
        -32030,
        "The model did not return three valid suggested questions",
      );
    }
  }

  async dispose(): Promise<void> {
    for (const thread of this.threads.values()) {
      thread.activeTurn?.controller.abort(
        new Error("App server is shutting down"),
      );
    }
    await Promise.all(
      [...this.threads.values()].map((thread) =>
        this.disposeThreadRuntime(thread),
      ),
    );
    this.threads.clear();
  }

  private async startTurn(params: unknown): Promise<{ turnId: string }> {
    const {
      threadId,
      input,
      mode: modeValue,
      attachments: attachmentValue,
      capabilityRefs: capabilityRefsValue,
    } = objectParams(params);
    requireString(threadId, "threadId");
    if (typeof input !== "string") {
      throw new RpcError(-32602, "input must be a string");
    }
    const attachments = parseAttachments(attachmentValue);
    const capabilityRefs = parseCapabilityRefs(capabilityRefsValue);
    const mode = parseTurnMode(modeValue);
    for (const attachment of attachments) {
      this.requireLocalAttachment(attachment);
    }
    if (!input.trim() && attachments.length === 0) {
      throw new RpcError(-32602, "A turn requires text or an attachment");
    }

    const thread = this.threads.get(threadId);
    if (!thread) throw new RpcError(-32001, `Unknown thread: ${threadId}`);
    const availableCapabilities = thread.runtime?.capabilities ?? [];
    const availableCapabilityIds = new Set(
      availableCapabilities.map(({ id }) => id),
    );
    const unknownCapability = capabilityRefs.find(
      (ref) => !availableCapabilityIds.has(ref),
    );
    if (unknownCapability) {
      throw new RpcError(
        -32602,
        `Unknown capability: ${unknownCapability}`,
      );
    }
    if (thread.activeTurn) {
      throw new RpcError(-32003, "Thread already has an active turn");
    }
    const capabilities = snapshotCapabilities(
      capabilityRefs,
      availableCapabilities,
    );

    const turnId = randomUUID();
    const controller = new AbortController();
    thread.activeTurn = { id: turnId, controller };
    thread.progress = [];
    thread.plan =
      mode === "plan" ? { source: "user", items: [] } : undefined;
    const startedConversation = this.updateConversation(thread.conversation, [
      ...thread.conversation.messages,
      {
        id: randomUUID(),
        role: "user",
        text: input,
        ...(mode === "plan" ? { mode } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(capabilityRefs.length > 0 ? { capabilityRefs } : {}),
        ...(capabilities.length > 0 ? { capabilities } : {}),
      },
    ]);
    try {
      await this.conversationStore.save(startedConversation);
      thread.conversation = startedConversation;
    } catch (error) {
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
      throw error;
    }

    queueMicrotask(() => {
      void this.runTurn(
        threadId,
        turnId,
        input,
        mode,
        attachments,
        capabilityRefs,
        capabilities,
        thread,
        controller,
      );
    });

    return { turnId };
  }

  private interruptTurn(params: unknown): { interrupted: boolean } {
    const { threadId } = objectParams(params);
    requireString(threadId, "threadId");

    const activeTurn = this.threads.get(threadId)?.activeTurn;
    if (!activeTurn) return { interrupted: false };

    activeTurn.controller.abort(new Error("Turn interrupted by client"));
    return { interrupted: true };
  }

  private requireLocalAttachment(attachment: AttachmentData): void {
    try {
      const path = realpathSync(attachment.path);
      if (!statSync(path).isFile()) throw new Error("not a file");
      if (this.attachmentRoot) {
        const root = realpathSync(this.attachmentRoot);
        if (!path.startsWith(`${root}${sep}`)) throw new Error("outside root");
      }
    } catch {
      throw new RpcError(
        -32602,
        this.attachmentRoot
          ? "attachment path must be an uploaded file in the active project"
          : "attachment path must be a readable local file",
      );
    }
  }

  private async processRequest(
    params: unknown,
    action: "status" | "read" | "wait" | "kill",
  ): Promise<ProcessSnapshotData> {
    if (!this.processes) {
      throw new RpcError(-32020, "Process management is not available");
    }
    const { sessionId, timeoutMs } = objectParams(params);
    requireString(sessionId, "sessionId");
    if (
      timeoutMs !== undefined &&
      (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1)
    ) {
      throw new RpcError(-32602, "timeoutMs must be a positive integer");
    }

    const snapshot =
      action === "wait"
        ? await this.processes.wait(
            sessionId,
            timeoutMs === undefined ? undefined : Number(timeoutMs),
          )
        : await this.processes[action](sessionId);
    await this.recordProcessSnapshot(snapshot);
    return snapshot;
  }

  private async recordProcessSnapshot(
    snapshot: ProcessSnapshotData,
  ): Promise<void> {
    for (const thread of this.threads.values()) {
      thread.progress = projectProgressProcess(thread.progress, snapshot);
      const messages = projectMessagesProcess(
        thread.conversation.messages,
        snapshot,
      );
      if (messages === thread.conversation.messages) continue;
      const conversation = this.updateConversation(thread.conversation, messages);
      await this.conversationStore.save(conversation);
      thread.conversation = conversation;
    }
  }

  private async runTurn(
    threadId: string,
    turnId: string,
    input: string,
    mode: TurnMode,
    attachments: readonly AttachmentData[],
    capabilityRefs: readonly string[],
    capabilities: readonly MessageCapabilityData[],
    thread: ThreadState,
    controller: AbortController,
  ): Promise<void> {
    this.notify("turn/started", { threadId, turnId, mode });
    let runId: string | undefined;
    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await this.cleanupTurn({ threadId, turnId, runId });
    };

    try {
      const planController = new PlanExecutionController({
        requirePlan: mode === "plan",
      });
      const attachmentRuntime = createAttachmentRuntime(
        this.attachmentProvider,
        input,
        attachments,
      );
      const capabilityRuntime = thread.runtime?.resolveCapabilities
        ? await thread.runtime.resolveCapabilities(
            capabilityRefs,
            controller.signal,
            "explicit",
          )
        : { promptBlocks: [], tools: [], resources: [] };
      const capabilityResources = new CapabilityResourceController(
        capabilityRuntime.resources ?? [],
      );
      const turnTools: Tool[] = [
        ...appendTurnTools(thread.agent.tools, [
          ...(mode === "plan" ? [createRequestPlanInputTool()] : []),
          ...(attachmentRuntime.tool ? [attachmentRuntime.tool] : []),
          ...capabilityRuntime.tools,
          ...(capabilityResources.hasResources()
            ? [capabilityResources.tool()]
            : []),
        ]),
      ];
      const capabilityController =
        thread.runtime?.resolveCapabilities &&
        (thread.runtime.capabilities?.length ?? 0) > 0
          ? new TurnCapabilityController({
              capabilities: thread.runtime.capabilities ?? [],
              initialRefs: capabilityRefs,
              resolve: thread.runtime.resolveCapabilities.bind(
                thread.runtime,
              ),
              addTools: (tools) => appendToolsInPlace(turnTools, tools),
              addResources: (resources) => {
                if (capabilityResources.add(resources)) {
                  appendToolsInPlace(turnTools, [
                    capabilityResources.tool(),
                  ]);
                }
              },
            })
          : undefined;
      appendToolsInPlace(
        turnTools,
        capabilityController?.tools() ?? [],
      );
      const runController = new UserActionRunController(
        composeRunControllers([
          planController,
          capabilityController,
          new ProjectMemoryReminderController(),
          new ResearchCoverageRunController(input),
          attachmentRuntime.controller,
        ]),
      );
      const turnPromptBlocks = uniquePromptBlocks([
        ...promptBlocksFromSnapshot(thread.promptSnapshot),
        ...((await thread.runtime?.promptBlocksForTurn?.(input)) ?? []),
        ...capabilityRuntime.promptBlocks,
        ...(mode === "plan"
          ? [
              {
                id: "turn.plan-mode",
                version: 1,
                authority: "turn" as const,
                source: "app-server",
                content: USER_SELECTED_PLAN_INSTRUCTIONS,
              },
            ]
          : []),
      ]);
      const turnPrompt = composePrompt(turnPromptBlocks);
      const turnAgent = {
        ...thread.agent,
        instructions: turnPrompt.instructions,
        tools: turnTools,
      };
      const result = await this.loop.run(
        turnAgent,
        attachmentRuntime.input,
        {
          toolScopeId: threadId,
          modelState: thread.conversation.modelState,
          controller: runController,
          signal: controller.signal,
          onEvent: (event) => {
            runId = event.runId;
            this.forwardEvent(threadId, turnId, thread, event);
          },
        },
      );
      const persistedModelState =
        this.modelStatePersistence.prepare(result.modelState);
      const appliedCapabilities = mergeMessageCapabilities(
        capabilities,
        snapshotCapabilities(
          capabilityController?.activatedRefs() ?? [],
          thread.runtime?.capabilities ?? [],
        ),
      );
      if (
        planController?.phase === "needs_input" &&
        planController.snapshot === undefined
      ) {
        thread.plan = undefined;
      }

      const completedConversation = this.updateConversation(
        thread.conversation,
        [
          ...thread.conversation.messages,
          {
            id: randomUUID(),
            role: "assistant",
            text: result.output,
            ...(thread.progress.length > 0
              ? { progress: thread.progress }
              : {}),
            ...(thread.plan ? { plan: thread.plan } : {}),
            ...(appliedCapabilities.length > 0
              ? { capabilities: appliedCapabilities }
              : {}),
          },
        ],
        { modelState: persistedModelState },
      );
      await this.conversationStore.save(completedConversation);
      thread.conversation = completedConversation;
      await cleanup();
      this.notify("turn/completed", {
        threadId,
        turnId,
        output: result.output,
        usage: result.usage,
        ...(appliedCapabilities.length > 0
          ? { capabilities: appliedCapabilities }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      thread.conversation = this.updateConversation(thread.conversation, [
        ...thread.conversation.messages,
        {
          id: randomUUID(),
          role: "assistant",
          text: message,
          error: true,
          ...(thread.progress.length > 0
            ? { progress: thread.progress }
            : {}),
          ...(thread.plan ? { plan: thread.plan } : {}),
        },
      ]);
      try {
        await this.conversationStore.save(thread.conversation);
      } catch (persistenceError) {
        process.stderr.write(
          `Could not persist failed conversation ${threadId}: ${String(persistenceError)}\n`,
        );
      }
      await cleanup();
      this.notify("turn/failed", {
        threadId,
        turnId,
        error: message,
      });
    } finally {
      await cleanup();
      if (thread.activeTurn?.id === turnId) thread.activeTurn = undefined;
    }
  }

  private async cleanupTurn(context: TurnCleanupContext): Promise<void> {
    if (!this.turnCleanup) return;
    try {
      await this.turnCleanup(context);
    } catch (error) {
      process.stderr.write(
        `Could not clean up turn ${context.turnId}: ${String(error)}\n`,
      );
    }
  }

  private forwardEvent(
    threadId: string,
    turnId: string,
    thread: ThreadState,
    event: AgentEvent,
  ): void {
    thread.progress = projectAgentProgress(thread.progress, event);
    thread.plan = projectAgentPlan(thread.plan, event);
    this.notify("agent/event", {
      threadId,
      turnId,
      event: clientSafeAgentEvent(event),
    });
  }

  private updateConversation(
    conversation: StoredConversation,
    messages: readonly ConversationMessageData[],
    options?: { modelState: unknown },
  ): StoredConversation {
    const { modelState: _previousModelState, ...stored } = conversation;
    const modelState = options ? options.modelState : conversation.modelState;
    return {
      ...stored,
      updatedAt: this.now().toISOString(),
      messages,
      ...(modelState === undefined ? {} : { modelState }),
    };
  }

  private notify<Method extends ThreadlightNotificationMethod>(
    method: Method,
    params: ThreadlightNotificationMap[Method],
  ): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private async createThreadState(
    conversation: StoredConversation,
  ): Promise<ThreadState> {
    const baseAgent = await this.agentFactory();
    const runtime = await this.threadRuntimeFactory?.(
      conversation.agentSnapshot?.runtime,
    );
    try {
      const promptSnapshot = conversation.agentSnapshot
        ? restoreStoredPrompt(conversation.agentSnapshot.prompt)
        : composePrompt([
            ...promptBlocksForAgent(baseAgent),
            ...(runtime?.promptBlocks ?? []),
          ]);
      const agent = runtime
        ? attachRuntimeTools(
            { ...baseAgent, instructions: promptSnapshot.instructions },
            runtime,
          )
        : { ...baseAgent, instructions: promptSnapshot.instructions };
      const snapshottedConversation = conversation.agentSnapshot
        ? conversation
        : {
            ...conversation,
            agentSnapshot: {
              version: 1 as const,
              prompt: promptSnapshot,
              ...(runtime?.snapshot === undefined
                ? {}
                : { runtime: runtime.snapshot }),
            },
          };
      return {
        agent,
        promptSnapshot,
        conversation: snapshottedConversation,
        progress: [],
        suggestions: new Map(),
        suggestionRequests: new Map(),
        ...(runtime ? { runtime } : {}),
      };
    } catch (error) {
      await runtime?.dispose?.();
      throw error;
    }
  }

  private async disposeThreadRuntime(thread: ThreadState): Promise<void> {
    const runtime = thread.runtime;
    thread.runtime = undefined;
    if (!runtime?.dispose) return;
    try {
      await runtime.dispose();
    } catch (error) {
      process.stderr.write(
        `Could not dispose thread runtime ${thread.conversation.threadId}: ${String(error)}\n`,
      );
    }
  }

  private reply(id: JsonRpcId, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private replyError(id: JsonRpcId, error: RpcError): void {
    const message: JsonRpcOutgoing = {
      jsonrpc: "2.0",
      id,
      error: { code: error.code, message: error.message },
    };
    this.send(message);
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function objectParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new RpcError(-32602, "params must be an object");
  }
  return params as Record<string, unknown>;
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RpcError(-32602, `${name} must be a non-empty string`);
  }
}

function parseTurnMode(value: unknown): TurnMode {
  if (value === undefined || value === "default") return "default";
  if (value === "plan") return value;
  throw new RpcError(-32602, "mode must be default or plan");
}

const SUGGESTION_LANGUAGES = new Set<SuggestionLanguage>([
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
]);

function requireSuggestionLanguage(value: unknown): SuggestionLanguage {
  if (
    typeof value !== "string" ||
    !SUGGESTION_LANGUAGES.has(value as SuggestionLanguage)
  ) {
    throw new RpcError(-32602, "language is not supported");
  }
  return value as SuggestionLanguage;
}

function suggestionLanguageName(language: SuggestionLanguage): string {
  switch (language) {
    case "zh-CN":
      return "Simplified Chinese";
    case "zh-TW":
      return "Traditional Chinese";
    case "en":
      return "English";
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
  }
}

function parseSuggestedQuestions(
  output: string,
): readonly [string, string, string] {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Missing JSON array");

  const value: unknown = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("Expected three suggestions");
  }

  const suggestions = value.map((question) => {
    if (typeof question !== "string") {
      throw new Error("Suggestion must be a string");
    }
    const normalized = question.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 200) {
      throw new Error("Suggestion length is invalid");
    }
    return normalized;
  });
  if (new Set(suggestions).size !== 3) {
    throw new Error("Suggestions must be unique");
  }
  return suggestions as [string, string, string];
}

function parseAttachments(value: unknown): readonly AttachmentData[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isAttachment)) {
    throw new RpcError(-32602, "attachments must contain valid local files");
  }
  return value;
}

function parseCapabilityRefs(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    !value.every(
      (ref) =>
        typeof ref === "string" &&
        ref.length > 0 &&
        ref.length <= 256,
    )
  ) {
    throw new RpcError(
      -32602,
      "capabilityRefs must contain at most 16 valid capability ids",
    );
  }
  return [...new Set(value)];
}

function snapshotCapabilities(
  refs: readonly string[],
  available: readonly CapabilityDescriptor[],
): readonly MessageCapabilityData[] {
  const byId = new Map(available.map((capability) => [capability.id, capability]));
  return refs.map((ref) => {
    const capability = byId.get(ref);
    if (!capability) {
      throw new Error(`Capability disappeared after validation: ${ref}`);
    }
    return {
      id: capability.id,
      kind: capability.kind,
      name: capability.name,
      ...(capability.source ? { source: capability.source } : {}),
      ...(capability.icon ? { icon: capability.icon } : {}),
    };
  });
}

function isAttachment(value: unknown): value is AttachmentData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mimeType === "string" &&
    typeof attachment.size === "number" &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    (attachment.kind === "image" || attachment.kind === "file") &&
    typeof attachment.path === "string"
  );
}

function clientSafeAgentEvent(event: AgentEvent): AgentEvent {
  if (
    event.type !== "tool.completed" ||
    event.result.name !== "computer" ||
    event.result.isError
  ) {
    return event;
  }
  return {
    ...event,
    result: {
      ...event.result,
      output: '{"type":"computer_screenshot","status":"captured"}',
    },
  };
}

function appendTurnTools(
  tools: readonly Tool[] | undefined,
  additions: readonly Tool[],
): readonly Tool[] {
  const combined = [...(tools ?? []), ...additions];
  const names = new Set<string>();
  for (const tool of combined) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  return combined;
}

function appendToolsInPlace(
  target: Tool[],
  additions: readonly Tool[],
): void {
  const names = new Set(target.map(({ name }) => name));
  for (const tool of additions) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  target.push(...additions);
}

function mergeMessageCapabilities(
  left: readonly MessageCapabilityData[],
  right: readonly MessageCapabilityData[],
): readonly MessageCapabilityData[] {
  const merged = new Map<string, MessageCapabilityData>();
  for (const capability of [...left, ...right]) {
    merged.set(capability.id, capability);
  }
  return [...merged.values()];
}

function uniquePromptBlocks(
  blocks: readonly PromptBlock[],
): readonly PromptBlock[] {
  const unique = new Map<string, PromptBlock>();
  for (const block of blocks) {
    const existing = unique.get(block.id);
    if (!existing) {
      unique.set(block.id, block);
      continue;
    }
    if (
      existing.version !== block.version ||
      existing.authority !== block.authority ||
      existing.source !== block.source ||
      existing.content !== block.content
    ) {
      throw new Error(`Conflicting prompt block: ${block.id}`);
    }
  }
  return [...unique.values()];
}

function attachRuntimeTools(agent: Agent, runtime: ThreadRuntime): Agent {
  const tools = [...(agent.tools ?? []), ...(runtime.tools ?? [])];
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    }
    names.add(tool.name);
  }
  return { ...agent, tools };
}

function promptBlocksForAgent(agent: Agent): PromptBlock[] {
  const candidate = (agent as Agent & { promptSnapshot?: unknown })
    .promptSnapshot;
  if (candidate !== undefined) {
    validatePromptSnapshot(candidate);
    if (candidate.instructions !== agent.instructions) {
      throw new Error("Agent prompt snapshot does not match its instructions");
    }
    return promptBlocksFromSnapshot(candidate);
  }
  return [
    {
      id: "host.legacy-agent",
      version: 1,
      authority: "host",
      source: agent.name,
      content: agent.instructions,
    },
  ];
}

function restoreStoredPrompt(snapshot: PromptSnapshot): PromptSnapshot {
  validatePromptSnapshot(snapshot);
  return structuredClone(snapshot);
}
