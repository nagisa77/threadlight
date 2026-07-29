import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
  type ModelTurn,
} from "@threadlight/agent-loop";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationMcpRuntime } from "../src/mcp-runtime.js";
import {
  createMcpCapabilityTools,
  createMcpCallTool,
  createMcpConnectTool,
} from "../src/mcp-tools.js";

const runtimes: ConversationMcpRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

class ScriptedMcpProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly fixture: string) {}

  async generate(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return {
        text: "I’ll connect to the supplied MCP server.",
        toolCalls: [
          {
            id: "connect-1",
            name: "mcp_connect",
            arguments: {
              transport: "stdio",
              command: process.execPath,
              args: [this.fixture],
              cwd: null,
              url: null,
            },
          },
        ],
        state: [{ turn: "connect" }],
      };
    }

    if (this.requests.length === 2) {
      const discovery = JSON.parse(
        request.toolResults?.[0]?.output ?? "{}",
      ) as {
        connectionId: string;
        server?: { name: string };
        tools?: Array<{ name: string }>;
      };
      expect(discovery.server?.name).toBe("scripted-mcp");
      expect(discovery.tools).toMatchObject([{ name: "double" }]);
      return {
        text: "I found the double tool.",
        toolCalls: [
          {
            id: "call-1",
            name: "mcp_call",
            arguments: {
              connection_id: discovery.connectionId,
              tool_name: "double",
              arguments: { value: 21 },
            },
          },
        ],
        state: [{ turn: "call" }],
      };
    }

    return {
      text: request.toolResults?.[0]?.output ?? "missing MCP result",
      toolCalls: [],
      state: [{ turn: "complete" }],
    };
  }
}

