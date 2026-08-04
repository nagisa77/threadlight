import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
} from "node:path";
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
  projectDiagnostics,
  ProjectSearchService,
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
import type {
  TerminalSessionController,
} from "@threadlight/terminal-core";
import type {
  AttachmentData,
  HostAutomation,
  HostAutomationCreateRequest,
  HostAutomationSchedule,
  HostAutomationUpdateRequest,
  HostDirectoryListing,
  HostProjectSummary,
  HostProviderDiagnostic,
  HostProviderTestRequest,
  HostSearchRequest,
  HostSearchResult,
  HostSettingsUpdate,
  HostDeliverySource,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  JsonRpcResponse,
  ThreadlightHostHealth,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import { WebSocketServer } from "ws";

import { HostTerminalGateway } from "./host-terminal-gateway.js";
import { listHostFiles, readHostFile } from "./host-files.js";
import type { RuntimePeer } from "./remote-runtime-peer.js";
import { RemoteWorkspace } from "./remote-workspace.js";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_TERMINAL_MESSAGE_BYTES = 256 * 1024;
const RPC_TIMEOUT_MS = 120_000;
const EVENT_HEARTBEAT_INTERVAL_MS = 20_000;
const BROWSER_TERMINAL_TOKEN_PREFIX = "threadlight.token.";

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
}

export interface ThreadlightHostAddress {
  host: string;
  port: number;
}

interface RuntimeContext {
  peer: RuntimePeer;
  workspace: RemoteWorkspace;
  projectId: string;
  workspacePath: string;
  unsubscribe: () => void;
  unsubscribeExit: () => void;
}

interface PendingResponse {
  projectId: string;
  runtimeKey: string;
  originalId: JsonRpcId;
  method: string;
  response: ServerResponse;
  timeout: NodeJS.Timeout;
  workspace?: TaskWorkspace;
  pendingSnapshotId?: string;
}

