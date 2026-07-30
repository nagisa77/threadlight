import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";

import type {
  InteractiveOAuthClientProvider,
  McpOAuthSpec,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  OAuthTokens,
} from "@threadlight/builtin-tools";
import type {
  DesktopConnectionMethod,
  DesktopConnectionResponse,
  JsonRpcId,
} from "@threadlight/protocol";

const DESKTOP_CONNECTION_RPC_FD = "THREADLIGHT_CONNECTION_RPC_FD";
const OAUTH_CALLBACK_URL_PREFIX_ENV =
  "THREADLIGHT_OAUTH_CALLBACK_URL_PREFIX";
const DEFAULT_OAUTH_CALLBACK_URL_PREFIX =
  "http://127.0.0.1:43119/oauth/callback";
const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1_000;

export interface DesktopConnectorStatus {
  id: string;
  version: string;
  configured: boolean;
  authorized: boolean;
}

export class DesktopConnectionClient {
  private readonly lines: ReadlineInterface;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  private nextId = 1;

  constructor(
    private readonly transport: Duplex,
    private readonly oauthCallbackUrlPrefix =
      DEFAULT_OAUTH_CALLBACK_URL_PREFIX,
  ) {
    this.lines = createInterface({ input: transport });
    this.lines.on("line", (line) => this.receive(line));
    transport.on("error", (error) => this.failAll(error));
    transport.on("close", () =>
      this.failAll(new Error("Desktop connection service disconnected")),
    );
  }

  oauthProvider(spec: McpOAuthSpec): InteractiveOAuthClientProvider {
    return new DesktopOAuthProvider(
      this,
      spec,
      this.oauthCallbackUrlPrefix,
    );
  }

  connectorStatus(
    connectorId: string,
    version: string,
  ): Promise<DesktopConnectorStatus> {
    return this.request("connection/status", { connectorId, version });
  }

  connectorRedirectUrl(connectorId: string): string {
    return oauthCallbackUrl(this.oauthCallbackUrlPrefix, connectorId);
  }

  configureConnector(
    connectorId: string,
    version: string,
    clientId: string,
    clientSecret: string,
  ): Promise<DesktopConnectorStatus> {
    return this.request("connection/configure", {
      connectorId,
      version,
      clientId,
      clientSecret,
    });
  }

  async disconnectConnector(
    connectorId: string,
    version: string,
  ): Promise<DesktopConnectorStatus> {
    await this.request("connection/invalidate", {
      connectorId,
      version,
      scope: "all",
    });
    return this.connectorStatus(connectorId, version);
  }

  request<Result>(
    method: DesktopConnectionMethod,
    params: Record<string, unknown>,
  ): Promise<Result> {
    const id = this.nextId++;
    return new Promise<Result>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
      });
      this.transport.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (!error) return;
          this.pending.delete(id);
          reject(error);
        },
      );
    });
  }

  dispose(): void {
    this.lines.close();
    this.transport.destroy();
    this.failAll(new Error("Desktop connection client disposed"));
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let response: DesktopConnectionResponse;
    try {
      response = JSON.parse(line) as DesktopConnectionResponse;
    } catch {
      this.failAll(new Error("Desktop connection service returned invalid JSON"));
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

class DesktopOAuthProvider implements InteractiveOAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    private readonly client: DesktopConnectionClient,
    private readonly spec: McpOAuthSpec,
    oauthCallbackUrlPrefix: string,
  ) {
    this.redirectUrl = oauthCallbackUrl(
      oauthCallbackUrlPrefix,
      spec.connectorId,
    );
    this.clientMetadata = {
      redirect_uris: [this.redirectUrl],
      client_name: "Threadlight",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: spec.clientSecretRequired
        ? "client_secret_post"
        : "none",
      ...(spec.scopes?.length
        ? { scope: spec.scopes.join(" ") }
        : {}),
    };
  }

  async state(): Promise<string> {
    const result = await this.request<{ state: string }>(
      "connection/create-state",
    );
    return result.state;
  }

  async clientInformation(): Promise<
    OAuthClientInformationMixed | undefined
  > {
    if (this.spec.clientId) {
      return {
        client_id: this.spec.clientId,
        ...(this.spec.clientSecret
          ? { client_secret: this.spec.clientSecret }
          : {}),
      };
    }
    return this.get<OAuthClientInformationMixed>("clientInformation");
  }

  saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    return this.set("clientInformation", clientInformation);
  }

  tokens(): Promise<OAuthTokens | undefined> {
    return this.get<OAuthTokens>("tokens");
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return this.set("tokens", tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.request("connection/open-authorization", {
      url: authorizationUrl.toString(),
    });
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.set("codeVerifier", codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.get<string>("codeVerifier");
    if (!verifier) throw new Error("OAuth PKCE verifier is unavailable");
    return verifier;
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    return this.request("connection/invalidate", { scope });
  }

  saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    return this.set("discoveryState", state);
  }

  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.get<OAuthDiscoveryState>("discoveryState");
  }

  async takeAuthorizationCode(): Promise<string | undefined> {
    const result = await this.request<{ code?: string }>(
      "connection/take-code",
    );
    return result.code;
  }

  async waitForAuthorizationCode(): Promise<string> {
    const result = await this.request<{ code: string }>(
      "connection/wait-code",
      { timeoutMs: AUTHORIZATION_TIMEOUT_MS },
    );
    return result.code;
  }

  private get<Value>(
    field:
      | "clientInformation"
      | "tokens"
      | "codeVerifier"
      | "discoveryState",
  ): Promise<Value | undefined> {
    return this.request("connection/get", { field });
  }

  private async set(
    field:
      | "clientInformation"
      | "tokens"
      | "codeVerifier"
      | "discoveryState",
    value: unknown,
  ): Promise<void> {
    await this.request("connection/set", { field, value });
  }

  private request<Result = unknown>(
    method: DesktopConnectionMethod,
    params: Record<string, unknown> = {},
  ): Promise<Result> {
    return this.client.request<Result>(method, {
      connectorId: this.spec.connectorId,
      version: this.spec.version,
      ...params,
    });
  }
}

export function createDesktopConnectionClientFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DesktopConnectionClient | undefined {
  const rawFd = environment[DESKTOP_CONNECTION_RPC_FD];
  if (!rawFd) return;
  const fd = Number(rawFd);
  if (!Number.isInteger(fd) || fd < 3) {
    throw new Error(`${DESKTOP_CONNECTION_RPC_FD} must be a file descriptor`);
  }
  return new DesktopConnectionClient(
    new Socket({ fd, readable: true, writable: true }),
    normalizeOAuthCallbackUrlPrefix(
      environment[OAUTH_CALLBACK_URL_PREFIX_ENV] ??
        DEFAULT_OAUTH_CALLBACK_URL_PREFIX,
    ),
  );
}

function normalizeOAuthCallbackUrlPrefix(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `${OAUTH_CALLBACK_URL_PREFIX_ENV} must use http or https`,
    );
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function oauthCallbackUrl(
  prefix: string,
  connectorId: string,
): string {
  return `${normalizeOAuthCallbackUrlPrefix(prefix)}/${encodeURIComponent(connectorId)}`;
}
