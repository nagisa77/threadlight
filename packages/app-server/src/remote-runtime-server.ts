import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { basename } from "node:path";

import type {
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
  JsonRpcResponse,
} from "@threadlight/protocol";

import type { RuntimePeer } from "./remote-runtime-peer.js";
import { RemoteWorkspace } from "./remote-workspace.js";

const MAX_RPC_BODY_BYTES = 1024 * 1024;
const RPC_TIMEOUT_MS = 120_000;

interface PendingResponse {
  originalId: JsonRpcId;
  response: ServerResponse;
  timeout: NodeJS.Timeout;
}

export interface RemoteRuntimeServerOptions {
  peer: RuntimePeer;
  token: string;
  workspaceRoot: string;
  host?: string;
  port?: number;
  allowedOrigin?: string;
  runtimeId?: string;
}

export interface RemoteRuntimeAddress {
  host: string;
  port: number;
}

export class RemoteRuntimeServer {
  private readonly host: string;
  private readonly port: number;
  private readonly runtimeId: string;
  private readonly workspace: RemoteWorkspace;
  private readonly pending = new Map<string, PendingResponse>();
  private readonly eventClients = new Set<ServerResponse>();
  private server?: Server;
  private unsubscribePeer?: () => void;

  constructor(private readonly options: RemoteRuntimeServerOptions) {
    if (!options.token.trim()) {
      throw new Error("Remote runtime token is required.");
    }
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 7432;
    this.runtimeId = options.runtimeId ?? randomUUID();
    this.workspace = new RemoteWorkspace(options.workspaceRoot);
  }

  async start(): Promise<RemoteRuntimeAddress> {
    if (this.server) throw new Error("Remote runtime is already listening.");
    await this.options.peer.start();
    this.unsubscribePeer = this.options.peer.onMessage((message) =>
      this.handlePeerMessage(message),
    );

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Remote runtime did not receive a TCP address.");
    }
    return { host: this.host, port: address.port };
  }

  async stop(): Promise<void> {
    this.unsubscribePeer?.();
    this.unsubscribePeer = undefined;
    for (const client of this.eventClients) client.end();
    this.eventClients.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      this.writeJson(pending.response, 503, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: { code: -32000, message: "Remote runtime stopped." },
      });
    }
    this.pending.clear();

    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await this.options.peer.stop();
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

    const url = new URL(request.url ?? "/", "http://runtime.local");
    try {
      if (request.method === "GET" && url.pathname === "/v1/health") {
        this.writeJson(response, 200, {
          ok: true,
          protocolVersion: 1,
          runtimeId: this.runtimeId,
          name: basename(this.options.workspaceRoot),
          workspacePath: this.options.workspaceRoot,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/events") {
        this.openEventStream(response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/rpc") {
        await this.forwardRpc(request, response);
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/workspace/list"
      ) {
        this.writeJson(
          response,
          200,
          await this.workspace.list(url.searchParams.get("path") ?? ""),
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/workspace/file"
      ) {
        this.writeJson(
          response,
          200,
          await this.workspace.file(url.searchParams.get("path") ?? ""),
        );
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/workspace/changes"
      ) {
        this.writeJson(response, 200, await this.workspace.changes());
        return;
      }
      this.writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      this.writeJson(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async forwardRpc(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readBody(request, MAX_RPC_BODY_BYTES);
    const message = JSON.parse(body) as JsonRpcRequest;
    if (
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      message.id === undefined
    ) {
      throw new Error("A JSON-RPC request with an id is required.");
    }

    const internalId = `remote:${randomUUID()}`;
    const timeout = setTimeout(() => {
      const pending = this.pending.get(internalId);
      if (!pending) return;
      this.pending.delete(internalId);
      this.writeJson(pending.response, 504, {
        jsonrpc: "2.0",
        id: pending.originalId,
        error: { code: -32001, message: "Remote runtime request timed out." },
      });
    }, RPC_TIMEOUT_MS);
    this.pending.set(internalId, {
      originalId: message.id,
      response,
      timeout,
    });
    try {
      await this.options.peer.send({ ...message, id: internalId });
    } catch (error) {
      clearTimeout(timeout);
      this.pending.delete(internalId);
      throw error;
    }
  }

  private handlePeerMessage(message: JsonRpcOutgoing): void {
    if ("id" in message && typeof message.id === "string") {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        this.writeJson(pending.response, 200, {
          ...message,
          id: pending.originalId,
        } satisfies JsonRpcResponse);
        return;
      }
    }

    const line = `${JSON.stringify(message)}\n`;
    for (const client of this.eventClients) client.write(line);
  }

  private openEventStream(response: ServerResponse): void {
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("\n");
    this.eventClients.add(response);
    response.once("close", () => this.eventClients.delete(response));
  }

  private authorized(request: IncomingMessage): boolean {
    const value = request.headers.authorization;
    if (!value?.startsWith("Bearer ")) return false;
    const supplied = Buffer.from(value.slice(7));
    const expected = Buffer.from(this.options.token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
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
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
  }

  private writeJson(
    response: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    if (response.headersSent && !response.writableEnded) {
      response.end();
      return;
    }
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  }
}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