export class ThreadlightHostServer {
  private readonly listenHost: string;
  private readonly port: number;
  private readonly runtimes = new Map<string, RuntimeContext>();
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
    if (
      !Number.isFinite(this.eventHeartbeatIntervalMs) ||
      this.eventHeartbeatIntervalMs <= 0
    ) {
      throw new Error("Host event heartbeat interval must be positive.");
    }
    this.automationStore = new AutomationStore(
      join(options.homePath, "automations.json"),
    );
    this.automationScheduler = new AutomationScheduler(
      this.automationStore,
      {
        execute: (automation) => this.executeAutomation(automation),
        notify: () => undefined,
      },
    );
    this.taskWorkspaces =
      options.taskWorkspaces ??
      new TaskWorkspaceManager(join(options.homePath, "worktrees"), {
        standaloneRoot: join(options.homePath, "standalone", "workspaces"),
      });
    this.conversationChanges =
      options.conversationChanges ??
      new ConversationChangeTracker(
        join(options.homePath, "review-snapshots"),
      );
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
      pendingResponses.map((pending) =>
        this.discardPendingWorkspace(pending),
      ),
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
        this.handleOAuthCallback(
          response,
          url,
          oauthCallback.connectorId,
        );
      } catch {
        this.writeJson(response, 400, {
          error: "Invalid OAuth callback",
        });
      }
      return;
    }
    if (!this.authorized(request)) {
      this.writeJson(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/health") {
        this.writeJson(response, 200, {
          ok: true,
          protocolVersion: 2,
          hostId: this.options.hostId,
          name: this.options.name,
          homePath: this.options.homePath,
          ...(this.terminalGateway
            ? { capabilities: { terminal: true } }
            : {}),
        } satisfies ThreadlightHostHealth);
        return;
      }
      if (await this.handleHostApi(request, response, url)) return;
      const route = runtimeRoute(url.pathname);
      if (route) {
        await this.handleRuntimeApi(request, response, url, route);
        return;
      }
      this.writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      this.writeJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleHostApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const conversationRoute = hostConversationWorkspaceRoute(url.pathname);
    if (conversationRoute) {
      await this.handleConversationWorkspaceApi(
        request,
        response,
        url,
        conversationRoute,
      );
      return true;
    }
    const attachmentRoute = hostAttachmentRoute(url.pathname);
    if (attachmentRoute) {
      if (request.method === "POST" && !attachmentRoute.attachmentId) {
        this.writeJson(
          response,
          200,
          await this.uploadHostAttachment(
            request,
            url,
            attachmentRoute.projectId,
          ),
        );
        return true;
      }
      if (request.method === "GET" && attachmentRoute.attachmentId) {
        await this.writeHostAttachment(
          response,
          attachmentRoute.projectId,
          attachmentRoute.attachmentId,
        );
        return true;
      }
      return false;
    }
    const diagnosticsProjectId = hostDiagnosticsProjectId(url.pathname);
    if (request.method === "GET" && diagnosticsProjectId) {
      const project = this.options.projects.project(diagnosticsProjectId);
      if (!project) {
        throw new Error(`Unknown project: ${diagnosticsProjectId}`);
      }
      this.writeJson(response, 200, projectDiagnostics(project));
      return true;
    }
    const automationsProjectId = hostAutomationsProjectId(url.pathname);
    if (request.method === "GET" && automationsProjectId) {
      this.requireProject(automationsProjectId);
      this.writeJson(
        response,
        200,
        this.automationStore.snapshot(automationsProjectId),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/create"
    ) {
      const automation = parseAutomationRequest(await jsonBody(request));
      this.requireProject(automation.projectId);
      this.writeJson(response, 200, this.automationStore.create(automation));
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/update"
    ) {
      const automation = parseAutomationRequest(
        await jsonBody(request),
        true,
      );
      this.requireProject(automation.projectId);
      this.writeJson(response, 200, this.automationStore.update(automation));
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/delete"
    ) {
      const target = parseAutomationTarget(await jsonBody(request));
      this.requireProject(target.projectId);
      this.writeJson(
        response,
        200,
        this.automationStore.delete(target.projectId, target.id),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/run"
    ) {
      const target = parseAutomationTarget(await jsonBody(request));
      this.requireProject(target.projectId);
      const automation = this.automationStore.get(target.id);
      if (!automation || automation.projectId !== target.projectId) {
        throw new Error("Unknown automation");
      }
      this.automationScheduler.runNow(target.id);
      this.writeJson(
        response,
        200,
        this.automationStore.snapshot(target.projectId),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/projects") {
      this.writeJson(response, 200, this.options.projects.snapshot());
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/host/search") {
      this.writeJson(
        response,
        200,
        await this.searchHostProject(
          parseHostSearchRequest(await jsonBody(request)),
        ),
      );
      return true;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/v1/host/directories"
    ) {
      this.writeJson(
        response,
        200,
        await listHostDirectories(url.searchParams.get("path") ?? ""),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/files") {
      this.writeJson(
        response,
        200,
        await listHostFiles(url.searchParams.get("path") ?? ""),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/file") {
      this.writeJson(
        response,
        200,
        await readHostFile(url.searchParams.get("path") ?? ""),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/register"
    ) {
      const body = await jsonBody(request);
      this.writeJson(
        response,
        200,
        this.options.projects.register(requiredString(body.path, "path")),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/standalone"
    ) {
      this.writeJson(
        response,
        200,
        this.options.projects.activateStandalone(),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/activate"
    ) {
      const body = await jsonBody(request);
      this.writeJson(
        response,
        200,
        this.options.projects.activate(
          requiredString(body.projectId, "projectId"),
        ),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/update"
    ) {
      const body = await jsonBody(request);
      this.writeJson(
        response,
        200,
        this.options.projects.updateProject({
          id: requiredString(body.id, "id"),
          pinned: requiredBoolean(body.pinned, "pinned"),
        }),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname.startsWith("/v1/host/conversations/")
    ) {
      const body = await jsonBody(request);
      const target = {
        projectId: requiredString(body.projectId, "projectId"),
        id: requiredString(body.id, "id"),
      };
      let snapshot;
      if (url.pathname.endsWith("/upsert")) {
        snapshot = this.options.projects.upsertConversation({
          ...target,
          title: requiredString(body.title, "title"),
        });
      } else if (url.pathname.endsWith("/update")) {
        snapshot = this.options.projects.updateConversation({
          ...target,
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.pinned === "boolean"
            ? { pinned: body.pinned }
            : {}),
          ...(typeof body.archived === "boolean"
            ? { archived: body.archived }
            : {}),
          ...(body.accessMode === "approval" || body.accessMode === "full"
            ? { accessMode: body.accessMode }
            : {}),
        });
      } else if (url.pathname.endsWith("/read")) {
        snapshot = this.options.projects.markConversationRead(target);
      } else if (url.pathname.endsWith("/delete")) {
        const workspace = this.options.projects
          .project(target.projectId)
          ?.conversations.find(({ id }) => id === target.id)
          ?.workspace;
        snapshot = this.options.projects.deleteConversation(target);
        await this.disposeConversationWorkspace(target, workspace);
      } else {
        return false;
      }
      this.writeJson(response, 200, snapshot);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/settings") {
      this.writeJson(response, 200, this.options.settings.snapshot());
      return true;
    }
    if (request.method === "PUT" && url.pathname === "/v1/host/settings") {
      const body = (await jsonBody(request)) as unknown as HostSettingsUpdate;
      const snapshot = this.options.settings.update(body);
      await this.stopRuntimes();
      this.writeJson(response, 200, snapshot);
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/provider/test"
    ) {
      const diagnostic = await (
        this.options.testProvider ?? testProviderConnection
      )(
        parseProviderTestRequest(await jsonBody(request)),
        this.options.settings.runtimeSettings(),
      );
      this.writeJson(response, 200, diagnostic);
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/audio/transcriptions"
    ) {
      this.writeJson(
        response,
        200,
        await this.transcribeHostAudio(request, url),
      );
      return true;
    }
    return false;
  }

  private async handleConversationWorkspaceApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: { projectId: string; threadId: string; action: string },
  ): Promise<void> {
    const context = this.conversationWorkspace(
      route.projectId,
      route.threadId,
    );
    const { project, workspace } = context;

    if (request.method === "GET" && route.action === "changes") {
      this.writeJson(
        response,
        200,
        await this.conversationChanges.changes(
          project.id,
          route.threadId,
          workspace.path,
        ),
      );
      return;
    }
    if (request.method === "POST" && route.action === "changes/restore") {
      const body = await jsonBody(request);
      this.writeJson(
        response,
        200,
        await this.conversationChanges.restore(
          project.id,
          route.threadId,
          workspace.path,
          requiredString(body.revision, "revision"),
          optionalStringArray(body.paths, "paths"),
        ),
      );
      return;
    }
    if (request.method === "GET" && route.action === "workspace/list") {
      this.writeJson(
        response,
        200,
        await this.conversationChanges.listWorkspace(
          workspace.path,
          url.searchParams.get("path") ?? "",
        ),
      );
      return;
    }
    if (request.method === "GET" && route.action === "workspace/file") {
      this.writeJson(
        response,
        200,
        await this.conversationChanges.readWorkspaceFile(
          workspace.path,
          requiredQuery(url, "path"),
        ),
      );
      return;
    }

    const body =
      request.method === "POST" ? await jsonBody(request) : undefined;
    const revision =
      request.method === "GET"
        ? requiredQuery(url, "revision")
        : requiredString(body?.revision, "revision");
    const worktree = this.requireWorktreeWorkspace(context);
    const deliveryRequest = {
      projectId: project.id,
      threadId: route.threadId,
      revision,
      projectPath: project.basePath,
      workspace: worktree,
    };

    if (request.method === "POST" && route.action === "delivery/preflight") {
      this.writeJson(
        response,
        200,
        await this.worktreeDelivery.preflight(deliveryRequest),
      );
      return;
    }
    if (request.method === "POST" && route.action === "delivery/apply") {
      this.writeJson(
        response,
        200,
        await this.applyAutomaticDelivery(deliveryRequest, "retry"),
      );
      return;
    }
    if (request.method === "POST" && route.action === "delivery/undo") {
      this.writeJson(
        response,
        200,
        await this.worktreeDelivery.undo(deliveryRequest),
      );
      return;
    }
    if (request.method === "POST" && route.action === "delivery/commit") {
      this.writeJson(
        response,
        200,
        await this.worktreeDelivery.commit(
          deliveryRequest,
          requiredString(body?.message, "message"),
        ),
      );
      return;
    }

    const codeHostRequest = {
      projectId: project.id,
      threadId: route.threadId,
      revision,
      workspace: worktree,
    };
    if (request.method === "GET" && route.action === "code-host/status") {
      this.writeJson(
        response,
        200,
        await this.codeHostDelivery.status(codeHostRequest),
      );
      return;
    }
    if (
      request.method === "POST" &&
      route.action === "code-host/commit-push"
    ) {
      this.writeJson(
        response,
        200,
        await this.codeHostDelivery.commitAndPush(
          codeHostRequest,
          requiredString(body?.message, "message"),
        ),
      );
      return;
    }
    if (
      request.method === "POST" &&
      route.action === "code-host/create-pr"
    ) {
      this.writeJson(
        response,
        200,
        await this.codeHostDelivery.createDraftPullRequest(
          codeHostRequest,
          {
            title: requiredString(body?.title, "title"),
            ...(typeof body?.body === "string" ? { body: body.body } : {}),
          },
        ),
      );
      return;
    }
    this.writeJson(response, 404, { error: "Not found" });
  }

  private async transcribeHostAudio(
    request: IncomingMessage,
    url: URL,
  ): Promise<{ text: string }> {
    const apiKey = this.options.settings.runtimeSettings().openAIApiKey;
    if (!apiKey) {
      throw new Error("请先在设置中配置 OpenAI API Key，再使用语音输入。");
    }
    const mimeType = audioMimeType(url.searchParams.get("mimeType"));
    const declaredLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_TRANSCRIPTION_BYTES
    ) {
      throw new Error("录音超过 25 MB，请缩短后重试。");
    }
    const content = await readBinaryBody(request, MAX_TRANSCRIPTION_BYTES);
    const audio = Uint8Array.from(content).buffer;
    const text = await (this.options.transcribeAudio ?? transcribeAudio)(
      { audio, mimeType },
      { apiKey },
    );
    return { text };
  }

  private searchHostProject(
    request: HostSearchRequest,
  ): Promise<readonly HostSearchResult[]> {
    const project = this.options.projects.project(request.projectId);
    if (!project) throw new Error(`Unknown project: ${request.projectId}`);
    const conversation = request.threadId
      ? project.conversations.find(
          ({ id }) => id === request.threadId,
        )
      : undefined;
    if (request.threadId && !conversation) {
      throw new Error("Unknown conversation");
    }
    return this.projectSearch.search({
      project,
      workspacePath: conversation?.workspace?.path ?? project.basePath,
      query: request.query,
      mode: request.mode,
      limit: request.limit ?? 80,
    });
  }

  private async uploadHostAttachment(
    request: IncomingMessage,
    url: URL,
    projectId: string,
  ): Promise<AttachmentData> {
    const project = this.options.projects.project(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const name = attachmentName(url.searchParams.get("name"));
    const mimeType = attachmentMimeType(url.searchParams.get("mimeType"));
    const size = attachmentSize(url.searchParams.get("size"));
    const declaredLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_ATTACHMENT_BYTES
    ) {
      throw new Error("Attachment must be smaller than 50 MB.");
    }
    const content = await readBinaryBody(request, MAX_ATTACHMENT_BYTES);
    if (content.byteLength !== size) {
      throw new Error("Attachment size changed during upload.");
    }

    const id = randomUUID();
    const root = attachmentUploadRoot(project.basePath);
    await mkdir(root, { recursive: true });
    const path = join(root, `${id}-${name}`);
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
    return {
      id,
      name,
      mimeType,
      size,
      kind: mimeType.startsWith("image/") ? "image" : "file",
      path,
    };
  }

  private async writeHostAttachment(
    response: ServerResponse,
    projectId: string,
    attachmentId: string,
  ): Promise<void> {
    const project = this.options.projects.project(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    if (!/^[a-f0-9-]{36}$/i.test(attachmentId)) {
      throw new Error("Invalid attachment id.");
    }
    const root = attachmentUploadRoot(project.basePath);
    const entry = (await readdir(root, { withFileTypes: true })).find(
      (candidate) =>
        candidate.isFile() &&
        candidate.name.startsWith(`${attachmentId}-`),
    );
    if (!entry) throw new Error("Attachment not found.");
    const content = await readFile(join(root, entry.name));
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(content.byteLength),
      "Cache-Control": "private, max-age=3600",
    });
    response.end(content);
  }

  private async handleRuntimeApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: { projectId: string; action: string },
  ): Promise<void> {
    const project = this.options.projects.project(route.projectId);
    if (!project) throw new Error(`Unknown project: ${route.projectId}`);
    if (request.method === "GET" && route.action === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write(": ping\n\n");
      const clients = this.projectEventClients(project.id);
      clients.add(response);
      const heartbeat = setInterval(() => {
        if (!response.writableEnded) response.write(": ping\n\n");
      }, this.eventHeartbeatIntervalMs);
      response.once("close", () => {
        clearInterval(heartbeat);
        clients.delete(response);
      });
      return;
    }
    if (request.method === "POST" && route.action === "/rpc") {
      await this.forwardRpc(
        request,
        response,
        project.id,
        project.basePath,
        this.oauthCallbackUrlPrefix(request),
      );
      return;
    }
    const context = await this.runtime(
      project.id,
      project.basePath,
      this.oauthCallbackUrlPrefix(request),
    );
    if (request.method === "GET" && route.action === "/workspace/list") {
      this.writeJson(
        response,
        200,
        await context.workspace.list(url.searchParams.get("path") ?? ""),
      );
      return;
    }
    if (request.method === "GET" && route.action === "/workspace/file") {
      this.writeJson(
        response,
        200,
        await context.workspace.file(url.searchParams.get("path") ?? ""),
      );
      return;
    }
    if (request.method === "GET" && route.action === "/workspace/changes") {
      this.writeJson(response, 200, await context.workspace.changes());
      return;
    }
    this.writeJson(response, 404, { error: "Not found" });
  }

  private async runtime(
    projectId: string,
    projectRoot: string,
    oauthCallbackUrlPrefix?: string,
  ): Promise<RuntimeContext> {
    const key = runtimeKey(projectId, projectRoot);
    const existing = this.runtimes.get(key);
    if (existing) return existing;
    const peer = this.options.createPeer({
      projectId,
      projectRoot,
      projectBasePath:
        this.options.projects.project(projectId)?.basePath ?? projectRoot,
      ...(oauthCallbackUrlPrefix ? { oauthCallbackUrlPrefix } : {}),
    });
    await peer.start();
    if (this.initializationParams.has(projectId)) {
      try {
        await initializeRuntimePeer(
          peer,
          this.initializationParams.get(projectId),
        );
      } catch (error) {
        await peer.stop().catch(() => undefined);
        throw error;
      }
    }
    const context: RuntimeContext = {
      peer,
      workspace: new RemoteWorkspace(projectRoot),
      projectId,
      workspacePath: projectRoot,
      unsubscribe: () => undefined,
      unsubscribeExit: () => undefined,
    };
    context.unsubscribe = peer.onMessage((message) => {
      void this.handlePeerMessage(projectId, context, message);
    });
    context.unsubscribeExit =
      peer.onExit?.((error) =>
        this.handleRuntimeExit(projectId, context, error),
      ) ?? (() => undefined);
    this.runtimes.set(key, context);
    return context;
  }

  private async forwardRpc(
    request: IncomingMessage,
    response: ServerResponse,
    projectId: string,
    projectRoot: string,
    oauthCallbackUrlPrefix?: string,
  ): Promise<void> {
    const message = JSON.parse(
      await readBody(request, MAX_BODY_BYTES),
    ) as JsonRpcRequest;
    if (
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      message.id === undefined
    ) {
      throw new Error("A JSON-RPC request with an id is required.");
    }
    const params =
      message.params && typeof message.params === "object"
        ? (message.params as Record<string, unknown>)
        : undefined;
    let workspace: TaskWorkspace = { mode: "folder", path: projectRoot };
    let pendingSnapshotId: string | undefined;
    if (message.method === "thread/start") {
      workspace =
        this.options.projects.project(projectId)?.scope === "standalone"
          ? await this.taskWorkspaces.prepareStandalone()
          : await this.taskWorkspaces.prepare(projectId, projectRoot);
      pendingSnapshotId = `host:${randomUUID()}`;
      try {
        await this.conversationChanges.beginPendingSnapshot(
          projectId,
          pendingSnapshotId,
          workspace.path,
        );
      } catch (error) {
        await this.taskWorkspaces.remove(workspace).catch(() => undefined);
        throw error;
      }
    } else if (typeof params?.threadId === "string") {
      const conversation = this.options.projects
        .project(projectId)
        ?.conversations.find(({ id }) => id === params.threadId);
      workspace = conversation?.workspace ?? workspace;
      if (
        message.method === "thread/resume" ||
        message.method === "turn/start"
      ) {
        await this.conversationChanges.ensureSnapshot(
          projectId,
          params.threadId,
          workspace.path,
        );
      }
    }
    let context: RuntimeContext;
    try {
      context = await this.runtime(
        projectId,
        workspace.path,
        oauthCallbackUrlPrefix,
      );
    } catch (error) {
      if (pendingSnapshotId) {
        await this.conversationChanges
          .discardPendingSnapshot(projectId, pendingSnapshotId)
          .catch(() => undefined);
        await this.taskWorkspaces.remove(workspace).catch(() => undefined);
      }
      throw error;
    }
    if (message.method === "initialize") {
      this.initializationParams.set(projectId, params);
    }
    const contextKey = runtimeKey(projectId, workspace.path);
    if (
      message.method === "turn/start" &&
      typeof params?.threadId === "string"
    ) {
      try {
        this.options.projects.markConversationPending({
          projectId,
          id: params.threadId,
        });
      } catch {
        // The app-server remains authoritative for unknown threads.
      }
    }
    const internalId = `host:${randomUUID()}`;
    const timeout = setTimeout(() => {
      const pending = this.pending.get(internalId);
      if (!pending) return;
      this.pending.delete(internalId);
      this.writeJson(pending.response, 504, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: { code: -32001, message: "Host runtime request timed out." },
      });
      void this.discardPendingWorkspace(pending);
    }, RPC_TIMEOUT_MS);
    this.pending.set(internalId, {
      projectId,
      runtimeKey: contextKey,
      originalId: message.id,
      method: message.method,
      response,
      timeout,
      ...(message.method === "thread/start" ? { workspace } : {}),
      ...(pendingSnapshotId ? { pendingSnapshotId } : {}),
    });
    try {
      await context.peer.send({ ...message, id: internalId });
    } catch (error) {
      clearTimeout(timeout);
      this.pending.delete(internalId);
      if (pendingSnapshotId) {
        await this.conversationChanges.discardPendingSnapshot(
          projectId,
          pendingSnapshotId,
        );
        await this.taskWorkspaces.remove(workspace);
      }
      throw error;
    }
  }

  private async handlePeerMessage(
    projectId: string,
    context: RuntimeContext,
    message: JsonRpcOutgoing,
  ): Promise<void> {
    if ("id" in message && typeof message.id === "string") {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (pending.method === "thread/start" && "result" in message) {
          const threadId = (message.result as { threadId?: unknown } | undefined)
            ?.threadId;
          if (typeof threadId === "string") {
            const project = this.options.projects.project(projectId);
            if (project && pending.workspace) {
              this.options.projects.setConversationWorkspace(
                { projectId, id: threadId },
                pending.workspace,
              );
              if (pending.pendingSnapshotId) {
                await this.conversationChanges.commitPendingSnapshot(
                  projectId,
                  pending.pendingSnapshotId,
                  threadId,
                );
              }
            }
          } else {
            await this.discardPendingWorkspace(pending);
          }
        } else if (pending.method === "thread/start") {
          await this.discardPendingWorkspace(pending);
        }
        this.writeJson(pending.response, 200, {
          ...message,
          id: pending.originalId,
        } satisfies JsonRpcResponse);
        return;
      }
    }
    this.recordNotification(projectId, message);
    try {
      await this.synchronizeCompletedWorktree(projectId, message);
    } catch {
      // Delivery failures are persisted as attention and published to clients.
    }
    this.resolveAutomationTurn(projectId, message);
    const event = serverSentEvent(message);
    for (const client of this.projectEventClients(projectId)) {
      client.write(event);
    }
  }

  private recordNotification(
    projectId: string,
    message: JsonRpcOutgoing,
  ): void {
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
        this.options.projects.markConversationCompleted({
          projectId,
          id: threadId,
        });
      }
    } catch {
      // Late notifications may arrive after a task is deleted.
    }
  }

  private async synchronizeCompletedWorktree(
    projectId: string,
    message: JsonRpcOutgoing,
  ): Promise<void> {
    if (!("method" in message) || message.method !== "turn/completed") {
      return;
    }
    const threadId = (
      message.params as { threadId?: unknown } | undefined
    )?.threadId;
    if (typeof threadId !== "string") return;
    const project = this.options.projects.project(projectId);
    const workspace = project?.conversations.find(
      (conversation) => conversation.id === threadId,
    )?.workspace;
    if (!project || workspace?.mode !== "worktree") return;
    let changes;
    try {
      changes = await this.conversationChanges.changes(
        projectId,
        threadId,
        workspace.path,
      );
    } catch (error) {
      this.recordDeliveryConversationState(projectId, threadId, "failed");
      this.publishDeliveryNotification(projectId, {
        jsonrpc: "2.0",
        method: "delivery/failed",
        params: {
          projectId,
          threadId,
          source: "lifecycle",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
    await this.applyAutomaticDelivery({
      projectId,
      threadId,
      revision: changes.revision,
      projectPath: project.basePath,
      workspace,
    }, "lifecycle");
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
    const context = await this.runtime(
      project.id,
      project.basePath,
      this.options.oauthCallbackUrlPrefix
        ? normalizeOAuthCallbackUrlPrefix(
            this.options.oauthCallbackUrlPrefix,
          )
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
      (message.method !== "turn/completed" &&
        message.method !== "turn/failed")
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
      | { toolCalls?: readonly { isError?: boolean }[] }
      | undefined;
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

  private oauthCallbackUrlPrefix(
    request: IncomingMessage,
  ): string | undefined {
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

  private requireWorktreeWorkspace(
    context: { workspace: TaskWorkspace },
  ): GitTaskWorkspace {
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
        .discardPendingSnapshot(
          pending.projectId,
          pending.pendingSnapshotId,
        )
        .catch(() => undefined);
    }
    if (pending.workspace) {
      await this.taskWorkspaces
        .remove(pending.workspace)
        .catch(() => undefined);
    }
  }

  private async disposeConversationWorkspace(target: {
    projectId: string;
    id: string;
  }, workspace?: TaskWorkspace): Promise<void> {
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
    if (this.runtimes.get(key) === context) {
      this.runtimes.delete(key);
    }
    context.unsubscribe();
    context.unsubscribeExit();
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
          message: error.message,
        },
      } satisfies JsonRpcResponse);
    }
  }

  private async stopRuntimes(): Promise<void> {
    const contexts = [...this.runtimes.values()];
    this.runtimes.clear();
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
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected)
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
    if (origin && !this.isAllowedOrigin(origin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    this.terminalWebSockets.handleUpgrade(
      request,
      socket,
      head,
      (webSocket) => this.terminalGateway?.accept(webSocket),
    );
  }

  private applyCors(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const origin = request.headers.origin;
    if (origin && this.isAllowedOrigin(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Threadlight-Host-Endpoint",
      );
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    }
  }

  private isAllowedOrigin(origin: string): boolean {
    return this.options.allowedOrigins?.includes(origin) ?? false;
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
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  message: string,
): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function serverSentEvent(message: JsonRpcOutgoing): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

function browserWebSocketToken(
  request: IncomingMessage,
): string | undefined {
  const protocols = request.headers["sec-websocket-protocol"];
  if (typeof protocols !== "string") return;
  const encoded = protocols
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith(BROWSER_TERMINAL_TOKEN_PREFIX))
    ?.slice(BROWSER_TERMINAL_TOKEN_PREFIX.length);
  if (!encoded) return;
  try {
    const token = Buffer.from(encoded, "base64url");
    if (token.toString("base64url") !== encoded) return;
    return token.toString("utf8");
  } catch {
    return;
  }
}

function runtimeRoute(
  pathname: string,
): { projectId: string; action: string } | undefined {
  const match = /^\/v1\/projects\/([^/]+)\/runtime(\/.*)$/.exec(pathname);
  if (!match) return;
  return {
    projectId: decodeURIComponent(match[1]!),
    action: match[2]!,
  };
}

function hostConversationWorkspaceRoute(
  pathname: string,
):
  | { projectId: string; threadId: string; action: string }
  | undefined {
  const match =
    /^\/v1\/host\/projects\/([^/]+)\/conversations\/([^/]+)\/(.+)$/.exec(
      pathname,
    );
  if (!match) return;
  return {
    projectId: decodeURIComponent(match[1]!),
    threadId: decodeURIComponent(match[2]!),
    action: match[3]!,
  };
}

function runtimeKey(projectId: string, workspacePath: string): string {
  return `${projectId}\u0000${workspacePath}`;
}

async function initializeRuntimePeer(
  peer: RuntimePeer,
  params: Record<string, unknown> | undefined,
): Promise<void> {
  const id = `host:initialize:${randomUUID()}`;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Host task runtime initialization timed out."));
    }, RPC_TIMEOUT_MS);
    const unsubscribe = peer.onMessage((message) => {
      if (!("id" in message) || message.id !== id) return;
      clearTimeout(timeout);
      unsubscribe();
      if ("error" in message && message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve();
      }
    });
    try {
      void Promise.resolve(peer.send({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        ...(params ? { params } : {}),
      } as JsonRpcRequest)).catch((error) => {
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      });
    } catch (error) {
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    }
  });
}

