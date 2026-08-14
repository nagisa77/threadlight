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

import type {
  PendingResponse,
  RuntimeContext,
  ThreadlightHostServerOptions,
} from "./host-server.js";
import {
  conversationRuntimeFailureKey,
  developmentModeForThreadStart,
  initializeRuntimePeer,
  readBody,
  requestRuntimePeer,
  runtimeKey,
  serverSentEvent,
} from "./host-http.js";

export interface HostRuntimeBridgeHost {
  options: ThreadlightHostServerOptions;
  runtimes: Map<string, RuntimeContext>;
  runtimeFailures: Map<string, string>;
  pending: Map<string, PendingResponse>;
  initializationParams: Map<string, Record<string, unknown> | undefined>;
  conversationChanges: ConversationChangeTracker;
  taskWorkspaces: TaskWorkspaceManager;
  eventHeartbeatIntervalMs: number;
  discardPendingWorkspace(pending: PendingResponse): Promise<void>;
  handleRuntimeExit(
    projectId: string,
    context: RuntimeContext,
    error: Error,
  ): void;
  oauthCallbackUrlPrefix(request: IncomingMessage): string | undefined;
  projectEventClients(projectId: string): Set<ServerResponse>;
  recordNotification(
    projectId: string,
    context: RuntimeContext,
    message: JsonRpcOutgoing,
  ): void;
  resolveAutomationTurn(projectId: string, message: JsonRpcOutgoing): void;
  writeBinary(response: ServerResponse, content: Buffer): void;
  writeJson(response: ServerResponse, status: number, value: unknown): void;
}

export class HostRuntimeBridge {
  constructor(private readonly host: HostRuntimeBridgeHost) {}