describe("MCP tools", () => {
  it("maps MCP annotations to stable names and conservative impact metadata", async () => {
    const runtime = new ConversationMcpRuntime({
      connector: async () => {
        throw new Error("unused");
      },
    });
    runtimes.push(runtime);
    const tools = createMcpCapabilityTools(runtime, "gmail", {
      connectionId: "gmail-connection",
      tools: [
        {
          name: "search_threads",
          description: "Search Gmail",
          inputSchema: { type: "object" },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: true,
          },
        },
        {
          name: "delete_thread",
          description: "Delete a thread",
          inputSchema: { type: "object" },
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            openWorldHint: true,
          },
        },
        {
          name: "unknown_action",
          description: "Unannotated action",
          inputSchema: { type: "object" },
        },
      ],
    });

    expect(tools).toMatchObject([
      {
        name: "gmail__search_threads",
        mutability: "read",
        impact: { destructive: false, external: true },
      },
      {
        name: "gmail__delete_thread",
        mutability: "write",
        impact: { destructive: true, external: true },
      },
      {
        name: "gmail__unknown_action",
        mutability: "write",
        impact: { destructive: true, external: true },
      },
    ]);
  });

  it("lets a scripted model connect, discover, and call a real stdio MCP server", async () => {
    const fixture = fileURLToPath(
      new URL("./fixtures/scripted-mcp-server.mjs", import.meta.url),
    );
    const runtime = new ConversationMcpRuntime({
      workspaceRoot: process.cwd(),
      createConnectionId: () => "mcp-scripted-1",
    });
    runtimes.push(runtime);
    const provider = new ScriptedMcpProvider(fixture);

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "mcp-test",
        instructions: "Use MCP",
        tools: [
          createMcpConnectTool(runtime),
          createMcpCallTool(runtime),
        ],
      }),
      "Double 21 with the supplied MCP server",
    );

    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[1]?.state).toEqual([{ turn: "connect" }]);
    expect(provider.requests[2]?.state).toEqual([{ turn: "call" }]);
    expect(JSON.parse(result.output)).toMatchObject({
      content: [{ type: "text", text: "42" }],
      structuredContent: { value: 42 },
    });
  });

  it("paginates discovery, reuses an identical connection, and rejects unadvertised tools", async () => {
    const close = vi.fn(async () => undefined);
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const connector = vi.fn(async () => ({
      async listTools(cursor: string | undefined) {
        return cursor
          ? {
              tools: [
                {
                  name: "second",
                  inputSchema: { type: "object" as const },
                },
              ],
            }
          : {
              tools: [
                {
                  name: "first",
                  inputSchema: { type: "object" as const },
                },
              ],
              nextCursor: "page-2",
            };
      },
      callTool,
      serverInfo: () => ({ name: "fake", version: "1" }),
      instructions: () => undefined,
      close,
    }));
    const runtime = new ConversationMcpRuntime({
      workspaceRoot: process.cwd(),
      connector,
      createConnectionId: () => "mcp-fake-1",
    });
    runtimes.push(runtime);
    const signal = new AbortController().signal;
    const spec = {
      transport: "stdio",
      command: process.execPath,
      args: [],
      cwd: null,
      url: null,
    };

    const first = await runtime.connect(spec, signal);
    const second = await runtime.connect(spec, signal);

    expect(first).toEqual(second);
    expect(first.tools.map((tool) => tool.name)).toEqual(["first", "second"]);
    expect(connector).toHaveBeenCalledOnce();
    await expect(
      runtime.call(
        {
          connection_id: first.connectionId,
          tool_name: "missing",
          arguments: {},
        },
        signal,
      ),
    ).rejects.toThrow("was not advertised");
    expect(callTool).not.toHaveBeenCalled();

    await runtime.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it("falls back to anonymous discovery when an OAuth server rejects authenticated tool listing", async () => {
    let authenticatedLists = 0;
    let anonymousLists = 0;
    let authenticatedCalls = 0;
    const server = createServer(async (request, response) => {
      if (request.method === "GET") {
        response.writeHead(405).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const message = JSON.parse(body) as {
        id?: string | number;
        method?: string;
        params?: {
          arguments?: Record<string, unknown>;
        };
      };
      const authorized = request.headers.authorization === "Bearer fixture-token";
      if (message.method === "initialize") {
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "partial-scope", version: "1.0.0" },
          },
        });
        return;
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "tools/list") {
        if (authorized) authenticatedLists += 1;
        else anonymousLists += 1;
        sendJson(response, authorized ? 403 : 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "search_threads",
                description: "Search mail",
                inputSchema: { type: "object" },
                annotations: {
                  readOnlyHint: true,
                  destructiveHint: false,
                },
              },
            ],
          },
        });
        return;
      }
      if (message.method === "tools/call" && authorized) {
        authenticatedCalls += 1;
        const fails = message.params?.arguments?.fail === true;
        sendJson(response, fails ? 403 : 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [
              {
                type: "text",
                text: fails ? "Gmail MCP API is disabled" : "one unread thread",
              },
            ],
            ...(fails ? { isError: true } : {}),
          },
        });
        return;
      }
      response.writeHead(401).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const runtime = new ConversationMcpRuntime({
      createConnectionId: () => "mcp-oauth-discovery-1",
      oauthProviderFactory: () => ({
        redirectUrl: "http://127.0.0.1/callback",
        clientMetadata: {
          redirect_uris: ["http://127.0.0.1/callback"],
          client_name: "Threadlight",
        },
        clientInformation: () => ({ client_id: "fixture-client" }),
        tokens: () => ({
          access_token: "fixture-token",
          token_type: "Bearer",
        }),
        saveTokens: async () => undefined,
        redirectToAuthorization: async () => undefined,
        saveCodeVerifier: async () => undefined,
        codeVerifier: async () => "fixture-verifier",
      }),
    });
    runtimes.push(runtime);

    try {
      const connected = await runtime.connect(
        {
          transport: "streamable_http",
          url: `http://127.0.0.1:${port}/mcp`,
          oauth: {
            connectorId: "gmail",
            version: "1.0.0",
            scopes: ["mail.read"],
          },
        },
        new AbortController().signal,
      );
      expect(connected.tools.map(({ name }) => name)).toEqual([
        "search_threads",
      ]);
      await expect(
        runtime.call(
          {
            connection_id: connected.connectionId,
            tool_name: "search_threads",
            arguments: {},
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "one unread thread" }],
      });
      await expect(
        runtime.call(
          {
            connection_id: connected.connectionId,
            tool_name: "search_threads",
            arguments: { fail: true },
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow("Gmail MCP API is disabled");
      expect(authenticatedLists).toBe(1);
      expect(anonymousLists).toBe(1);
      expect(authenticatedCalls).toBe(2);
    } finally {
      await runtime.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });

  it("omits binary payloads from model-facing MCP tool results", async () => {
    const runtime = new ConversationMcpRuntime({
      workspaceRoot: process.cwd(),
      createConnectionId: () => "mcp-binary-1",
      connector: async () => ({
        listTools: async () => ({
          tools: [
            {
              name: "image",
              inputSchema: { type: "object" },
            },
          ],
        }),
        callTool: async () => ({
          content: [
            {
              type: "image",
              data: "aGVsbG8=",
              mimeType: "image/png",
            },
          ],
        }),
        serverInfo: () => undefined,
        instructions: () => undefined,
        close: async () => undefined,
      }),
    });
    runtimes.push(runtime);
    const signal = new AbortController().signal;
    const connected = await runtime.connect(
      {
        transport: "stdio",
        command: process.execPath,
        args: [],
        cwd: null,
        url: null,
      },
      signal,
    );

    await expect(
      runtime.call(
        {
          connection_id: connected.connectionId,
          tool_name: "image",
          arguments: {},
        },
        signal,
      ),
    ).resolves.toMatchObject({
      content: [
        {
          type: "image",
          mimeType: "image/png",
          dataOmitted: true,
          encodedBytes: 8,
        },
      ],
    });
  });
});

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(value));
}