function requestRuntimePeer(
  peer: RuntimePeer,
  method: string,
  params?: unknown,
): Promise<unknown> {
  const id = `host:automation:${randomUUID()}`;
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Host automation request timed out: ${method}`));
    }, RPC_TIMEOUT_MS);
    const unsubscribe = peer.onMessage((message) => {
      if (!("id" in message) || message.id !== id) return;
      clearTimeout(timeout);
      unsubscribe();
      if ("error" in message && message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    });
    try {
      void Promise.resolve(
        peer.send({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        }),
      ).catch((error) => {
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      });
    } catch (error) {
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    }
  });
}

function hostAttachmentRoute(
  pathname: string,
): { projectId: string; attachmentId?: string } | undefined {
  const match =
    /^\/v1\/host\/projects\/([^/]+)\/attachments(?:\/([^/]+))?$/.exec(
      pathname,
    );
  if (!match) return;
  return {
    projectId: decodeURIComponent(match[1]!),
    ...(match[2]
      ? { attachmentId: decodeURIComponent(match[2]) }
      : {}),
  };
}

function attachmentUploadRoot(projectRoot: string): string {
  return join(projectRoot, ".threadlight", "uploads");
}

function attachmentName(value: string | null): string {
  const name = basename(value?.trim() ?? "");
  if (!name || name === "." || name === ".." || name.length > 255) {
    throw new Error("A valid attachment name is required.");
  }
  return name;
}

function attachmentMimeType(value: string | null): string {
  const mimeType = value?.trim() ?? "";
  if (!mimeType || mimeType.length > 255 || /[\r\n]/.test(mimeType)) {
    throw new Error("A valid attachment MIME type is required.");
  }
  return mimeType;
}

function attachmentSize(value: string | null): number {
  const size = Number(value);
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error("Attachment must be non-empty and smaller than 50 MB.");
  }
  return size;
}

function parseProviderTestRequest(
  value: Record<string, unknown>,
): HostProviderTestRequest {
  if (!isModelProvider(value.provider)) {
    throw new Error("Invalid provider");
  }
  const model = requiredString(value.model, "model").trim();
  if (
    value.baseUrl !== undefined &&
    (typeof value.baseUrl !== "string" || !value.baseUrl.trim())
  ) {
    throw new Error("Base URL must be a non-empty string");
  }
  if (
    value.apiKey !== undefined &&
    value.apiKey !== null &&
    typeof value.apiKey !== "string"
  ) {
    throw new Error("API key must be a string or null");
  }
  return {
    provider: value.provider,
    model,
    ...(typeof value.baseUrl === "string"
      ? { baseUrl: value.baseUrl.trim() }
      : {}),
    ...(value.apiKey === undefined
      ? {}
      : { apiKey: value.apiKey as string | null }),
  };
}

function isModelProvider(
  value: unknown,
): value is HostProviderTestRequest["provider"] {
  return (
    value === "openai" ||
    value === "deepseek" ||
    value === "qwen" ||
    value === "kimi" ||
    value === "doubao" ||
    value === "gemini" ||
    value === "grok" ||
    value === "custom"
  );
}

async function jsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readBody(request, MAX_BODY_BYTES)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A JSON object body is required.");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requiredQuery(url: URL, name: string): string {
  return requiredString(url.searchParams.get(name), name);
}

function optionalStringArray(
  value: unknown,
  name: string,
): readonly string[] | undefined {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} is required.`);
  return value;
}

