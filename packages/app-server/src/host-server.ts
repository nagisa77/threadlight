import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import type { Duplex } from "node:stream";

import {
  applyAutomaticWorktreeDelivery,
  AutomationScheduler,
  AutomationStore,
  CodeHostDeliveryManager,
  ConversationChangeTracker,
  GitHubCliProvider,
  type AutomationExecutionResult,
  type AudioTranscriptionOptions,
  type AudioTranscriptionRequest,
  MAX_TRANSCRIPTION_BYTES,
  projectDiagnosticBundle,
  projectDiagnostics,
  ProjectSearchService,
  RunningThreadRegistry,
  TaskWorkspaceManager,
  type GitTaskWorkspace,
  type TaskWorkspace,
  WorktreeDeliveryManager,
  type ProjectStore,
  type SettingsStore,
  transcribeAudio,
  testProviderConnection,
  type RuntimeSettings,
} from "@threadlight/host-core";
import type { TerminalSessionController } from "@threadlight/terminal-core";
import {
  THREADLIGHT_HOST_PROTOCOL_VERSION,
  VOICE_INPUT_ERROR_CODES,
} from "@threadlight/protocol";
import type {
  AttachmentData,
  HostAutomation,
  HostAutomationCreateRequest,
  HostAutomationSchedule,
  HostAutomationUpdateRequest,
  HostDirectoryListing,
  HostProjectSummary,
  HostProjectsSnapshot,
  HostProviderDiagnostic,
  HostProviderTestRequest,
  HostSearchRequest,
  HostSearchResult,
  HostSettingsUpdate,
  HostDeliverySource,
  HostDirectoryListOptions,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  JsonRpcResponse,
  TaskDevelopmentMode,
  ThreadlightHostHealth,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import { WebSocketServer } from "ws";

import { HostTerminalGateway } from "./host-terminal-gateway.js";
import { HostWebAssets } from "./host-web-assets.js";
import {
  listHostFiles,
  readHostFile,
  readHostFileContents,
} from "./host-files.js";
import type { RuntimePeer } from "./remote-runtime-peer.js";
import { RemoteWorkspace } from "./remote-workspace.js";

import {
  BROWSER_TERMINAL_TOKEN_PREFIX,
  EVENT_HEARTBEAT_INTERVAL_MS,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
  MAX_TERMINAL_MESSAGE_BYTES,
  RPC_TIMEOUT_MS,
} from "./host-constants.js";
import { HostApiController } from "./host-api-controller.js";
import { HostRuntimeBridge } from "./host-runtime-bridge.js";

export interface ThreadlightHostServerOptions {
  token: string;
  hostId: string;
  name: string;
  homePath: string;
  projects: ProjectStore;
  settings: SettingsStore;
  testProvider?(
    request: HostProviderTestRequest,
    settings: RuntimeSettings,
  ): Promise<HostProviderDiagnostic>;
  transcribeAudio?(
    request: AudioTranscriptionRequest,
    options: AudioTranscriptionOptions,
  ): Promise<string>;
  acceptOAuthCallback?(input: {
    connectorId: string;
    code?: string;
    error?: string;
    state: string;
  }): boolean;
  createPeer(input: {
    projectId: string;
    projectRoot: string;
    projectBasePath: string;
    oauthCallbackUrlPrefix?: string;
  }): RuntimePeer;
  createTerminalSessions?(
    send: (event: TerminalSessionEvent) => void,
  ): TerminalSessionController;
  taskWorkspaces?: TaskWorkspaceManager;
  conversationChanges?: ConversationChangeTracker;
  worktreeDelivery?: WorktreeDeliveryManager;
  codeHostDelivery?: CodeHostDeliveryManager;
  host?: string;
  port?: number;
  allowedOrigins?: readonly string[];
  oauthCallbackUrlPrefix?: string;
  eventHeartbeatIntervalMs?: number;
  webRoot?: string;
}

export interface ThreadlightHostAddress {
  host: string;
  port: number;
}

export interface RuntimeContext {
  peer: RuntimePeer;
  workspace: RemoteWorkspace;
  projectId: string;
  workspacePath: string;
  unsubscribe: () => void;
  unsubscribeExit: () => void;
}

export interface PendingResponse {
  projectId: string;
  runtimeKey: string;
  originalId: JsonRpcId;
  method: string;
  response: ServerResponse;
  timeout: NodeJS.Timeout;
  workspace?: TaskWorkspace;
  pendingSnapshotId?: string;
  runtimeFailureKey?: string;
}

export class ThreadlightHostServer {
  private readonly listenHost: string;
  private readonly port: number;
  private readonly runtimes = new Map<string, RuntimeContext>();
  private readonly runningThreads = new RunningThreadRegistry();
  private readonly runtimeFailures = new Map<string, string>();
  private readonly pending = new Map<string, PendingResponse>();
  private readonly terminalGateway?: HostTerminalGateway;
  private readonly terminalWebSockets?: WebSocketServer;
  private readonly projectSearch = new ProjectSearchService();
  private readonly automationStore: AutomationStore;
  private readonly automationScheduler: AutomationScheduler;
  private readonly taskWorkspaces: TaskWorkspaceManager;
  private readonly conversationChanges: ConversationChangeTracker;
  private readonly worktreeDelivery: WorktreeDeliveryManager;
  private readonly codeHostDelivery: CodeHostDeliveryManager;
  private readonly eventClients = new Map<string, Set<ServerResponse>>();
  private readonly eventHeartbeatIntervalMs: number;
  private readonly webAssets?: HostWebAssets;
  private readonly initializationParams = new Map<
    string,
    Record<string, unknown> | undefined
  >();
  private readonly automationTurnWaiters = new Map<
    string,
    { resolve(result: AutomationExecutionResult): void }
  >();
  private server?: Server;

  constructor(private readonly options: ThreadlightHostServerOptions) {
    if (!options.token.trim()) {
      throw new Error("Threadlight Host token is required.");
    }
    this.listenHost = options.host ?? "127.0.0.1";
    this.port = options.port ?? 7432;
    this.eventHeartbeatIntervalMs =
      options.eventHeartbeatIntervalMs ?? EVENT_HEARTBEAT_INTERVAL_MS;
    this.webAssets = options.webRoot
      ? new HostWebAssets(options.webRoot)
      : undefined;
    if (
      !Number.isFinite(this.eventHeartbeatIntervalMs) ||
      this.eventHeartbeatIntervalMs <= 0
    ) {
      throw new Error("Host event heartbeat interval must be positive.");
    }
    this.automationStore = new AutomationStore(
      join(options.homePath, "automations.json"),
    );
    this.automationScheduler = new AutomationScheduler(this.automationStore, {
      execute: (automation) => this.executeAutomation(automation),
      notify: () => undefined,
    });
    this.taskWorkspaces =
      options.taskWorkspaces ??
      new TaskWorkspaceManager(join(options.homePath, "worktrees"), {
        standaloneRoot: join(options.homePath, "standalone", "workspaces"),
      });
    this.conversationChanges =
      options.conversationChanges ??
      new ConversationChangeTracker(join(options.homePath, "review-snapshots"));
    this.worktreeDelivery =
      options.worktreeDelivery ??
      new WorktreeDeliveryManager(this.conversationChanges);
    this.codeHostDelivery =
      options.codeHostDelivery ??
      new CodeHostDeliveryManager(
        this.conversationChanges,
        new GitHubCliProvider(),
      );
    if (options.createTerminalSessions) {
      this.terminalGateway = new HostTerminalGateway({
        projects: options.projects,
        createSessions: options.createTerminalSessions,
      });
      this.terminalWebSockets = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_TERMINAL_MESSAGE_BYTES,
        perMessageDeflate: false,
      });
    }
  }

  async start(): Promise<ThreadlightHostAddress> {
    if (this.server) throw new Error("Threadlight Host is already listening.");
    await this.webAssets?.ensure();
    await this.reconcileLegacyNoChangesAttention();
    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    if (this.terminalGateway && this.terminalWebSockets) {
      server.on("upgrade", (request, socket, head) => {
        this.handleUpgrade(request, socket, head);
      });
    }
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.listenHost, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Threadlight Host did not receive a TCP address.");
    }
    this.automationScheduler.start();
    return { host: this.listenHost, port: address.port };
  }

  private async reconcileLegacyNoChangesAttention(): Promise<void> {
    const snapshot = this.options.projects.snapshot();
    for (const project of snapshot.projects) {
      for (const conversation of project.conversations) {
        if (
          conversation.status !== "attention" ||
          conversation.workspace?.mode !== "worktree"
        ) {
          continue;
        }
        try {
          if (
            await this.worktreeDelivery.hasLegacyNoChangesFailure({
              projectId: project.id,
              threadId: conversation.id,
              projectPath: project.basePath,
            })
          ) {
            this.options.projects.markConversationCompleted({
              projectId: project.id,
              id: conversation.id,
            });
          }
        } catch {
          // A malformed legacy journal must not prevent the Host from starting.
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.automationScheduler.stop();
    for (const [threadId, waiter] of this.automationTurnWaiters) {
      waiter.resolve({
        threadId,
        error: "Threadlight Host stopped before the automation finished.",
      });
    }
    this.automationTurnWaiters.clear();
    const pendingResponses = [...this.pending.values()];
    for (const pending of pendingResponses) {
      clearTimeout(pending.timeout);
      this.writeJson(pending.response, 503, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: { code: -32000, message: "Threadlight Host stopped." },
      });
    }
    this.pending.clear();
    await Promise.all(
      pendingResponses.map((pending) => this.discardPendingWorkspace(pending)),
    );
    this.terminalGateway?.close();
    this.terminalWebSockets?.close();
    await this.stopRuntimes();
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.applyCors(request, response);
    const url = new URL(request.url ?? "/", "http://host.local");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const oauthCallback = hostOAuthCallbackRoute(url.pathname);
    if (request.method === "GET" && oauthCallback) {
      try {
        this.handleOAuthCallback(response, url, oauthCallback.connectorId);
      } catch {
        this.writeJson(response, 400, {
          error: "Invalid OAuth callback",
        });
      }
      return;
    }
    if (await this.webAssets?.handle(request, response, url)) return;
    if (!this.authorized(request)) {
      this.writeJson(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/health") {
        this.writeJson(response, 200, {
          ok: true,
          protocolVersion: THREADLIGHT_HOST_PROTOCOL_VERSION,
          hostId: this.options.hostId,
          name: this.options.name,
          homePath: this.options.homePath,
          ...(this.terminalGateway ? { capabilities: { terminal: true } } : {}),
        } satisfies ThreadlightHostHealth);
        return;
      }
      if (await this.hostApi().handleHostApi(request, response, url)) return;
      const route = runtimeRoute(url.pathname);
      if (route) {
        await this.runtimeBridge().handleRuntimeApi(
          request,
          response,
          url,
          route,
        );
        return;
      }
      this.writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      this.writeJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private hostApi(): HostApiController {
    return new HostApiController({
      options: this.options,
      automationStore: this.automationStore,
      automationScheduler: this.automationScheduler,
      codeHostDelivery: this.codeHostDelivery,
      conversationChanges: this.conversationChanges,
      projectSearch: this.projectSearch,
      runningThreads: this.runningThreads,
      worktreeDelivery: this.worktreeDelivery,
      applyAutomaticDelivery: (request, source) =>
        this.applyAutomaticDelivery(request, source),
      conversationWorkspace: (projectId, threadId) =>
        this.conversationWorkspace(projectId, threadId),
      disposeConversationWorkspace: (target, workspace) =>
        this.disposeConversationWorkspace(target, workspace),
      requireProject: (projectId) => this.requireProject(projectId),
      requireWorktreeWorkspace: (context) =>
        this.requireWorktreeWorkspace(context),
      stopRuntimes: () => this.stopRuntimes(),
      writeJson: (response, status, value) =>
        this.writeJson(response, status, value),
      writeBinary: (response, content) => this.writeBinary(response, content),
    });
  }

  private runtimeBridge(): HostRuntimeBridge {
    return new HostRuntimeBridge({
      options: this.options,
      runtimes: this.runtimes,
      runtimeFailures: this.runtimeFailures,
      pending: this.pending,
      initializationParams: this.initializationParams,
      conversationChanges: this.conversationChanges,
      taskWorkspaces: this.taskWorkspaces,
      eventHeartbeatIntervalMs: this.eventHeartbeatIntervalMs,
      discardPendingWorkspace: (pending) =>
        this.discardPendingWorkspace(pending),
      handleRuntimeExit: (projectId, context, error) =>
        this.handleRuntimeExit(projectId, context, error),
      oauthCallbackUrlPrefix: (request) => this.oauthCallbackUrlPrefix(request),
      projectEventClients: (projectId) => this.projectEventClients(projectId),
      recordNotification: (projectId, context, message) =>
        this.recordNotification(projectId, context, message),
      resolveAutomationTurn: (projectId, message) =>
        this.resolveAutomationTurn(projectId, message),
      writeBinary: (response, content) => this.writeBinary(response, content),
      writeJson: (response, status, value) =>
        this.writeJson(response, status, value),
    });
  }

  private recordNotification(
    projectId: string,
    context: RuntimeContext,
    message: JsonRpcOutgoing,
  ): void {
    this.runningThreads.record(
      projectId,
      runtimeKey(projectId, context.workspacePath),
      message,
    );
    if (!("method" in message)) return;
    const params = message.params as Record<string, unknown> | undefined;
    const threadId = params?.threadId;
    if (typeof threadId !== "string") return;
    try {
      if (
        message.method === "thread/title" &&
        typeof params?.title === "string"
      ) {
        this.options.projects.setGeneratedConversationTitle(
          { projectId, id: threadId },
          params.title,
        );
      }
      if (
        message.method === "turn/completed" ||
        message.method === "turn/failed"
      ) {
        this.runtimeFailures.delete(
          conversationRuntimeFailureKey(projectId, threadId),
        );
        this.options.projects.markConversationCompleted({
          projectId,
          id: threadId,
        });
      }
    } catch {
      // Late notifications may arrive after a task is deleted.
    }
  }

  private applyAutomaticDelivery(
    request: Parameters<WorktreeDeliveryManager["apply"]>[0],
    source: HostDeliverySource,
  ) {
    return applyAutomaticWorktreeDelivery(
      this.worktreeDelivery,
      request,
      (state) => {
        this.recordDeliveryConversationState(
          request.projectId,
          request.threadId,
          state.status,
        );
        const base = {
          projectId: request.projectId,
          threadId: request.threadId,
          revision: state.revision,
          source,
        };
        const notification: JsonRpcOutgoing =
          state.status === "syncing"
            ? {
                jsonrpc: "2.0",
                method: "delivery/syncing",
                params: base,
              }
            : state.status === "synced"
              ? {
                  jsonrpc: "2.0",
                  method: "delivery/synced",
                  params: { ...base, result: state.result! },
                }
              : state.status === "conflict"
                ? {
                    jsonrpc: "2.0",
                    method: "delivery/conflict",
                    params: {
                      ...base,
                      preflight: state.preflight!,
                      error: state.error!,
                    },
                  }
                : {
                    jsonrpc: "2.0",
                    method: "delivery/failed",
                    params: {
                      ...base,
                      ...(state.preflight
                        ? { preflight: state.preflight }
                        : {}),
                      error: state.error!,
                    },
                  };
        this.publishDeliveryNotification(request.projectId, notification);
      },
    );
  }

  private recordDeliveryConversationState(
    projectId: string,
    threadId: string,
    status: "syncing" | "synced" | "conflict" | "failed",
  ): void {
    try {
      const target = { projectId, id: threadId };
      if (status === "syncing") {
        this.options.projects.markConversationPending(target);
      } else if (status === "synced") {
        this.options.projects.markConversationCompleted(target);
      } else {
        this.options.projects.markConversationAttention(target);
        this.options.projects.markConversationUnread(target);
      }
    } catch {
      // A task can be removed while a late delivery result is queued.
    }
  }

  private publishDeliveryNotification(
    projectId: string,
    notification: JsonRpcOutgoing,
  ): void {
    const event = serverSentEvent(notification);
    for (const client of this.projectEventClients(projectId)) {
      client.write(event);
    }
  }

  private async executeAutomation(
    automation: HostAutomation,
  ): Promise<AutomationExecutionResult> {
    const project = this.requireProject(automation.projectId);
    if (!this.initializationParams.has(project.id)) {
      this.initializationParams.set(project.id, {
        capabilities: { executionApprovals: false },
      });
    }
    const context = await this.runtimeBridge().runtime(
      project.id,
      project.basePath,
      this.options.oauthCallbackUrlPrefix
        ? normalizeOAuthCallbackUrlPrefix(this.options.oauthCallbackUrlPrefix)
        : undefined,
    );
    const started = await requestRuntimePeer(context.peer, "thread/start");
    const threadId =
      started &&
      typeof started === "object" &&
      !Array.isArray(started) &&
      typeof (started as Record<string, unknown>).threadId === "string"
        ? (started as { threadId: string }).threadId
        : undefined;
    if (!threadId) {
      throw new Error("Automation task did not return a thread id");
    }

    this.options.projects.upsertConversation({
      projectId: project.id,
      id: threadId,
      title: `⏱ ${automation.name}`,
    });
    this.options.projects.setConversationWorkspace(
      { projectId: project.id, id: threadId },
      { mode: "folder", path: project.basePath },
    );
    await this.conversationChanges.ensureSnapshot(
      project.id,
      threadId,
      project.basePath,
    );

    const completed = new Promise<AutomationExecutionResult>((resolve) => {
      this.automationTurnWaiters.set(threadId, { resolve });
    });
    try {
      await requestRuntimePeer(context.peer, "turn/start", {
        threadId,
        input: [
          `Scheduled automation: ${automation.name}`,
          automation.prompt,
          "Run read-only checks only. Do not modify files, create commits, or change external state.",
          "End the final response with exactly one status marker: AUTOMATION_STATUS: ok when no action is needed, or AUTOMATION_STATUS: attention when the user should investigate.",
        ].join("\n\n"),
      });
      return await completed;
    } catch (error) {
      this.automationTurnWaiters.delete(threadId);
      throw error;
    }
  }

  private resolveAutomationTurn(
    projectId: string,
    message: JsonRpcOutgoing,
  ): void {
    if (
      !("method" in message) ||
      (message.method !== "turn/completed" && message.method !== "turn/failed")
    ) {
      return;
    }
    const params = message.params as Record<string, unknown> | undefined;
    const threadId = params?.threadId;
    if (typeof threadId !== "string") return;
    const waiter = this.automationTurnWaiters.get(threadId);
    if (!waiter) return;
    this.automationTurnWaiters.delete(threadId);
    try {
      this.options.projects.markConversationUnread({
        projectId,
        id: threadId,
      });
    } catch {
      // A task can be removed while a late automation result is queued.
    }
    const diagnostics = params?.diagnostics as
      { toolCalls?: readonly { isError?: boolean }[] } | undefined;
    waiter.resolve(
      message.method === "turn/failed"
        ? {
            threadId,
            error:
              typeof params?.error === "string"
                ? params.error
                : "Automation failed",
          }
        : {
            threadId,
            output: typeof params?.output === "string" ? params.output : "",
            toolError: diagnostics?.toolCalls?.some((tool) => tool.isError),
          },
    );
  }

  private requireProject(projectId: string) {
    const project = this.options.projects.project(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    return project;
  }

  publishConnectorAuthorization(projectId: string, url: string): void {
    const notification = {
      jsonrpc: "2.0",
      method: "connector/authorization-requested",
      params: { url },
    } satisfies JsonRpcOutgoing;
    const event = serverSentEvent(notification);
    for (const client of this.projectEventClients(projectId)) {
      client.write(event);
    }
  }

  private handleOAuthCallback(
    response: ServerResponse,
    url: URL,
    connectorId: string,
  ): void {
    const code = url.searchParams.get("code") ?? undefined;
    const oauthError = url.searchParams.get("error") ?? undefined;
    const state = url.searchParams.get("state") ?? "";
    const accepted =
      Boolean(state) &&
      Boolean(code || oauthError) &&
      Boolean(
        this.options.acceptOAuthCallback?.({
          connectorId,
          ...(code ? { code } : {}),
          ...(oauthError ? { error: oauthError } : {}),
          state,
        }),
      );
    const authorized = accepted && Boolean(code);
    response.writeHead(authorized ? 200 : 400, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    response.end(
      oauthResultPage(
        authorized
          ? "Connection complete"
          : accepted
            ? "Authorization cancelled"
            : "Connection failed",
        authorized
          ? "You can close this window and return to Threadlight."
          : accepted
            ? "No connection was created. Return to Threadlight to try again."
            : "The authorization response was invalid or expired.",
      ),
    );
  }

  private oauthCallbackUrlPrefix(request: IncomingMessage): string | undefined {
    if (this.options.oauthCallbackUrlPrefix) {
      return normalizeOAuthCallbackUrlPrefix(
        this.options.oauthCallbackUrlPrefix,
      );
    }
    const endpoint = request.headers["x-threadlight-host-endpoint"];
    if (typeof endpoint === "string") {
      return `${normalizeHostEndpoint(endpoint)}/v1/host/oauth/callback`;
    }
    const host = request.headers.host;
    if (!host) return;
    const forwardedProtocol = request.headers["x-forwarded-proto"];
    const protocol =
      typeof forwardedProtocol === "string" &&
      forwardedProtocol.split(",", 1)[0]?.trim() === "https"
        ? "https"
        : "http";
    return `${normalizeHostEndpoint(`${protocol}://${host}`)}/v1/host/oauth/callback`;
  }

  private projectEventClients(projectId: string): Set<ServerResponse> {
    let clients = this.eventClients.get(projectId);
    if (!clients) {
      clients = new Set();
      this.eventClients.set(projectId, clients);
    }
    return clients;
  }

  private conversationWorkspace(
    projectId: string,
    threadId: string,
  ): { project: HostProjectSummary; workspace: TaskWorkspace } {
    const project = this.options.projects.project(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const conversation = project.conversations.find(
      ({ id }) => id === threadId,
    );
    if (!conversation) throw new Error("Unknown conversation");
    return {
      project,
      workspace: conversation.workspace ?? {
        mode: "folder",
        path: project.basePath,
      },
    };
  }

  private requireWorktreeWorkspace(context: {
    workspace: TaskWorkspace;
  }): GitTaskWorkspace {
    if (context.workspace.mode !== "worktree") {
      throw new Error("Only isolated worktree tasks can be delivered");
    }
    return context.workspace;
  }

  private async discardPendingWorkspace(
    pending: PendingResponse,
  ): Promise<void> {
    if (pending.pendingSnapshotId) {
      await this.conversationChanges
        .discardPendingSnapshot(pending.projectId, pending.pendingSnapshotId)
        .catch(() => undefined);
    }
    if (pending.workspace) {
      await this.taskWorkspaces
        .remove(pending.workspace)
        .catch(() => undefined);
    }
  }

  private async disposeConversationWorkspace(
    target: {
      projectId: string;
      id: string;
    },
    workspace?: TaskWorkspace,
  ): Promise<void> {
    const project = this.options.projects.project(target.projectId);
    await this.conversationChanges
      .deleteSnapshot(target.projectId, target.id)
      .catch(() => undefined);
    if (project) {
      await this.worktreeDelivery
        .deleteJournal({
          projectId: target.projectId,
          threadId: target.id,
          projectPath: project.basePath,
        })
        .catch(() => undefined);
    }
    if (!workspace || workspace.mode === "folder") return;
    const key = runtimeKey(target.projectId, workspace.path);
    const runtime = this.runtimes.get(key);
    if (runtime) {
      this.runtimes.delete(key);
      this.runningThreads.clearRuntime(key);
      runtime.unsubscribe();
      runtime.unsubscribeExit();
      await runtime.peer.stop().catch(() => undefined);
    }
    await this.taskWorkspaces.remove(workspace);
  }

  private handleRuntimeExit(
    projectId: string,
    context: RuntimeContext,
    error: Error,
  ): void {
    const key = runtimeKey(projectId, context.workspacePath);
    const interrupted = this.runningThreads.clearRuntime(key);
    const runtimeError = boundedRuntimeError(error);
    if (this.runtimes.get(key) === context) {
      this.runtimes.delete(key);
    }
    context.unsubscribe();
    context.unsubscribeExit();
    for (const owner of interrupted) {
      const failureKey = conversationRuntimeFailureKey(
        projectId,
        owner.threadId,
      );
      this.runtimeFailures.set(failureKey, runtimeError);
      try {
        const target = { projectId, id: owner.threadId };
        this.options.projects.markConversationAttention(target);
        this.options.projects.markConversationUnread(target);
      } catch {
        // The task may have been deleted while its runtime was exiting.
      }
      const turnId = owner.turnId ?? `runtime-exit:${owner.threadId}`;
      const notification: JsonRpcOutgoing = {
        jsonrpc: "2.0",
        method: "turn/failed",
        params: {
          threadId: owner.threadId,
          turnId,
          revision: (owner.revision ?? 0) + 1,
          message: {
            id: `runtime-exited:${turnId}`,
            role: "assistant",
            text: runtimeError,
            error: true,
          },
          error: runtimeError,
        },
      };
      const event = serverSentEvent(notification);
      for (const client of this.projectEventClients(projectId)) {
        client.write(event);
      }
    }
    for (const [id, pending] of this.pending) {
      if (pending.runtimeKey !== key) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      void this.discardPendingWorkspace(pending);
      this.writeJson(pending.response, 502, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: {
          code: -32002,
          message: runtimeError,
        },
      } satisfies JsonRpcResponse);
    }
  }

  private async stopRuntimes(): Promise<void> {
    const contexts = [...this.runtimes.values()];
    this.runtimes.clear();
    this.runningThreads.clear();
    this.runtimeFailures.clear();
    for (const context of contexts) {
      context.unsubscribe();
      context.unsubscribeExit();
      await context.peer.stop();
    }
    for (const clients of this.eventClients.values()) {
      for (const client of clients) client.end();
      clients.clear();
    }
    this.eventClients.clear();
  }

  private authorized(
    request: IncomingMessage,
    allowWebSocketProtocol = false,
  ): boolean {
    const authorization = request.headers.authorization;
    const value = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : allowWebSocketProtocol
        ? browserWebSocketToken(request)
        : undefined;
    if (value === undefined) return false;
    const supplied = Buffer.from(value);
    const expected = Buffer.from(this.options.token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }

  private handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const url = new URL(request.url ?? "/", "http://host.local");
    if (
      url.pathname !== "/v1/host/terminal" ||
      !this.terminalGateway ||
      !this.terminalWebSockets
    ) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (!this.authorized(request, true)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    const origin = request.headers.origin;
    if (origin && !this.isAllowedOrigin(origin, request)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    this.terminalWebSockets.handleUpgrade(request, socket, head, (webSocket) =>
      this.terminalGateway?.accept(webSocket),
    );
  }

  private applyCors(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin;
    if (origin && this.isAllowedOrigin(origin, request)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Threadlight-Host-Endpoint",
      );
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, OPTIONS",
      );
    }
  }

  private isAllowedOrigin(origin: string, request: IncomingMessage): boolean {
    if (this.options.allowedOrigins?.includes(origin)) return true;

    const requestHost = request.headers.host;
    if (!requestHost) return false;
    try {
      const parsedOrigin = new URL(origin);
      if (
        parsedOrigin.protocol !== "http:" &&
        parsedOrigin.protocol !== "https:"
      ) {
        return false;
      }
      const requestOrigin = new URL(`${parsedOrigin.protocol}//${requestHost}`)
        .origin;
      return parsedOrigin.origin === requestOrigin;
    } catch {
      return false;
    }
  }

  private writeJson(
    response: ServerResponse,
    status: number,
    value: unknown,
  ): void {
    if (response.writableEnded) return;
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  }

  private writeBinary(response: ServerResponse, content: Buffer): void {
    if (response.writableEnded) return;
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(content.byteLength),
      "Cache-Control": "no-store",
    });
    response.end(content);
  }
}

import {
  rejectUpgrade,
  serverSentEvent,
  browserWebSocketToken,
  runtimeRoute,
  hostConversationWorkspaceRoute,
  runtimeKey,
  conversationRuntimeFailureKey,
  boundedRuntimeError,
  initializeRuntimePeer,
  requestRuntimePeer,
  hostAttachmentRoute,
  attachmentUploadRoot,
  attachmentName,
  attachmentMimeType,
  attachmentSize,
  parseProviderTestRequest,
  isModelProvider,
  jsonBody,
  requiredString,
  requiredQuery,
  optionalStringArray,
  requiredBoolean,
  listHostDirectories,
  expandHomeDirectory,
  trailingPathSegment,
  isMissingPathError,
  readBody,
  readBinaryBody,
  audioMimeType,
  parseHostSearchRequest,
  parseAutomationRequest,
  parseAutomationTarget,
  developmentModeForThreadStart,
  hostOAuthCallbackRoute,
  hostDiagnosticsProjectId,
  hostDiagnosticBundleProjectId,
  parseDiagnosticBundleRequest,
  hostAutomationsProjectId,
  normalizeHostEndpoint,
  normalizeOAuthCallbackUrlPrefix,
  oauthResultPage,
} from "./host-http.js";
