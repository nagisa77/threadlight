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

import type { RuntimeContext } from "./host-server.js";
import {
  BROWSER_TERMINAL_TOKEN_PREFIX,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
  RPC_TIMEOUT_MS,
} from "./host-constants.js";

export function rejectUpgrade(
  socket: Duplex,
  status: number,
  message: string,
): void {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

export function serverSentEvent(message: JsonRpcOutgoing): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

export function browserWebSocketToken(
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

export function runtimeRoute(
  pathname: string,
): { projectId: string; action: string } | undefined {
  const match = /^\/v1\/projects\/([^/]+)\/runtime(\/.*)$/.exec(pathname);
  if (!match) return;
  return {
    projectId: decodeURIComponent(match[1]!),
    action: match[2]!,
  };
}

export function hostConversationWorkspaceRoute(
  pathname: string,
): { projectId: string; threadId: string; action: string } | undefined {
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

export function runtimeKey(projectId: string, workspacePath: string): string {
  return `${projectId}\u0000${workspacePath}`;
}

export function conversationRuntimeFailureKey(
  projectId: string,
  threadId: string,
): string {
  return `${projectId}\u0000${threadId}`;
}

export function boundedRuntimeError(error: Error): string {
  const message = error.message.trim();
  return (message || "Remote runtime app-server exited unexpectedly.").slice(
    0,
    2_000,
  );
}

export async function initializeRuntimePeer(
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
      void Promise.resolve(
        peer.send({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          ...(params ? { params } : {}),
        } as JsonRpcRequest),
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

export function requestRuntimePeer(
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

export function hostAttachmentRoute(
  pathname: string,
): { projectId: string; attachmentId?: string } | undefined {
  const match =
    /^\/v1\/host\/projects\/([^/]+)\/attachments(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return;
  return {
    projectId: decodeURIComponent(match[1]!),
    ...(match[2] ? { attachmentId: decodeURIComponent(match[2]) } : {}),
  };
}

export function attachmentUploadRoot(projectRoot: string): string {
  return join(projectRoot, ".threadlight", "uploads");
}

export function attachmentName(value: string | null): string {
  const name = basename(value?.trim() ?? "");
  if (!name || name === "." || name === ".." || name.length > 255) {
    throw new Error("A valid attachment name is required.");
  }
  return name;
}

export function attachmentMimeType(value: string | null): string {
  const mimeType = value?.trim() ?? "";
  if (!mimeType || mimeType.length > 255 || /[\r\n]/.test(mimeType)) {
    throw new Error("A valid attachment MIME type is required.");
  }
  return mimeType;
}

export function attachmentSize(value: string | null): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment must be non-empty and smaller than 50 MB.");
  }
  return size;
}

export function parseProviderTestRequest(
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

export function isModelProvider(
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

export async function jsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readBody(request, MAX_BODY_BYTES)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A JSON object body is required.");
  }
  return parsed as Record<string, unknown>;
}

export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function requiredQuery(url: URL, name: string): string {
  return requiredString(url.searchParams.get(name), name);
}

export function optionalStringArray(
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

export function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} is required.`);
  return value;
}

export async function listHostDirectories(
  value: string,
  options: HostDirectoryListOptions = {},
): Promise<HostDirectoryListing> {
  const requestedPath = value.trim();
  const typedSegment = trailingPathSegment(requestedPath);
  const showHiddenDirectories =
    options.showHidden === true ||
    (options.strict !== true && typedSegment.startsWith("."));
  const input = expandHomeDirectory(requestedPath);
  if (!input || !isAbsolute(input)) {
    throw new Error("An absolute Host directory path is required.");
  }

  let directory = typedSegment === "." ? normalize(input) : input;
  let prefix = options.strict ? "" : typedSegment === "." ? "." : "";
  if (options.strict) {
    try {
      if (!(await stat(directory)).isDirectory()) {
        throw new Error("The remote path is not a folder.");
      }
      directory = normalize(directory);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      throw new Error("The remote folder does not exist.");
    }
  } else if (prefix === "") {
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
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries
        .filter(
          (entry) =>
            (!entry.name.startsWith(".") || showHiddenDirectories) &&
            entry.name
              .toLocaleLowerCase()
              .startsWith(prefix.toLocaleLowerCase()),
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

  const parentPath = dirname(directory);
  return {
    path: directory,
    ...(parentPath !== directory ? { parentPath } : {}),
    directories,
  };
}

export function expandHomeDirectory(value: string): string {
  if (value === "~") return homedir();
  return value.startsWith("~/") || value.startsWith("~\\")
    ? join(homedir(), value.slice(2))
    : value;
}

export function trailingPathSegment(value: string): string {
  const lastSeparator = Math.max(
    value.lastIndexOf("/"),
    value.lastIndexOf("\\"),
  );
  return value.slice(lastSeparator + 1);
}

export function isMissingPathError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<string> {
  return readBinaryBody(request, limit).then((content) =>
    content.toString("utf8"),
  );
}

export function readBinaryBody(
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

export function audioMimeType(value: string | null): string {
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

export function parseHostSearchRequest(value: unknown): HostSearchRequest {
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
    ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
  };
}

export function parseAutomationRequest(
  value: unknown,
  update?: false,
): HostAutomationCreateRequest;
export function parseAutomationRequest(
  value: unknown,
  update: true,
): HostAutomationUpdateRequest;
export function parseAutomationRequest(
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
  return update ? { ...base, id: request.id as string } : base;
}

export function parseAutomationTarget(value: unknown): {
  projectId: string;
  id: string;
} {
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

export function developmentModeForThreadStart(
  request: JsonRpcRequest,
): TaskDevelopmentMode {
  const params =
    request.params && typeof request.params === "object"
      ? (request.params as Record<string, unknown>)
      : undefined;
  const mode = params?.developmentMode;
  if (mode === undefined) return "local";
  if (mode === "local" || mode === "worktree") return mode;
  throw new Error("Invalid task development mode");
}

export function hostOAuthCallbackRoute(
  pathname: string,
): { connectorId: string } | undefined {
  const match =
    /^\/v1\/host\/oauth\/callback\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  return match?.[1] ? { connectorId: match[1] } : undefined;
}

export function hostDiagnosticsProjectId(pathname: string): string | undefined {
  const match = /^\/v1\/host\/projects\/([^/]+)\/diagnostics$/.exec(pathname);
  if (!match?.[1]) return;
  const projectId = decodeURIComponent(match[1]);
  if (!projectId || projectId.length > 256) {
    throw new Error("Invalid project id");
  }
  return projectId;
}

export function hostDiagnosticBundleProjectId(
  pathname: string,
): string | undefined {
  const match = /^\/v1\/host\/projects\/([^/]+)\/diagnostics\/bundle$/.exec(
    pathname,
  );
  if (!match?.[1]) return;
  const projectId = decodeURIComponent(match[1]);
  if (!projectId || projectId.length > 256) {
    throw new Error("Invalid project id");
  }
  return projectId;
}

export function parseDiagnosticBundleRequest(
  value: unknown,
): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid diagnostic bundle request");
  }
  const conversationIds = (value as Record<string, unknown>).conversationIds;
  if (
    !Array.isArray(conversationIds) ||
    conversationIds.length === 0 ||
    conversationIds.length > 500 ||
    conversationIds.some((id) => typeof id !== "string" || !/^[\w-]+$/.test(id))
  ) {
    throw new Error("Invalid diagnostic conversation selection");
  }
  return [...new Set(conversationIds as string[])];
}

export function hostAutomationsProjectId(pathname: string): string | undefined {
  const match = /^\/v1\/host\/projects\/([^/]+)\/automations$/.exec(pathname);
  if (!match?.[1]) return;
  const projectId = decodeURIComponent(match[1]);
  if (!projectId || projectId.length > 256) {
    throw new Error("Invalid project id");
  }
  return projectId;
}

export function normalizeHostEndpoint(value: string): string {
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

export function normalizeOAuthCallbackUrlPrefix(value: string): string {
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

export function oauthResultPage(title: string, message: string): string {
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
