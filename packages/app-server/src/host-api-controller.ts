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

import type { ThreadlightHostServerOptions } from "./host-server.js";
import {
  attachmentMimeType,
  attachmentName,
  attachmentSize,
  attachmentUploadRoot,
  audioMimeType,
  hostAttachmentRoute,
  hostAutomationsProjectId,
  hostConversationWorkspaceRoute,
  hostDiagnosticBundleProjectId,
  hostDiagnosticsProjectId,
  jsonBody,
  listHostDirectories,
  optionalStringArray,
  parseAutomationRequest,
  parseAutomationTarget,
  parseDiagnosticBundleRequest,
  parseHostSearchRequest,
  parseProviderTestRequest,
  readBinaryBody,
  requiredBoolean,
  requiredQuery,
  requiredString,
} from "./host-http.js";

export interface HostApiControllerHost {
  options: ThreadlightHostServerOptions;
  automationStore: AutomationStore;
  automationScheduler: AutomationScheduler;
  codeHostDelivery: CodeHostDeliveryManager;
  conversationChanges: ConversationChangeTracker;
  projectSearch: ProjectSearchService;
  runningThreads: RunningThreadRegistry;
  worktreeDelivery: WorktreeDeliveryManager;
  applyAutomaticDelivery(
    request: Parameters<WorktreeDeliveryManager["apply"]>[0],
    source: HostDeliverySource,
  ): ReturnType<typeof applyAutomaticWorktreeDelivery>;
  conversationWorkspace(
    projectId: string,
    threadId: string,
  ): { project: HostProjectSummary; workspace: TaskWorkspace };
  disposeConversationWorkspace(
    target: { projectId: string; id: string },
    workspace?: TaskWorkspace,
  ): Promise<void>;
  requireProject(projectId: string): HostProjectSummary;
  requireWorktreeWorkspace(context: {
    workspace: TaskWorkspace;
  }): GitTaskWorkspace;
  stopRuntimes(): Promise<void>;
  writeJson(response: ServerResponse, status: number, value: unknown): void;
  writeBinary(response: ServerResponse, content: Buffer): void;
}

export class HostApiController {
  constructor(private readonly host: HostApiControllerHost) {}

