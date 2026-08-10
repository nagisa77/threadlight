import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  auth,
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOOLS = 200;
const DEFAULT_MAX_TEXT_CHARS = 100_000;

export type McpServerSpec =
  | {
      transport: "stdio";
      command: string;
      args: readonly string[];
      cwd?: string;
    }
  | {
      transport: "streamable_http";
      url: string;
      oauth?: McpOAuthSpec;
    };

export interface McpOAuthSpec {
  connectorId: string;
  version: string;
  clientId?: string;
  clientSecret?: string;
  clientSecretRequired?: boolean;
  scopes?: readonly string[];
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type McpToolSecurityScheme =
  | { type: "noauth" }
  | { type: "oauth2"; scopes: readonly string[] };

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  securitySchemes?: readonly McpToolSecurityScheme[];
}

export interface McpConnectResult {
  connectionId: string;
  server?: {
    name: string;
    version: string;
  };
  instructions?: string;
  tools: readonly McpDiscoveredTool[];
}

export interface McpConnection {
  listTools(
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<{
    tools: readonly McpDiscoveredTool[];
    nextCursor?: string;
  }>;
  callTool(
    name: string,
    arguments_: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
  serverInfo(): { name: string; version: string } | undefined;
  instructions(): string | undefined;
  close(): Promise<void>;
}

export type McpConnector = (
  spec: McpServerSpec,
  signal: AbortSignal,
) => Promise<McpConnection>;

export interface InteractiveOAuthClientProvider
  extends OAuthClientProvider {
  takeAuthorizationCode?(): Promise<string | undefined>;
  waitForAuthorizationCode?(): Promise<string>;
}

export type McpOAuthProviderFactory = (
  spec: McpOAuthSpec,
) => InteractiveOAuthClientProvider;

export interface ConversationMcpRuntimeOptions {
  workspaceRoot?: string;
  connector?: McpConnector;
  createConnectionId?: () => string;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  maxTools?: number;
  maxTextChars?: number;
  oauthProviderFactory?: McpOAuthProviderFactory;
}

interface ActiveConnection {
  client: McpConnection;
  result: McpConnectResult;
  toolNames: ReadonlySet<string>;
}

export class ConversationMcpRuntime {
  private readonly workspaceRoot: string;
  private readonly connector: McpConnector;
  private readonly createConnectionId: () => string;
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly maxTools: number;
  private readonly maxTextChars: number;
  private readonly oauthProviderFactory?: McpOAuthProviderFactory;
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly connectionIdsBySpec = new Map<string, string>();
  private disposed = false;

  constructor(options: ConversationMcpRuntimeOptions = {}) {
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.connector =
      options.connector ??
      ((spec, signal) =>
        connectWithOfficialSdk(
          spec,
          signal,
          options.oauthProviderFactory,
        ));
    this.createConnectionId =
      options.createConnectionId ?? (() => `mcp_${randomUUID()}`);
    this.connectTimeoutMs = positiveInteger(
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      "connectTimeoutMs",
    );
    this.callTimeoutMs = positiveInteger(
      options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
      "callTimeoutMs",
    );
    this.maxTools = positiveInteger(
      options.maxTools ?? DEFAULT_MAX_TOOLS,
      "maxTools",
    );
    this.maxTextChars = positiveInteger(
      options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
      "maxTextChars",
    );
    this.oauthProviderFactory = options.oauthProviderFactory;
  }

  async authorize(
    value: unknown,
    signal: AbortSignal,
  ): Promise<McpConnectResult> {
    this.requireActive();
    const spec = await parseServerSpec(value, this.workspaceRoot);
    if (spec.transport !== "streamable_http" || !spec.oauth) {
      throw new Error("Only OAuth-enabled Streamable HTTP MCP servers can be authorized");
    }

    await this.disconnect(spec);
    const provider = requireOAuthProvider(
      this.oauthProviderFactory,
      spec.oauth,
    );
    const existingCode =
      await provider.takeAuthorizationCode?.();
    let result = await authorizeWithSignal(
      provider,
      new URL(spec.url),
      signal,
      spec.oauth.scopes,
      existingCode,
    );
    if (result === "REDIRECT") {
      if (!provider.waitForAuthorizationCode) {
        throw new Error(
          `MCP connector ${spec.oauth.connectorId} cannot receive the OAuth callback`,
        );
      }
      const authorizationCode = await waitWithSignal(
        provider.waitForAuthorizationCode(),
        signal,
      );
      result = await authorizeWithSignal(
        provider,
        new URL(spec.url),
        signal,
        spec.oauth.scopes,
        authorizationCode,
      );
    }
    if (result !== "AUTHORIZED") {
      throw new Error(
        `MCP connector ${spec.oauth.connectorId} did not complete authorization`,
      );
    }
    return this.connect(spec, signal);
  }

  async connect(value: unknown, signal: AbortSignal): Promise<McpConnectResult> {
    this.requireActive();
    const spec = await parseServerSpec(value, this.workspaceRoot);
    const key = stableSpecKey(spec);
    const existingId = this.connectionIdsBySpec.get(key);
    if (existingId) {
      const existing = this.connections.get(existingId);
      if (existing) return existing.result;
    }

    const requestSignal =
      spec.transport === "streamable_http" && spec.oauth
        ? signal
        : withTimeout(signal, this.connectTimeoutMs);
    const client = await this.connector(spec, requestSignal);

    try {
      const tools = await listAllTools(client, requestSignal, this.maxTools);
      const connectionId = this.createConnectionId();
      if (!connectionId || this.connections.has(connectionId)) {
        throw new Error("MCP connection id must be unique and non-empty");
      }
      const server = client.serverInfo();
      const instructions = client.instructions();
      const result: McpConnectResult = {
        connectionId,
        ...(server ? { server } : {}),
        ...(instructions ? { instructions } : {}),
        tools,
      };
      this.connections.set(connectionId, {
        client,
        result,
        toolNames: new Set(tools.map((tool) => tool.name)),
      });
      this.connectionIdsBySpec.set(key, connectionId);
      return result;
    } catch (error) {
      await closeIgnoringErrors(client);
      throw readableMcpTransportError(error);
    }
  }

  async call(value: unknown, signal: AbortSignal): Promise<unknown> {
    this.requireActive();
    const parsed = parseCallArguments(value);
    const connection = this.connections.get(parsed.connectionId);
    if (!connection) {
      throw new Error(`Unknown MCP connection: ${parsed.connectionId}`);
    }
    if (!connection.toolNames.has(parsed.toolName)) {
      throw new Error(
        `MCP tool ${parsed.toolName} was not advertised by this connection`,
      );
    }

    let result: unknown;
    try {
      result = await connection.client.callTool(
        parsed.toolName,
        parsed.arguments,
        withTimeout(signal, this.callTimeoutMs),
      );
    } catch (error) {
      const recovered = recoverJsonRpcResult(error);
      if (recovered === undefined) {
        throw readableMcpTransportError(error);
      }
      result = recovered;
    }
    if (isObject(result) && result.isError === true) {
      throw new Error(mcpErrorMessage(result, this.maxTextChars));
    }
    return normalizeToolResult(result, this.maxTextChars);
  }

  async disconnect(value: unknown): Promise<void> {
    this.requireActive();
    const spec = await parseServerSpec(value, this.workspaceRoot);
    const key = stableSpecKey(spec);
    const connectionId = this.connectionIdsBySpec.get(key);
    if (!connectionId) return;
    this.connectionIdsBySpec.delete(key);
    const connection = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    if (connection) await closeIgnoringErrors(connection.client);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const clients = [...this.connections.values()].map(({ client }) => client);
    this.connections.clear();
    this.connectionIdsBySpec.clear();
    await Promise.all(clients.map(closeIgnoringErrors));
  }

  private requireActive(): void {
    if (this.disposed) throw new Error("MCP runtime has been disposed");
  }
}

async function authorizeWithSignal(
  provider: InteractiveOAuthClientProvider,
  serverUrl: URL,
  signal: AbortSignal,
  scopes?: readonly string[],
  authorizationCode?: string,
): Promise<"AUTHORIZED" | "REDIRECT"> {
  throwIfAborted(signal);
  return auth(provider, {
    serverUrl,
    ...(scopes?.length ? { scope: scopes.join(" ") } : {}),
    ...(authorizationCode ? { authorizationCode } : {}),
    fetchFn: (input, init) =>
      fetch(input, {
        ...init,
        signal,
      }),
  });
}

async function waitWithSignal<Value>(
  promise: Promise<Value>,
  signal: AbortSignal,
): Promise<Value> {
  throwIfAborted(signal);
  return new Promise<Value>((resolvePromise, rejectPromise) => {
    const abort = () => {
      rejectPromise(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolvePromise(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        rejectPromise(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function readableMcpTransportError(error: unknown): unknown {
  if (!(error instanceof StreamableHTTPError)) return error;
  const message =
    error.message.length > 1_200
      ? `${error.message.slice(0, 1_200)}…`
      : error.message;
  return new Error(`MCP HTTP ${error.code}: ${message}`, {
    cause: error,
  });
}

function recoverJsonRpcResult(error: unknown): unknown {
  if (!(error instanceof StreamableHTTPError)) return;
  const marker = "Error POSTing to endpoint: ";
  const start = error.message.indexOf(marker);
  if (start < 0) return;
  try {
    const response = JSON.parse(
      error.message.slice(start + marker.length),
    ) as unknown;
    if (
      isObject(response) &&
      response.jsonrpc === "2.0" &&
      "result" in response
    ) {
      return response.result;
    }
  } catch {
    return;
  }
}

async function connectWithOfficialSdk(
  spec: McpServerSpec,
  signal: AbortSignal,
  oauthProviderFactory?: McpOAuthProviderFactory,
): Promise<McpConnection> {
  const client = new Client(
    { name: "threadlight", version: "1.0.0" },
    { capabilities: {} },
  );
  const authProvider =
    spec.transport === "streamable_http" && spec.oauth
      ? requireOAuthProvider(oauthProviderFactory, spec.oauth)
      : undefined;
  const transport =
    spec.transport === "stdio"
      ? new StdioClientTransport({
          command: spec.command,
          args: [...spec.args],
          ...(spec.cwd ? { cwd: spec.cwd } : {}),
          stderr: "pipe",
        })
      : new StreamableHTTPClientTransport(new URL(spec.url), {
          ...(authProvider ? { authProvider } : {}),
        });
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on("data", () => undefined);
  }

  try {
    if (
      transport instanceof StreamableHTTPClientTransport &&
      authProvider?.takeAuthorizationCode
    ) {
      const authorizationCode =
        await authProvider.takeAuthorizationCode();
      if (authorizationCode) {
        await transport.finishAuth(authorizationCode);
      }
    }
    await client.connect(transport, { signal });
  } catch (error) {
    if (
      error instanceof UnauthorizedError &&
      spec.transport === "streamable_http" &&
      transport instanceof StreamableHTTPClientTransport &&
      authProvider?.waitForAuthorizationCode
    ) {
      const authorizationCode =
        await authProvider.waitForAuthorizationCode();
      await transport.finishAuth(authorizationCode);
      await client.close().catch(() => undefined);
      return connectWithOfficialSdk(
        spec,
        signal,
        oauthProviderFactory,
      );
    }
    await client.close().catch(() => undefined);
    if (
      error instanceof UnauthorizedError &&
      spec.transport === "streamable_http"
    ) {
      throw new Error(
        `Authorization is required for MCP connector ${spec.oauth?.connectorId ?? new URL(spec.url).hostname}. Complete authorization in the browser, then retry the turn.`,
      );
    }
    throw error;
  }

  let anonymousDiscovery: Promise<McpConnection> | undefined;
  return {
    async listTools(cursor, requestSignal) {
      let page;
      try {
        page = await client.listTools(
          cursor ? { cursor } : undefined,
          { signal: requestSignal },
        );
      } catch (error) {
        if (
          !(error instanceof StreamableHTTPError) ||
          error.code !== 403 ||
          spec.transport !== "streamable_http" ||
          !spec.oauth
        ) {
          throw error;
        }
        anonymousDiscovery ??= connectWithOfficialSdk(
          {
            transport: "streamable_http",
            url: spec.url,
          },
          requestSignal,
        );
        return (await anonymousDiscovery).listTools(
          cursor,
          requestSignal,
        );
      }
      return {
        tools: page.tools.map((tool) => {
          const compatible = tool as typeof tool & {
            securitySchemes?: unknown;
          };
          const securitySchemes = parseSecuritySchemes(
            compatible.securitySchemes ??
              (isObject(tool._meta)
                ? tool._meta.securitySchemes
                : undefined),
          );
          return {
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
            ...(tool.annotations
              ? { annotations: { ...tool.annotations } }
              : {}),
            ...(securitySchemes ? { securitySchemes } : {}),
          };
        }),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
    callTool(name, arguments_, requestSignal) {
      return client.callTool(
        { name, arguments: arguments_ },
        undefined,
        { signal: requestSignal },
      );
    },
    serverInfo() {
      return client.getServerVersion();
    },
    instructions() {
      return client.getInstructions();
    },
    async close() {
      await client.close();
      if (anonymousDiscovery) {
        const discovery = await anonymousDiscovery.catch(() => undefined);
        await discovery?.close();
      }
    },
  };
}

async function listAllTools(
  connection: McpConnection,
  signal: AbortSignal,
  maxTools: number,
): Promise<McpDiscoveredTool[]> {
  const tools: McpDiscoveredTool[] = [];
  const names = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await connection.listTools(cursor, signal);
    for (const tool of page.tools) {
      if (!tool.name) throw new Error("MCP server returned a tool without a name");
      if (names.has(tool.name)) {
        throw new Error(`MCP server returned duplicate tool: ${tool.name}`);
      }
      names.add(tool.name);
      tools.push(tool);
      if (tools.length > maxTools) {
        throw new Error(`MCP server advertised more than ${maxTools} tools`);
      }
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (cursors.has(cursor)) {
        throw new Error("MCP server repeated a tools/list cursor");
      }
      cursors.add(cursor);
    }
  } while (cursor);

  return tools;
}

async function parseServerSpec(
  value: unknown,
  workspaceRoot: string,
): Promise<McpServerSpec> {
  if (!isObject(value)) throw new Error("arguments must be an object");
  const transport = value.transport;
  if (transport === "stdio") {
    if (value.url !== undefined && value.url !== null) {
      throw new Error("url must be null for a stdio MCP server");
    }
    const command = nonEmptyString(value.command, "command");
    const args = stringArray(value.args, "args");
    const cwdValue = value.cwd;
    if (
      cwdValue !== undefined &&
      cwdValue !== null &&
      (typeof cwdValue !== "string" || cwdValue.length === 0)
    ) {
      throw new Error("cwd must be a non-empty string or null");
    }
    return {
      transport,
      command,
      args,
      cwd: await resolveWorkingDirectory(
        workspaceRoot,
        typeof cwdValue === "string" ? cwdValue : undefined,
      ),
    };
  }
  if (transport === "streamable_http") {
    if (
      (value.command !== undefined && value.command !== null) ||
      (value.args !== undefined && value.args !== null) ||
      (value.cwd !== undefined && value.cwd !== null)
    ) {
      throw new Error(
        "command, args, and cwd must be null for a Streamable HTTP MCP server",
      );
    }
    const url = new URL(nonEmptyString(value.url, "url"));
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHost(url.hostname))
    ) {
      throw new Error(
        "remote MCP URLs must use HTTPS; HTTP is allowed only for loopback hosts",
      );
    }
    const oauth =
      value.oauth === undefined ? undefined : parseOAuthSpec(value.oauth);
    return {
      transport,
      url: url.toString(),
      ...(oauth ? { oauth } : {}),
    };
  }
  throw new Error("transport must be stdio or streamable_http");
}

function parseCallArguments(value: unknown): {
  connectionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
} {
  if (!isObject(value)) throw new Error("arguments must be an object");
  const arguments_ = value.arguments;
  if (!isObject(arguments_)) {
    throw new Error("arguments must contain a tool arguments object");
  }
  return {
    connectionId: nonEmptyString(value.connection_id, "connection_id"),
    toolName: nonEmptyString(value.tool_name, "tool_name"),
    arguments: arguments_,
  };
}

async function resolveWorkingDirectory(
  workspaceRoot: string,
  requestedCwd: string | undefined,
): Promise<string> {
  const canonicalRoot = await realpath(workspaceRoot);
  const candidate = requestedCwd
    ? resolve(canonicalRoot, requestedCwd)
    : canonicalRoot;
  const canonicalCwd = await realpath(candidate);
  const path = relative(canonicalRoot, canonicalCwd);
  if (
    path !== "" &&
    (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
  ) {
    throw new Error("MCP server cwd must stay within the workspace root");
  }
  return canonicalCwd;
}

function normalizeToolResult(value: unknown, maxTextChars: number): unknown {
  if (!isObject(value) || !Array.isArray(value.content)) return value;
  let remaining = maxTextChars;
  const content = value.content.map((item) => {
    if (!isObject(item)) return item;
    if (item.type === "text" && typeof item.text === "string") {
      const text = truncateText(item.text, remaining);
      remaining -= text.length;
      return { ...item, text };
    }
    if (
      (item.type === "image" || item.type === "audio") &&
      typeof item.data === "string"
    ) {
      const { data, ...metadata } = item;
      return {
        ...metadata,
        dataOmitted: true,
        encodedBytes: data.length,
      };
    }
    if (
      item.type === "resource" &&
      isObject(item.resource) &&
      typeof item.resource.blob === "string"
    ) {
      const { blob, ...resource } = item.resource;
      return {
        ...item,
        resource: {
          ...resource,
          blobOmitted: true,
          encodedBytes: blob.length,
        },
      };
    }
    return item;
  });
  return { ...value, content };
}

function mcpErrorMessage(
  value: Record<string, unknown>,
  maxTextChars: number,
): string {
  const normalized = normalizeToolResult(value, maxTextChars);
  if (isObject(normalized) && Array.isArray(normalized.content)) {
    const text = normalized.content
      .filter(
        (item): item is { type: "text"; text: string } =>
          isObject(item) && item.type === "text" && typeof item.text === "string",
      )
      .map((item) => item.text)
      .join("\n");
    if (text) return text;
  }
  return JSON.stringify(normalized);
}

function stableSpecKey(spec: McpServerSpec): string {
  return JSON.stringify(spec);
}

function requireOAuthProvider(
  factory: McpOAuthProviderFactory | undefined,
  spec: McpOAuthSpec,
): InteractiveOAuthClientProvider {
  if (!factory) {
    throw new Error(
      `MCP connector ${spec.connectorId} requires desktop OAuth support`,
    );
  }
  return factory(spec);
}

function parseOAuthSpec(value: unknown): McpOAuthSpec {
  if (!isObject(value)) throw new Error("oauth must be an object");
  const connectorId = nonEmptyString(
    value.connectorId,
    "oauth.connectorId",
  );
  const version = nonEmptyString(value.version, "oauth.version");
  const clientId =
    value.clientId === undefined
      ? undefined
      : nonEmptyString(value.clientId, "oauth.clientId");
  const clientSecret =
    value.clientSecret === undefined
      ? undefined
      : nonEmptyString(value.clientSecret, "oauth.clientSecret");
  const clientSecretRequired =
    value.clientSecretRequired === undefined
      ? undefined
      : booleanValue(
          value.clientSecretRequired,
          "oauth.clientSecretRequired",
        );
  const scopes =
    value.scopes === undefined
      ? undefined
      : stringArray(value.scopes, "oauth.scopes");
  return {
    connectorId,
    version,
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(clientSecretRequired !== undefined
      ? { clientSecretRequired }
      : {}),
    ...(scopes ? { scopes } : {}),
  };
}

function parseSecuritySchemes(
  value: unknown,
): McpToolSecurityScheme[] | undefined {
  if (!Array.isArray(value)) return;
  const schemes: McpToolSecurityScheme[] = [];
  for (const scheme of value) {
    if (!isObject(scheme)) continue;
    if (scheme.type === "noauth") {
      schemes.push({ type: "noauth" });
    } else if (
      scheme.type === "oauth2" &&
      Array.isArray(scheme.scopes) &&
      scheme.scopes.every((scope) => typeof scope === "string")
    ) {
      schemes.push({ type: "oauth2", scopes: [...scheme.scopes] });
    }
  }
  return schemes.length > 0 ? schemes : undefined;
}

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

async function closeIgnoringErrors(connection: McpConnection): Promise<void> {
  try {
    await connection.close();
  } catch {
    // Connection teardown must not hide the original failure or block disposal.
  }
}

function truncateText(value: string, limit: number): string {
  if (limit <= 0) return "";
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