async function listHostDirectories(
  value: string,
): Promise<HostDirectoryListing> {
  const input = expandHomeDirectory(value.trim());
  if (!input || !isAbsolute(input)) {
    throw new Error("An absolute Host directory path is required.");
  }

  let directory = input;
  let prefix = "";
  try {
    if (!(await stat(directory)).isDirectory()) {
      directory = dirname(input);
      prefix = basename(input);
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    directory = dirname(input);
    prefix = basename(input);
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries
        .filter((entry) =>
          entry.name.toLocaleLowerCase().startsWith(
            prefix.toLocaleLowerCase(),
          ),
        )
        .map(async (entry) => {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) return { name: entry.name, path };
          if (!entry.isSymbolicLink()) return;
          try {
            return (await stat(path)).isDirectory()
              ? { name: entry.name, path }
              : undefined;
          } catch {
            return;
          }
        }),
    )
  )
    .filter(
      (
        entry,
      ): entry is {
        name: string;
        path: string;
      } => Boolean(entry),
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .slice(0, 200);

  return { path: directory, directories };
}

function expandHomeDirectory(value: string): string {
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<string> {
  return readBinaryBody(request, limit).then((content) =>
    content.toString("utf8"),
  );
}

function readBinaryBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function audioMimeType(value: string | null): string {
  const mimeType = value?.trim() ?? "";
  if (
    !mimeType ||
    mimeType.length > 255 ||
    mimeType.includes("\r") ||
    mimeType.includes("\n")
  ) {
    throw new Error("Invalid audio transcription MIME type");
  }
  return mimeType;
}

function parseHostSearchRequest(value: unknown): HostSearchRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid search request");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string" ||
    !request.projectId ||
    request.projectId.length > 256 ||
    (request.threadId !== undefined &&
      (typeof request.threadId !== "string" ||
        !request.threadId ||
        request.threadId.length > 256)) ||
    typeof request.query !== "string" ||
    request.query.length > 2_000 ||
    (request.mode !== "all" && request.mode !== "files") ||
    (request.limit !== undefined &&
      (!Number.isInteger(request.limit) ||
        Number(request.limit) < 1 ||
        Number(request.limit) > 200))
  ) {
    throw new Error("Invalid search request");
  }
  return {
    projectId: request.projectId,
    ...(typeof request.threadId === "string"
      ? { threadId: request.threadId }
      : {}),
    query: request.query,
    mode: request.mode,
    ...(typeof request.limit === "number"
      ? { limit: request.limit }
      : {}),
  };
}

