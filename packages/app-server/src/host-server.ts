import { randomUUID, timingSafeEqual } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
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
  type ProjectStore,
  type SettingsStore,
} from "@threadlight/host-core";
import type {
  TerminalSessionController,
} from "@threadlight/terminal-core";
import type {
  HostDirectoryListing,
  HostSettingsUpdate,
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
const MAX_TERMINAL_MESSAGE_BYTES = 256 * 1024;
const RPC_TIMEOUT_MS = 120_000;

export interface ThreadlightHostServerOptions {
  token: string;
  hostId: string;
  name: string;
  homePath: string;
  projects: ProjectStore;
  settings: SettingsStore;
  createPeer(input: {
    projectId: string;
    projectRoot: string;
  }): RuntimePeer;
  createTerminalSessions?(
    send: (event: TerminalSessionEvent) => void,
  ): TerminalSessionController;
  host?: string;
  port?: number;
  allowedOrigin?: string;
}

export interface ThreadlightHostAddress {
  host: string;
  port: number;
}

interface RuntimeContext {
  peer: RuntimePeer;
  workspace: RemoteWorkspace;
  eventClients: Set<ServerResponse>;
  unsubscribe: () => void;
  unsubscribeExit: () => void;
}

interface PendingResponse {
  projectId: string;
  originalId: JsonRpcId;
  method: string;
  response: ServerResponse;
  timeout: NodeJS.Timeout;
}

export class ThreadlightHostServer {
  private readonly listenHost: string;
  private readonly port: number;
  private readonly runtimes = new Map<string, RuntimeContext>();
  private readonly pending = new Map<string, PendingResponse>();
  private readonly terminalGateway?: HostTerminalGateway;
  private readonly terminalWebSockets?: WebSocketServer;
  private server?: Server;

  constructor(private readonly options: ThreadlightHostServerOptions) {
    if (!options.token.trim()) {
      throw new Error("Threadlight Host token is required.");
    }
    this.listenHost = options.host ?? "127.0.0.1";
    this.port = options.port ?? 7432;
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
    return { host: this.listenHost, port: address.port };
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      this.writeJson(pending.response, 503, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: { code: -32000, message: "Threadlight Host stopped." },
      });
    }
    this.pending.clear();
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
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (!this.authorized(request)) {
      this.writeJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://host.local");
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
    if (request.method === "GET" && url.pathname === "/v1/host/projects") {
      this.writeJson(response, 200, this.options.projects.snapshot());
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
        snapshot = this.options.projects.deleteConversation(target);
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
    return false;
  }

  private async handleRuntimeApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: { projectId: string; action: string },
  ): Promise<void> {
    const project = this.options.projects.project(route.projectId);
    if (!project) throw new Error(`Unknown project: ${route.projectId}`);
    const context = await this.runtime(project.id, project.basePath);
    if (request.method === "GET" && route.action === "/events") {
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write("\n");
      context.eventClients.add(response);
      response.once("close", () => context.eventClients.delete(response));
      return;
    }
    if (request.method === "POST" && route.action === "/rpc") {
      await this.forwardRpc(request, response, project.id, context);
      return;
    }
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
  ): Promise<RuntimeContext> {
    const existing = this.runtimes.get(projectId);
    if (existing) return existing;
    const peer = this.options.createPeer({ projectId, projectRoot });
    await peer.start();
    const context: RuntimeContext = {
      peer,
      workspace: new RemoteWorkspace(projectRoot),
      eventClients: new Set(),
      unsubscribe: () => undefined,
      unsubscribeExit: () => undefined,
    };
    context.unsubscribe = peer.onMessage((message) =>
      this.handlePeerMessage(projectId, context, message),
    );
    context.unsubscribeExit =
      peer.onExit?.((error) =>
        this.handleRuntimeExit(projectId, context, error),
      ) ?? (() => undefined);
    this.runtimes.set(projectId, context);
    return context;
  }

  private async forwardRpc(
    request: IncomingMessage,
    response: ServerResponse,
    projectId: string,
    context: RuntimeContext,
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
    }, RPC_TIMEOUT_MS);
    this.pending.set(internalId, {
      projectId,
      originalId: message.id,
      method: message.method,
      response,
      timeout,
    });
    try {
      await context.peer.send({ ...message, id: internalId });
    } catch (error) {
      clearTimeout(timeout);
      this.pending.delete(internalId);
      throw error;
    }
  }

  private handlePeerMessage(
    projectId: string,
    context: RuntimeContext,
    message: JsonRpcOutgoing,
  ): void {
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
            if (project) {
              this.options.projects.setConversationWorkspace(
                { projectId, id: threadId },
                { mode: "folder", path: project.basePath },
              );
            }
          }
        }
        this.writeJson(pending.response, 200, {
          ...message,
          id: pending.originalId,
        } satisfies JsonRpcResponse);
        return;
      }
    }
    this.recordNotification(projectId, message);
    const line = `${JSON.stringify(message)}\n`;
    for (const client of context.eventClients) client.write(line);
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

  private handleRuntimeExit(
    projectId: string,
    context: RuntimeContext,
    error: Error,
  ): void {
    if (this.runtimes.get(projectId) === context) {
      this.runtimes.delete(projectId);
    }
    context.unsubscribe();
    context.unsubscribeExit();
    for (const client of context.eventClients) client.end();
    context.eventClients.clear();
    for (const [id, pending] of this.pending) {
      if (pending.projectId !== projectId) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
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
      for (const client of context.eventClients) client.end();
      context.eventClients.clear();
      await context.peer.stop();
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const value = request.headers.authorization;
    if (!value?.startsWith("Bearer ")) return false;
    const supplied = Buffer.from(value.slice(7));
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
    if (!this.authorized(request)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    const origin = request.headers.origin;
    if (
      origin &&
      (!this.options.allowedOrigin || origin !== this.options.allowedOrigin)
    ) {
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
    if (origin && origin === this.options.allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
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
    request.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    request.on("error", reject);
  });
}