  async handleRuntimeApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: { projectId: string; action: string },
  ): Promise<void> {
    const project = this.host.options.projects.project(route.projectId);
    if (!project) throw new Error(`Unknown project: ${route.projectId}`);
    if (request.method === "GET" && route.action === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write(": ping\n\n");
      const clients = this.host.projectEventClients(project.id);
      clients.add(response);
      const heartbeat = setInterval(() => {
        if (!response.writableEnded) response.write(": ping\n\n");
      }, this.host.eventHeartbeatIntervalMs);
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
        this.host.oauthCallbackUrlPrefix(request),
      );
      return;
    }
    const context = await this.runtime(
      project.id,
      project.basePath,
      this.host.oauthCallbackUrlPrefix(request),
    );
    if (request.method === "GET" && route.action === "/workspace/list") {
      this.host.writeJson(
        response,
        200,
        await context.workspace.list(url.searchParams.get("path") ?? ""),
      );
      return;
    }
    if (request.method === "GET" && route.action === "/workspace/file") {
      this.host.writeJson(
        response,
        200,
        await context.workspace.file(url.searchParams.get("path") ?? ""),
      );
      return;
    }
    if (request.method === "GET" && route.action === "/workspace/download") {
      this.host.writeBinary(
        response,
        await context.workspace.fileContents(
          url.searchParams.get("path") ?? "",
        ),
      );
      return;
    }
    if (request.method === "GET" && route.action === "/workspace/changes") {
      this.host.writeJson(response, 200, await context.workspace.changes());
      return;
    }
    this.host.writeJson(response, 404, { error: "Not found" });
  }

  async runtime(
    projectId: string,
    projectRoot: string,
    oauthCallbackUrlPrefix?: string,
  ): Promise<RuntimeContext> {
    const key = runtimeKey(projectId, projectRoot);
    const existing = this.host.runtimes.get(key);
    if (existing) return existing;
    const peer = this.host.options.createPeer({
      projectId,
      projectRoot,
      projectBasePath:
        this.host.options.projects.project(projectId)?.basePath ?? projectRoot,
      ...(oauthCallbackUrlPrefix ? { oauthCallbackUrlPrefix } : {}),
    });
    await peer.start();
    if (this.host.initializationParams.has(projectId)) {
      try {
        await initializeRuntimePeer(
          peer,
          this.host.initializationParams.get(projectId),
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
        this.host.handleRuntimeExit(projectId, context, error),
      ) ?? (() => undefined);
    this.host.runtimes.set(key, context);
    return context;
  }

  async forwardRpc(
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
        this.host.options.projects.project(projectId)?.scope === "standalone"
          ? await this.host.taskWorkspaces.prepareStandalone()
          : await this.host.taskWorkspaces.prepare(
              projectId,
              projectRoot,
              developmentModeForThreadStart(message),
            );
      pendingSnapshotId = `host:${randomUUID()}`;
      try {
        await this.host.conversationChanges.beginPendingSnapshot(
          projectId,
          pendingSnapshotId,
          workspace.path,
        );
      } catch (error) {
        await this.host.taskWorkspaces.remove(workspace).catch(() => undefined);
        throw error;
      }
    } else if (typeof params?.threadId === "string") {
      const conversation = this.host.options.projects
        .project(projectId)
        ?.conversations.find(({ id }) => id === params.threadId);
      workspace = conversation?.workspace ?? workspace;
      if (
        message.method === "thread/resume" ||
        message.method === "turn/start"
      ) {
        await this.host.conversationChanges.ensureSnapshot(
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
        await this.host.conversationChanges
          .discardPendingSnapshot(projectId, pendingSnapshotId)
          .catch(() => undefined);
        await this.host.taskWorkspaces.remove(workspace).catch(() => undefined);
      }
      throw error;
    }
    if (message.method === "initialize") {
      this.host.initializationParams.set(projectId, params);
    }
    const contextKey = runtimeKey(projectId, workspace.path);
    let runtimeFailureKey: string | undefined;
    let forwardedMessage = message;
    if (
      typeof params?.threadId === "string" &&
      (message.method === "thread/resume" || message.method === "turn/start")
    ) {
      const key = conversationRuntimeFailureKey(projectId, params.threadId);
      const failure = this.host.runtimeFailures.get(key);
      if (failure) {
        runtimeFailureKey = key;
        forwardedMessage = {
          ...message,
          params: { ...params, runtimeError: failure },
        };
      }
    }
    if (
      message.method === "turn/start" &&
      typeof params?.threadId === "string"
    ) {
      try {
        this.host.options.projects.markConversationPending({
          projectId,
          id: params.threadId,
        });
      } catch {
        // The app-server remains authoritative for unknown threads.
      }
    }
    const internalId = `host:${randomUUID()}`;
    const timeout = setTimeout(() => {
      const pending = this.host.pending.get(internalId);
      if (!pending) return;
      this.host.pending.delete(internalId);
      this.host.writeJson(pending.response, 504, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: { code: -32001, message: "Host runtime request timed out." },
      });
      void this.host.discardPendingWorkspace(pending);
    }, RPC_TIMEOUT_MS);
    this.host.pending.set(internalId, {
      projectId,
      runtimeKey: contextKey,
      originalId: message.id,
      method: message.method,
      response,
      timeout,
      ...(message.method === "thread/start" ? { workspace } : {}),
      ...(pendingSnapshotId ? { pendingSnapshotId } : {}),
      ...(runtimeFailureKey ? { runtimeFailureKey } : {}),
    });
    try {
      await context.peer.send({ ...forwardedMessage, id: internalId });
    } catch (error) {
      clearTimeout(timeout);
      this.host.pending.delete(internalId);
      if (pendingSnapshotId) {
        await this.host.conversationChanges.discardPendingSnapshot(
          projectId,
          pendingSnapshotId,
        );
        await this.host.taskWorkspaces.remove(workspace);
      }
      throw error;
    }
  }

  async handlePeerMessage(
    projectId: string,
    context: RuntimeContext,
    message: JsonRpcOutgoing,
  ): Promise<void> {
    if ("id" in message && typeof message.id === "string") {
      const pending = this.host.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.host.pending.delete(message.id);
        if (pending.runtimeFailureKey && "result" in message) {
          this.host.runtimeFailures.delete(pending.runtimeFailureKey);
        }
        if (pending.method === "thread/start" && "result" in message) {
          const threadId = (
            message.result as { threadId?: unknown } | undefined
          )?.threadId;
          if (typeof threadId === "string") {
            const project = this.host.options.projects.project(projectId);
            if (project && pending.workspace) {
              this.host.options.projects.setConversationWorkspace(
                { projectId, id: threadId },
                pending.workspace,
              );
              if (pending.pendingSnapshotId) {
                await this.host.conversationChanges.commitPendingSnapshot(
                  projectId,
                  pending.pendingSnapshotId,
                  threadId,
                );
              }
            }
          } else {
            await this.host.discardPendingWorkspace(pending);
          }
        } else if (pending.method === "thread/start") {
          await this.host.discardPendingWorkspace(pending);
        }
        this.host.writeJson(pending.response, 200, {
          ...message,
          id: pending.originalId,
        } satisfies JsonRpcResponse);
        return;
      }
    }
    this.host.recordNotification(projectId, context, message);
    this.host.resolveAutomationTurn(projectId, message);
    const event = serverSentEvent(message);
    for (const client of this.host.projectEventClients(projectId)) {
      client.write(event);
    }
  }
}