function parseAutomationRequest(
  value: unknown,
  update?: false,
): HostAutomationCreateRequest;
function parseAutomationRequest(
  value: unknown,
  update: true,
): HostAutomationUpdateRequest;
function parseAutomationRequest(
  value: unknown,
  update = false,
): HostAutomationCreateRequest | HostAutomationUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid automation request");
  }
  const request = value as Record<string, unknown>;
  const schedule = request.schedule as Record<string, unknown> | undefined;
  if (
    typeof request.projectId !== "string" ||
    !request.projectId.trim() ||
    typeof request.name !== "string" ||
    !request.name.trim() ||
    request.name.length > 120 ||
    (request.kind !== "custom" &&
      request.kind !== "tests" &&
      request.kind !== "dependencies" &&
      request.kind !== "issue-triage") ||
    typeof request.prompt !== "string" ||
    !request.prompt.trim() ||
    request.prompt.length > 12_000 ||
    typeof request.enabled !== "boolean" ||
    !schedule ||
    Array.isArray(schedule) ||
    (schedule.cadence !== "daily" &&
      schedule.cadence !== "weekdays" &&
      schedule.cadence !== "weekly") ||
    typeof schedule.time !== "string" ||
    (schedule.weekday !== undefined &&
      (!Number.isInteger(schedule.weekday) ||
        Number(schedule.weekday) < 0 ||
        Number(schedule.weekday) > 6)) ||
    (update && (typeof request.id !== "string" || !request.id.trim()))
  ) {
    throw new Error("Invalid automation request");
  }
  const normalizedSchedule: HostAutomationSchedule = {
    cadence: schedule.cadence,
    time: schedule.time,
    ...(schedule.cadence === "weekly"
      ? { weekday: Number(schedule.weekday) }
      : {}),
  };
  const base: HostAutomationCreateRequest = {
    projectId: request.projectId,
    name: request.name,
    kind: request.kind,
    prompt: request.prompt,
    enabled: request.enabled,
    schedule: normalizedSchedule,
  };
  return update
    ? { ...base, id: request.id as string }
    : base;
}

