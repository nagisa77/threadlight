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
