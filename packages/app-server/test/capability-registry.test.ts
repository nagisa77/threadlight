import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
  it("previews capabilities for a new-task draft without creating a thread", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const dispose = vi.fn();
    const provider: ModelProvider = {
      async generate() {
        throw new Error("Capability preview must not call the model");
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "draft", instructions: "Base." }),
      threadRuntimeFactory: () => ({
        capabilities: [
          {
            id: "tool:plan",
            kind: "tool",
            name: "Plan",
            description: "Create a controlled plan.",
            visibility: "featured",
          },
          {
            id: "skill:documents",
            kind: "skill",
            name: "documents",
            description: "Create document artifacts.",
            visibility: "featured",
          },
        ],
        dispose,
      }),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "capability/list",
      params: {},
    });

    expect(
      result<{ capabilities: Array<{ id: string }> }>(messages, 2),
    ).toEqual({
      capabilities: [
        expect.objectContaining({ id: "tool:plan" }),
        expect.objectContaining({ id: "skill:documents" }),
      ],
    });
    expect(dispose).toHaveBeenCalledOnce();
    await server.dispose();
  });

  it("features repository and built-in skills while keeping user skills searchable", async () => {
    const root = temporaryDirectory("threadlight-capability-visibility-");
    const builtinSkills = join(root, "builtin-skills");
    const repoSkills = join(root, ".agents", "skills");
    const userSkills = join(root, "home", ".agents", "skills");
    writeSkill(
      builtinSkills,
      "skill-creator",
      "Create reusable skills.",
      "Create a focused skill.",
    );
    writeSkill(
      repoSkills,
      "repo-review",
      "Review this repository.",
      "Apply the repository review workflow.",
    );
    writeSkill(
      userSkills,
      "personal-helper",
      "Run a personal workflow.",
      "Apply the personal workflow.",
    );

    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [builtinSkills],
      repoSkillRoots: [repoSkills],
      userSkillRoots: [userSkills],
      pluginRoots: [],
    });

    expect(runtime.tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["skill_list", "skill_read"]),
    );
    expect(runtime.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "skill-creator",
          source: "builtin",
          icon: "skill-creator",
          visibility: "featured",
        }),
        expect.objectContaining({
          name: "repo-review",
          source: "repo",
          visibility: "featured",
        }),
        expect.objectContaining({
          name: "personal-helper",
          source: "user",
          visibility: "search",
        }),
      ]),
    );
  });

  it("reads only bundled resources from skills active in the current turn", async () => {
    const root = temporaryDirectory("threadlight-skill-resources-");
    const workspace = join(root, "workspace");
    const builtinSkills = join(root, "external-skills");
    mkdirSync(workspace, { recursive: true });
    writeSkill(
      builtinSkills,
      "pdf",
      "Create and verify PDF artifacts.",
      "Read references/tooling.md before choosing an implementation.",
    );
    const reference = join(
      builtinSkills,
      "pdf",
      "references",
      "tooling.md",
    );
    mkdirSync(join(builtinSkills, "pdf", "references"), {
      recursive: true,
    });
    writeFileSync(reference, "PDF_TOOLING_GUIDANCE\n");
    const declaredReference = realpathSync(reference);

    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain("Required skill read");
          expect(request.instructions).toContain(declaredReference);
          expect(request.tools.map(({ name }) => name)).toContain(
            "capability_resource_read",
          );
          return {
            text: "I’ll load the skill.",
            toolCalls: [
              {
                id: "skill-read-1",
                name: "skill_read",
                arguments: { skill: "pdf" },
              },
            ],
          };
        }
        if (requests.length === 2) {
          expect(request.toolResults?.[0]?.name).toBe("skill_read");
          return {
            text: "I’ll read the required guidance.",
            toolCalls: [
              {
                id: "resource-1",
                name: "capability_resource_read",
                arguments: { path: declaredReference },
              },
            ],
          };
        }
        if (requests.length === 3) {
          expect(request.toolResults?.[0]?.output).toContain(
            "PDF_TOOLING_GUIDANCE",
          );
          return {
            text: "I’ll verify the resource boundary.",
            toolCalls: [
              {
                id: "resource-2",
                name: "capability_resource_read",
                arguments: { path: join(root, "private.txt") },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]).toMatchObject({
          name: "capability_resource_read",
          isError: true,
          output: expect.stringContaining("not declared"),
        });
        return { text: "Done.", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "skill-resources", instructions: "Base." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(
          {
            workspaceRoot: workspace,
            userHome: join(root, "home"),
            builtinSkillRoots: [builtinSkills],
            repoSkillRoots: [],
            userSkillRoots: [],
            pluginRoots: [],
          },
          snapshot,
        ),
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
    const capabilities = result<{
      capabilities: Array<{ id: string; name: string }>;
    }>(messages, 3).capabilities;
    const pdf = capabilities.find(({ name }) => name === "pdf");
    expect(pdf).toBeDefined();

    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/start",
      params: {
        threadId,
        input: "Create a PDF.",
        capabilityRefs: [pdf!.id],
      },
    });
    await waitFor(messages, "turn/completed");

    expect(requests).toHaveLength(4);
    await server.dispose();
  });

  it("lists only explicitly allowlisted app tools and resolves them as emphasis prompts", async () => {
    const root = temporaryDirectory("threadlight-tool-capabilities-");
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [],
      mentionableTools: [
        {
          id: "plan",
          name: "Plan",
          description: "Create a controlled plan.",
          prompt: "PLAN_SELECTED",
          icon: "plan",
          visibility: "featured",
        },
      ],
    });

    expect(runtime.capabilities).toEqual([
      expect.objectContaining({
        id: "tool:plan",
        kind: "tool",
        icon: "plan",
      }),
    ]);
    expect(
      (await runtime.resolveCapabilities(
        ["tool:plan"],
        new AbortController().signal,
      )).promptBlocks[0]?.content,
    ).toBe("PLAN_SELECTED");
    expect(
      runtime.capabilities.some(({ id }) => id === "tool:exec_command"),
    ).toBe(false);
  });

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
          expect(request.instructions).toContain("Required skill read");
          expect(request.instructions).toContain("$documents");
          expect(request.instructions).not.toContain("DOCUMENT_WORKFLOW");
          expect(request.instructions).toContain(
            "explicitly selected the @Gmail MCP capability",
          );
          const gmailTool = request.tools.find(({ name }) =>
            name.startsWith("gmail__"),
          );
          expect(gmailTool).toMatchObject({
            description: "Search Gmail",
          });
          return {
            text: "I’ll load the skill and search Gmail.",
            toolCalls: [
              {
                id: "skill-read-1",
                name: "skill_read",
                arguments: { skill: "documents" },
              },
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
        expect(request.toolResults?.[1]?.output).toContain("mail result");
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
      capabilities: Array<{
        id: string;
        kind: string;
        source?: string;
        visibility?: string;
      }>;
    }>(messages, 3);
    expect(listed.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "skill", name: "documents" }),
        expect.objectContaining({ id: "mcp:gmail", kind: "tool" }),
      ]),
    );
    const skillId = listed.capabilities.find(
      ({ kind }) => kind === "skill",
    )!.id;
    expect(
      listed.capabilities.find(({ id }) => id === skillId),
    ).toMatchObject({ visibility: "featured", source: "repo" });

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

    const completed = messages.find(
      (message) =>
        "method" in message && message.method === "turn/completed",
    );
    expect(completed).toMatchObject({
      params: {
        capabilities: [
          {
            id: skillId,
            kind: "skill",
            name: "documents",
            source: "repo",
            icon: "skill",
          },
          {
            id: "mcp:gmail",
            kind: "tool",
            name: "Gmail",
            icon: "plugin",
          },
        ],
      },
    });

    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "thread/resume",
      params: { threadId },
    });
    const resumed = result<{
      messages: Array<{
        role: string;
        capabilityRefs?: string[];
        capabilities?: Array<{
          id: string;
          kind: string;
          name: string;
        }>;
      }>;
    }>(messages, 5);
    expect(resumed.messages[0]).toMatchObject({
      role: "user",
      capabilityRefs: [skillId, "mcp:gmail"],
      capabilities: [
        { id: skillId, kind: "skill", name: "documents" },
        { id: "mcp:gmail", kind: "tool", name: "Gmail" },
      ],
    });
    expect(resumed.messages[1]).toMatchObject({
      role: "assistant",
      capabilities: [
        { id: skillId, kind: "skill", name: "documents" },
        { id: "mcp:gmail", kind: "tool", name: "Gmail" },
      ],
    });

    expect(callTool).toHaveBeenCalledWith(
      "search",
      { query: "launch" },
      expect.any(AbortSignal),
    );
    expect(requests).toHaveLength(2);
    await server.dispose();
  });

  it("lets the model discover and activate Gmail tools within the same turn", async () => {
    const root = temporaryDirectory("threadlight-dynamic-capabilities-");
    const requests: ModelRequest[] = [];
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "latest mail result" }],
    }));
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.tools.map(({ name }) => name)).toEqual(
            expect.arrayContaining([
              "capability_list",
              "capability_activate",
            ]),
          );
          expect(
            request.tools.some(({ name }) => name.startsWith("gmail__")),
          ).toBe(false);
          return {
            text: "I’ll find the matching mailbox capability.",
            toolCalls: [
              {
                id: "capability-list-1",
                name: "capability_list",
                arguments: { query: "gmail" },
              },
            ],
            state: { step: 1 },
          };
        }
        if (requests.length === 2) {
          expect(request.state).toEqual({ step: 1 });
          expect(request.toolResults?.[0]?.output).toContain(
            '"id":"mcp:gmail"',
          );
          return {
            text: "I’ll activate Gmail.",
            toolCalls: [
              {
                id: "capability-activate-1",
                name: "capability_activate",
                arguments: { id: "mcp:gmail" },
              },
            ],
            state: { step: 2 },
          };
        }
        if (requests.length === 3) {
          expect(request.state).toEqual({ step: 2 });
          expect(request.instructions).toContain(
            "active for this turn after matching the user's request",
          );
          const gmailTool = request.tools.find(({ name }) =>
            name.startsWith("gmail__"),
          );
          expect(gmailTool).toBeDefined();
          return {
            text: "I’ll search the latest messages.",
            toolCalls: [
              {
                id: "gmail-search-1",
                name: gmailTool!.name,
                arguments: { query: "newer_than:7d" },
              },
            ],
            state: { step: 3 },
          };
        }
        expect(request.state).toEqual({ step: 3 });
        expect(request.toolResults?.[0]?.output).toContain(
          "latest mail result",
        );
        return {
          text: "Here is the latest mail.",
          toolCalls: [],
          state: { step: 4 },
        };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "dynamic-capabilities",
        instructions: "Base.",
      }),
      threadRuntimeFactory: async (snapshot) => {
        const mcpRuntime = new ConversationMcpRuntime({
          workspaceRoot: root,
          createConnectionId: () => "mcp-gmail-dynamic",
          connector: async () => ({
            listTools: async () => ({
              tools: [
                {
                  name: "search_threads",
                  description: "Search Gmail threads",
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
            instructions: () => "Search narrowly before reading.",
            close: async () => undefined,
          }),
        });
        const extensions = await createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            builtinSkillRoots: [],
            repoSkillRoots: [],
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
      method: "turn/start",
      params: {
        threadId,
        input: "帮我看看最新邮件",
      },
    });
    await waitFor(messages, "turn/completed");

    expect(callTool).toHaveBeenCalledWith(
      "search_threads",
      { query: "newer_than:7d" },
      expect.any(AbortSignal),
    );
    const completed = messages.find(
      (message) =>
        "method" in message && message.method === "turn/completed",
    );
    expect(completed).toMatchObject({
      params: {
        capabilities: [
          {
            id: "mcp:gmail",
            kind: "tool",
            name: "Gmail",
          },
        ],
      },
    });
    expect(requests).toHaveLength(4);
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

  it("routes connector configuration, authorization, and disconnect through task RPC", async () => {
    const messages: JsonRpcOutgoing[] = [];
    const status = {
      capabilityId: "mcp:gmail",
      connectorId: "gmail",
      name: "Gmail",
      status: "needs_configuration" as const,
      configured: false,
      authorized: false,
      redirectUrl:
        "http://127.0.0.1:43119/oauth/callback/gmail",
    };
    const configureConnector = vi.fn(async () => ({
      ...status,
      status: "needs_authorization" as const,
      configured: true,
    }));
    const authorizeConnector = vi.fn(async () => ({
      ...status,
      status: "ready" as const,
      configured: true,
      authorized: true,
    }));
    const disconnectConnector = vi.fn(async () => status);
    const server = new AppServer({
      loop: new AgentLoop({
        generate: async () => ({ text: "", toolCalls: [] }),
      }),
      agent: defineAgent({ name: "connectors", instructions: "Base." }),
      threadRuntimeFactory: async () => ({
        capabilities: [
          {
            id: "mcp:gmail",
            kind: "tool",
            name: "Gmail",
            description: "Search mail.",
          },
        ],
        connectorStatus: async () => status,
        configureConnector,
        authorizeConnector,
        disconnectConnector,
      }),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "connector/configure",
      params: {
        threadId,
        capabilityId: "mcp:gmail",
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
      },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 4,
      method: "connector/authorize",
      params: { threadId, capabilityId: "mcp:gmail" },
    });
    await server.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "connector/disconnect",
      params: { threadId, capabilityId: "mcp:gmail" },
    });

    expect(result<{ status: string }>(messages, 3).status).toBe(
      "needs_authorization",
    );
    expect(result<{ status: string }>(messages, 4).status).toBe("ready");
    expect(result<{ status: string }>(messages, 5).status).toBe(
      "needs_configuration",
    );
    expect(configureConnector).toHaveBeenCalledWith(
      "mcp:gmail",
      "fixture-client",
      "fixture-secret",
    );
    expect(authorizeConnector).toHaveBeenCalledWith(
      "mcp:gmail",
      expect.any(AbortSignal),
    );
    expect(disconnectConnector).toHaveBeenCalledWith("mcp:gmail");
    await server.dispose();
  });
});

function writeSkill(
  root: string,
  name = "documents",
  description = "Create document artifacts when the user asks for a document.",
  instructions = "DOCUMENT_WORKFLOW: create and verify the document.",
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
      instructions,
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