function parseAutomationTarget(
  value: unknown,
): { projectId: string; id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid automation target");
  }
  const target = value as Record<string, unknown>;
  if (
    typeof target.projectId !== "string" ||
    !target.projectId.trim() ||
    typeof target.id !== "string" ||
    !target.id.trim()
  ) {
    throw new Error("Invalid automation target");
  }
  return { projectId: target.projectId, id: target.id };
}

function hostOAuthCallbackRoute(
  pathname: string,
): { connectorId: string } | undefined {
  const match =
    /^\/v1\/host\/oauth\/callback\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(
      pathname,
    );
  return match?.[1] ? { connectorId: match[1] } : undefined;
}

function hostDiagnosticsProjectId(pathname: string): string | undefined {
  const match =
    /^\/v1\/host\/projects\/([^/]+)\/diagnostics$/.exec(pathname);
  if (!match?.[1]) return;
  const projectId = decodeURIComponent(match[1]);
  if (!projectId || projectId.length > 256) {
    throw new Error("Invalid project id");
  }
  return projectId;
}

function hostAutomationsProjectId(pathname: string): string | undefined {
  const match =
    /^\/v1\/host\/projects\/([^/]+)\/automations$/.exec(pathname);
  if (!match?.[1]) return;
  const projectId = decodeURIComponent(match[1]);
  if (!projectId || projectId.length > 256) {
    throw new Error("Invalid project id");
  }
  return projectId;
}

function normalizeHostEndpoint(value: string): string {
  if (!value.trim() || value.length > 2048) {
    throw new Error("Invalid Threadlight Host endpoint");
  }
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid Threadlight Host endpoint");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizeOAuthCallbackUrlPrefix(value: string): string {
  const prefix = normalizeHostEndpoint(value);
  const url = new URL(prefix);
  if (
    !url.pathname.endsWith("/v1/host/oauth/callback") &&
    !url.pathname.endsWith("/oauth/callback")
  ) {
    throw new Error("Invalid OAuth callback URL prefix");
  }
  return prefix;
}

function oauthResultPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: Canvas; color: CanvasText; }
      main { width: min(28rem, calc(100vw - 3rem)); text-align: center; }
      h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
      p { line-height: 1.55; opacity: .72; margin: 0; }
    </style>
  </head>
  <body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}
