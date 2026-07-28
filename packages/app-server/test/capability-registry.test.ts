import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";
import { ConversationMcpRuntime } from "@threadlight/builtin-tools";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppServer } from "../src/app-server.js";
import { createSkillPluginThreadRuntime } from "../src/thread-extensions.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("capability registry", () => {
  it("lists skills and fixed MCP servers, then resolves selected capabilities for one turn", async () => {
    const root = temporaryDirectory("threadlight-capabilities-");
    const repoSkills = join(root, ".agents", "skills");
    writeSkill(repoSkills);
    const requests: ModelRequest[] = [];
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "mail result" }],
    }));
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain("DOCUMENT_WORKFLOW");
          expect(request.instructions).toContain(
            "explicitly selected the @Gmail MCP capability",
          );
          const gmailTool = request.tools.find(({ name }) =>
            name.startsWith("mcp_gmail_"),
          );
          expect(gmailTool).toMatchObject({
            description: "Search Gmail",
          });
          return {
            text: "I’ll search Gmail.",
            toolCalls: [
              {
                id: "gmail-1",
                name: gmailTool!.name,
                arguments: { query: "launch" },
              },
            ],
            state: { step: 1 },
          };
        }
        expect(request.state).toEqual({ step: 1 });
        expect(request.toolResults?.[0]?.output).toContain("mail result");
        return { text: "Done.", toolCalls: [], state: { step: 2 } };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "capabilities", instructions: "Base." }),
      threadRuntimeFactory: async (snapshot) => {
        const mcpRuntime = new ConversationMcpRuntime({
          workspaceRoot: root,
          createConnectionId: () => "mcp-gmail-1",
          connector: async () => ({
            listTools: async () => ({
              tools: [
                {
                  name: "search",
                  description: "Search Gmail",
                  inputSchema: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"],
                  },
                },
              ],
            }),
            callTool,
            serverInfo: () => ({ name: "gmail", version: "1.0.0" }),
            instructions: () => "Search before reading a message.",
            close: async () => undefined,
          }),
        });
        const extensions = await createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            builtinSkillRoots: [],
            repoSkillRoots: [repoSkills],
            userSkillRoots: [],
            pluginRoots: [],
            mcpRuntime,
            fixedMcpServers: [
              {
                id: "gmail",
                name: "Gmail",
                description: "Search and read email",
                server: {
                  transport: "streamable_http",
                  url: "https://gmail.example.test/mcp",
                },
              },
            ],
          },
          snapshot,
        );
        return {
          ...extensions,
          dispose: () => mcpRuntime.dispose(),
        };
      },
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "capability/list",
      params: { threadId },
    });
    const listed = result<{
      capabilities: Array<{ id: string; kind: string }>;
    }>(messages, 3);
    expect(listed.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skill", name: "documents" }),
        expect.objectContaining({ id: "mcp:gmail", kind: "mcp" }),
      ]),
    );
    const skillId = listed.capabilities.find(
      ({ kind }) => kind === "skill",
    )!.id;

    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/start",
      params: {
        threadId,
        input: "Create a launch brief from Gmail.",
        capabilityRefs: [skillId, "mcp:gmail"],
      },
    });
    await waitFor(messages, "turn/completed");

    expect(callTool).toHaveBeenCalledWith(
      "search",
      { query: "launch" },
      expect.any(AbortSignal),
    );
    expect(requests).toHaveLength(2);
    await server.dispose();
  });

  it("rejects capability references that are not available in the task", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const generate = vi.fn(async () => ({
      text: "unused",
      toolCalls: [],
    }));
    const server = new AppServer({
      loop: new AgentLoop({ generate }),
      agent: defineAgent({ name: "capabilities", instructions: "Base." }),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: {
        threadId,
        input: "Use Gmail.",
        capabilityRefs: ["mcp:gmail"],
      },
    });

    expect(response(messages, 3)).toMatchObject({
      error: {
        code: -32602,
        message: "Unknown capability: mcp:gmail",
      },
    });
    expect(generate).not.toHaveBeenCalled();
  });
});

function writeSkill(root: string): void {
  const directory = join(root, "documents");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    [
      "---",
      "name: documents",
      'description: "Create document artifacts when the user asks for a document."',
      "---",
      "",
      "DOCUMENT_WORKFLOW: create and verify the document.",
      "",
    ].join("\n"),
  );
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function response(messages: JsonRpcOutgoing[], id: number) {
  return messages.find(
    (message) => "id" in message && message.id === id,
  );
}

function result<T>(messages: JsonRpcOutgoing[], id: number): T {
  const message = response(messages, id);
  if (!message || !("result" in message)) {
    throw new Error(`Missing response ${id}`);
  }
  return message.result as T;
}

async function waitFor(
  messages: JsonRpcOutgoing[],
  method: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      messages.some(
        (message) => "method" in message && message.method === method,
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${method}`);
}