  async handleHostApi(
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
        this.host.writeJson(
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
      const project = this.host.options.projects.project(diagnosticsProjectId);
      if (!project) {
        throw new Error(`Unknown project: ${diagnosticsProjectId}`);
      }
      this.host.writeJson(response, 200, projectDiagnostics(project));
      return true;
    }
    const diagnosticBundleProjectId = hostDiagnosticBundleProjectId(
      url.pathname,
    );
    if (
      (request.method === "GET" || request.method === "POST") &&
      diagnosticBundleProjectId
    ) {
      const project = this.host.options.projects.project(
        diagnosticBundleProjectId,
      );
      if (!project) {
        throw new Error(`Unknown project: ${diagnosticBundleProjectId}`);
      }
      this.host.writeJson(
        response,
        200,
        await projectDiagnosticBundle(project, {
          changes: this.host.conversationChanges,
          ...(request.method === "POST"
            ? {
                conversationIds: parseDiagnosticBundleRequest(
                  await jsonBody(request),
                ),
              }
            : {}),
          environment: {
            runtime: "host",
            platform: process.platform,
            architecture: process.arch,
            nodeVersion: process.version,
          },
        }),
      );
      return true;
    }
    const automationsProjectId = hostAutomationsProjectId(url.pathname);
    if (request.method === "GET" && automationsProjectId) {
      this.host.requireProject(automationsProjectId);
      this.host.writeJson(
        response,
        200,
        this.host.automationStore.snapshot(automationsProjectId),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/create"
    ) {
      const automation = parseAutomationRequest(await jsonBody(request));
      this.host.requireProject(automation.projectId);
      this.host.writeJson(
        response,
        200,
        this.host.automationStore.create(automation),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/update"
    ) {
      const automation = parseAutomationRequest(await jsonBody(request), true);
      this.host.requireProject(automation.projectId);
      this.host.writeJson(
        response,
        200,
        this.host.automationStore.update(automation),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/delete"
    ) {
      const target = parseAutomationTarget(await jsonBody(request));
      this.host.requireProject(target.projectId);
      this.host.writeJson(
        response,
        200,
        this.host.automationStore.delete(target.projectId, target.id),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/automations/run"
    ) {
      const target = parseAutomationTarget(await jsonBody(request));
      this.host.requireProject(target.projectId);
      const automation = this.host.automationStore.get(target.id);
      if (!automation || automation.projectId !== target.projectId) {
        throw new Error("Unknown automation");
      }
      this.host.automationScheduler.runNow(target.id);
      this.host.writeJson(
        response,
        200,
        this.host.automationStore.snapshot(target.projectId),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/projects") {
      this.host.writeJson(response, 200, this.projectsSnapshot());
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/host/search") {
      this.host.writeJson(
        response,
        200,
        await this.searchHostProject(
          parseHostSearchRequest(await jsonBody(request)),
        ),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/directories") {
      this.host.writeJson(
        response,
        200,
        await listHostDirectories(url.searchParams.get("path") ?? "", {
          showHidden: url.searchParams.get("showHidden") === "true",
          strict: url.searchParams.get("strict") === "true",
        }),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/files") {
      this.host.writeJson(
        response,
        200,
        await listHostFiles(url.searchParams.get("path") ?? ""),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/file") {
      this.host.writeJson(
        response,
        200,
        await readHostFile(url.searchParams.get("path") ?? ""),
      );
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/file/download") {
      this.host.writeBinary(
        response,
        await readHostFileContents(url.searchParams.get("path") ?? ""),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/register"
    ) {
      const body = await jsonBody(request);
      this.host.writeJson(
        response,
        200,
        this.projectsSnapshot(
          this.host.options.projects.register(
            requiredString(body.path, "path"),
          ),
        ),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/standalone"
    ) {
      this.host.writeJson(
        response,
        200,
        this.projectsSnapshot(this.host.options.projects.activateStandalone()),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/activate"
    ) {
      const body = await jsonBody(request);
      this.host.writeJson(
        response,
        200,
        this.projectsSnapshot(
          this.host.options.projects.activate(
            requiredString(body.projectId, "projectId"),
          ),
        ),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/update"
    ) {
      const body = await jsonBody(request);
      this.host.writeJson(
        response,
        200,
        this.projectsSnapshot(
          this.host.options.projects.updateProject({
            id: requiredString(body.id, "id"),
            pinned: requiredBoolean(body.pinned, "pinned"),
          }),
        ),
      );
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/projects/delete"
    ) {
      const body = await jsonBody(request);
      this.host.writeJson(
        response,
        200,
        this.projectsSnapshot(
          this.host.options.projects.deleteProject(
            requiredString(body.projectId, "projectId"),
          ),
        ),
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
        snapshot = this.host.options.projects.upsertConversation({
          ...target,
          title: requiredString(body.title, "title"),
          ...(body.accessMode === "approval" || body.accessMode === "full"
            ? { accessMode: body.accessMode }
            : {}),
        });
      } else if (url.pathname.endsWith("/update")) {
        snapshot = this.host.options.projects.updateConversation({
          ...target,
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
          ...(typeof body.archived === "boolean"
            ? { archived: body.archived }
            : {}),
          ...(body.accessMode === "approval" || body.accessMode === "full"
            ? { accessMode: body.accessMode }
            : {}),
        });
      } else if (url.pathname.endsWith("/read")) {
        snapshot = this.host.options.projects.markConversationRead(target);
      } else if (url.pathname.endsWith("/recover")) {
        if (
          body.replacementId !== undefined &&
          typeof body.replacementId !== "string"
        ) {
          throw new Error("Invalid replacementId");
        }
        snapshot = this.host.options.projects.recoverConversation({
          ...target,
          ...(typeof body.replacementId === "string"
            ? { replacementId: body.replacementId }
            : {}),
        });
      } else if (url.pathname.endsWith("/delete")) {
        const workspace = this.host.options.projects
          .project(target.projectId)
          ?.conversations.find(({ id }) => id === target.id)?.workspace;
        snapshot = this.host.options.projects.deleteConversation(target);
        await this.host.disposeConversationWorkspace(target, workspace);
      } else {
        return false;
      }
      this.host.writeJson(response, 200, this.projectsSnapshot(snapshot));
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/host/settings") {
      this.host.writeJson(response, 200, this.host.options.settings.snapshot());
      return true;
    }
    if (request.method === "PUT" && url.pathname === "/v1/host/settings") {
      const body = (await jsonBody(request)) as unknown as HostSettingsUpdate;
      const snapshot = this.host.options.settings.update(body);
      await this.host.stopRuntimes();
      this.host.writeJson(response, 200, snapshot);
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/provider/test"
    ) {
      const diagnostic = await (
        this.host.options.testProvider ?? testProviderConnection
      )(
        parseProviderTestRequest(await jsonBody(request)),
        this.host.options.settings.runtimeSettings(),
      );
      this.host.writeJson(response, 200, diagnostic);
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/v1/host/audio/transcriptions"
    ) {
      this.host.writeJson(
        response,
        200,
        await this.transcribeHostAudio(request, url),
      );
      return true;
    }
    return false;
  }

  async handleConversationWorkspaceApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: { projectId: string; threadId: string; action: string },
  ): Promise<void> {
    const context = this.host.conversationWorkspace(
      route.projectId,
      route.threadId,
    );
    const { project, workspace } = context;

    if (request.method === "GET" && route.action === "changes") {
      this.host.writeJson(
        response,
        200,
        await this.host.conversationChanges.changes(
          project.id,
          route.threadId,
          workspace.path,
        ),
      );
      return;
    }
    if (request.method === "POST" && route.action === "changes/restore") {
      const body = await jsonBody(request);
      this.host.writeJson(
        response,
        200,
        await this.host.conversationChanges.restore(
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
      this.host.writeJson(
        response,
        200,
        await this.host.conversationChanges.listWorkspace(
          workspace.path,
          url.searchParams.get("path") ?? "",
        ),
      );
      return;
    }
    if (request.method === "GET" && route.action === "workspace/file") {
      this.host.writeJson(
        response,
        200,
        await this.host.conversationChanges.readWorkspaceFile(
          workspace.path,
          requiredQuery(url, "path"),
        ),
      );
      return;
    }
    if (request.method === "GET" && route.action === "workspace/download") {
      const absolutePath =
        await this.host.conversationChanges.workspaceFilePath(
          workspace.path,
          requiredQuery(url, "path"),
        );
      this.host.writeBinary(response, await readFile(absolutePath));
      return;
    }
    if (request.method === "GET" && route.action === "delivery/history") {
      this.host.requireWorktreeWorkspace(context);
      this.host.writeJson(
        response,
        200,
        await this.host.worktreeDelivery.history({
          projectId: project.id,
          threadId: route.threadId,
          projectPath: project.basePath,
        }),
      );
      return;
    }

    const body =
      request.method === "POST" ? await jsonBody(request) : undefined;
    const revision =
      request.method === "GET"
        ? requiredQuery(url, "revision")
        : requiredString(body?.revision, "revision");
    const worktree = this.host.requireWorktreeWorkspace(context);
    const deliveryRequest = {
      projectId: project.id,
      threadId: route.threadId,
      revision,
      projectPath: project.basePath,
      workspace: worktree,
    };

    if (request.method === "POST" && route.action === "delivery/preflight") {
      this.host.writeJson(
        response,
        200,
        await this.host.worktreeDelivery.preflight(deliveryRequest),
      );
      return;
    }
    if (request.method === "POST" && route.action === "delivery/apply") {
      this.host.writeJson(
        response,
        200,
        await this.host.applyAutomaticDelivery(deliveryRequest, "retry"),
      );
      return;
    }
    if (request.method === "POST" && route.action === "delivery/undo") {
      this.host.writeJson(
        response,
        200,
        await this.host.worktreeDelivery.undo(deliveryRequest),
      );
      return;
    }
    if (request.method === "POST" && route.action === "delivery/commit") {
      this.host.writeJson(
        response,
        200,
        await this.host.worktreeDelivery.commit(
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
      this.host.writeJson(
        response,
        200,
        await this.host.codeHostDelivery.status(codeHostRequest),
      );
      return;
    }
    if (request.method === "POST" && route.action === "code-host/commit-push") {
      this.host.writeJson(
        response,
        200,
        await this.host.codeHostDelivery.commitAndPush(
          codeHostRequest,
          requiredString(body?.message, "message"),
        ),
      );
      return;
    }
    if (request.method === "POST" && route.action === "code-host/create-pr") {
      this.host.writeJson(
        response,
        200,
        await this.host.codeHostDelivery.createPullRequest(codeHostRequest, {
          title: requiredString(body?.title, "title"),
          draft: body?.draft !== false,
          ...(typeof body?.body === "string" ? { body: body.body } : {}),
        }),
      );
      return;
    }
    this.host.writeJson(response, 404, { error: "Not found" });
  }

  async transcribeHostAudio(
    request: IncomingMessage,
    url: URL,
  ): Promise<{ text: string }> {
    const apiKey = this.host.options.settings.runtimeSettings().openAIApiKey;
    if (!apiKey) {
      throw new Error(VOICE_INPUT_ERROR_CODES.openAiKeyRequired);
    }
    const mimeType = audioMimeType(url.searchParams.get("mimeType"));
    const declaredLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_TRANSCRIPTION_BYTES
    ) {
      throw new Error(VOICE_INPUT_ERROR_CODES.recordingTooLarge);
    }
    const content = await readBinaryBody(request, MAX_TRANSCRIPTION_BYTES);
    const audio = Uint8Array.from(content).buffer;
    const text = await (this.host.options.transcribeAudio ?? transcribeAudio)(
      { audio, mimeType },
      { apiKey },
    );
    return { text };
  }

  searchHostProject(
    request: HostSearchRequest,
  ): Promise<readonly HostSearchResult[]> {
    const project = this.host.options.projects.project(request.projectId);
    if (!project) throw new Error(`Unknown project: ${request.projectId}`);
    const conversation = request.threadId
      ? project.conversations.find(({ id }) => id === request.threadId)
      : undefined;
    if (request.threadId && !conversation) {
      throw new Error("Unknown conversation");
    }
    return this.host.projectSearch.search({
      project,
      workspacePath: conversation?.workspace?.path ?? project.basePath,
      query: request.query,
      mode: request.mode,
      limit: request.limit ?? 80,
    });
  }

  projectsSnapshot(
    snapshot: HostProjectsSnapshot = this.host.options.projects.snapshot(),
  ): HostProjectsSnapshot {
    return {
      ...snapshot,
      runningThreadIds: this.host.runningThreads.threadIds(
        snapshot.projects.map(({ id }) => id),
      ),
    };
  }

  async uploadHostAttachment(
    request: IncomingMessage,
    url: URL,
    projectId: string,
  ): Promise<AttachmentData> {
    const project = this.host.options.projects.project(projectId);
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

  async writeHostAttachment(
    response: ServerResponse,
    projectId: string,
    attachmentId: string,
  ): Promise<void> {
    const project = this.host.options.projects.project(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    if (!/^[a-f0-9-]{36}$/i.test(attachmentId)) {
      throw new Error("Invalid attachment id.");
    }
    const root = attachmentUploadRoot(project.basePath);
    const entry = (await readdir(root, { withFileTypes: true })).find(
      (candidate) =>
        candidate.isFile() && candidate.name.startsWith(`${attachmentId}-`),
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
}
