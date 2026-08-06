import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  AgentLoop,
  defineAgent,
  type AgentEvent,
  type ModelRequest,
} from "@threadlight/agent-loop";
import { ConversationMcpRuntime } from "@threadlight/builtin-tools";

import { PluginRegistry } from "../src/plugin-registry.js";
import {
  createSkillPluginThreadRuntime,
  defaultBuiltinPluginRoot,
} from "../src/thread-extensions.js";

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("plugins", () => {
  it("ships artifact skills and Gmail as distinct built-in plugins", async () => {
    const registry = await PluginRegistry.discover({
      roots: [defaultBuiltinPluginRoot()],
      environment: {},
    });
    expect(registry.plugins.map(({ name }) => name)).toEqual([
      "documents",
      "excel",
      "gmail",
      "pdf",
      "powerpoint",
    ]);
    const gmail = registry.mcpServers().find(
      ({ server }) => server.id === "gmail",
    );
    expect(gmail?.server).toMatchObject({
      name: "Gmail",
      url: "https://gmailmcp.googleapis.com/mcp/v1",
      oauth: {
        clientSecretRequired: true,
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
        ],
      },
      errorGuidance: [
        expect.objectContaining({
          includes: "The caller does not have permission",
          code: "gmail_mcp_project_permission_required",
          retryable: false,
          helpUrl: "https://developers.google.com/workspace/preview",
        }),
      ],
    });
  });

  it("gives the model and user plugin-owned guidance for Gmail project permission failures", async () => {
    const root = temporaryDirectory("threadlight-gmail-guidance-");
    const mcpRuntime = new ConversationMcpRuntime({
      workspaceRoot: root,
      createConnectionId: () => "mcp-gmail-guidance",
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
        callTool: async () => ({
          isError: true,
          content: [
            {
              type: "text",
              text: "The caller does not have permission",
            },
          ],
        }),
        serverInfo: () => ({ name: "gmail", version: "1.0.0" }),
        instructions: () => undefined,
        close: async () => undefined,
      }),
    });
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [defaultBuiltinPluginRoot()],
      mcpRuntime,
    });
    const resolved = await runtime.resolveCapabilities(
      ["mcp:gmail"],
      new AbortController().signal,
      "implicit",
    );
    const gmailTool = resolved.tools.find(({ name }) =>
      name.startsWith("gmail__"),
    );
    expect(gmailTool).toBeDefined();

    const requests: ModelRequest[] = [];
    const events: AgentEvent[] = [];
    const result = await new AgentLoop({
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I’ll search Gmail.",
            toolCalls: [
              {
                id: "gmail-search-1",
                name: gmailTool!.name,
                arguments: { query: "newer_than:7d" },
              },
            ],
          };
        }
        const failure = request.toolResults?.[0];
        expect(failure).toMatchObject({
          name: gmailTool!.name,
          isError: true,
          error: {
            code: "gmail_mcp_project_permission_required",
            retryable: false,
            userAction: {
              kind: "open_url",
              data: {
                url: "https://developers.google.com/workspace/preview",
              },
            },
          },
        });
        expect(failure?.output).toContain(
          "Do not retry Gmail tools yet",
        );
        expect(failure?.output).toContain(
          "Google Workspace Developer Preview Program",
        );
        expect(failure?.output).toContain(
          "Remote error: The caller does not have permission",
        );
        return {
          text: "Gmail needs project-level preview access before I can retry.",
          toolCalls: [],
        };
      },
    }).run(
      defineAgent({
        name: "gmail-guidance",
        instructions: "Use Gmail when asked.",
        tools: resolved.tools,
      }),
      "Check my latest mail",
      {
        onEvent: (event) => events.push(event),
      },
    );

    expect(result.output).toBe(
      "Gmail needs project-level preview access before I can retry.",
    );
    expect(
      events.find(
        (event) =>
          event.type === "tool.completed" &&
          event.result.callId === "gmail-search-1",
      ),
    ).toMatchObject({
      type: "tool.completed",
      result: {
        isError: true,
        output: expect.stringContaining(
          "After Google confirms access, disconnect and reconnect Gmail",
        ),
      },
    });
    await mcpRuntime.dispose();
  });

  it("moves Gmail from configuration through authorization without exposing credentials", async () => {
    const root = temporaryDirectory("threadlight-gmail-connection-");
    let configured = false;
    let authorized = false;
    const configureConnector = vi.fn(async () => {
      configured = true;
    });
    const connector = vi.fn(async (spec) => {
      expect(spec).toMatchObject({
        transport: "streamable_http",
        url: "https://gmailmcp.googleapis.com/mcp/v1",
        oauth: {
          connectorId: "gmail",
          clientSecretRequired: true,
        },
      });
      return {
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({}),
        serverInfo: () => ({ name: "gmail", version: "1.0.0" }),
        instructions: () => undefined,
        close: async () => undefined,
      };
    });
    let codeVerifier = "";
    const redirectToAuthorization = vi.fn(async () => undefined);
    const saveTokens = vi.fn(async () => {
      authorized = true;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input
              : input.url,
        );
        if (url.pathname.includes(".well-known/oauth-protected-resource")) {
          return Response.json({
            resource: "https://gmailmcp.googleapis.com/mcp/v1",
            authorization_servers: ["https://accounts.google.com/"],
            scopes_supported: [
              "https://mail.google.com/",
              "https://www.googleapis.com/auth/gmail.modify",
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/gmail.compose",
              "https://www.googleapis.com/auth/gmail.metadata",
            ],
          });
        }
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return Response.json({
            issuer: "https://accounts.google.com/",
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_post"],
          });
        }
        if (url.href === "https://oauth2.googleapis.com/token") {
          return Response.json({
            access_token: "fixture-access-token",
            refresh_token: "fixture-refresh-token",
            token_type: "Bearer",
          });
        }
        throw new Error(`Unexpected OAuth request: ${url}`);
      }),
    );
    const mcpRuntime = new ConversationMcpRuntime({
      connector,
      oauthProviderFactory: () => ({
        redirectUrl: "http://127.0.0.1:43119/oauth/callback/gmail",
        clientMetadata: {
          redirect_uris: [
            "http://127.0.0.1:43119/oauth/callback/gmail",
          ],
          client_name: "Threadlight",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post",
        },
        state: async () => "fixture-state",
        clientInformation: async () => ({
          client_id: "fixture-client-id",
          client_secret: "fixture-client-secret",
        }),
        tokens: async () => undefined,
        saveTokens,
        redirectToAuthorization,
        saveCodeVerifier: async (value) => {
          codeVerifier = value;
        },
        codeVerifier: async () => codeVerifier,
        waitForAuthorizationCode: async () => "fixture-code",
      }),
    });
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [defaultBuiltinPluginRoot()],
      mcpRuntime,
      connections: {
        connectorStatus: async () => ({ configured, authorized }),
        configureConnector,
        disconnectConnector: async () => {
          configured = false;
          authorized = false;
        },
        connectorRedirectUrl: (id) =>
          `http://127.0.0.1:43119/oauth/callback/${id}`,
      },
    });

    await expect(runtime.connectorStatus("mcp:gmail")).resolves.toMatchObject({
      status: "needs_configuration",
      configured: false,
    });
    await expect(
      runtime.configureConnector(
        "mcp:gmail",
        "fixture-client-id",
        "fixture-client-secret",
      ),
    ).resolves.toMatchObject({
      status: "needs_authorization",
      configured: true,
    });
    expect(
      runtime.capabilities.find(({ id }) => id === "mcp:gmail")?.status,
    ).toBe("needs_authorization");
    expect(configureConnector).toHaveBeenCalledWith(
      "gmail",
      "1.1.0",
      "fixture-client-id",
      "fixture-client-secret",
    );
    await expect(
      runtime.authorizeConnector(
        "mcp:gmail",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "ready",
      authorized: true,
    });
    expect(
      runtime.capabilities.find(({ id }) => id === "mcp:gmail")?.status,
    ).toBe("ready");
    expect(redirectToAuthorization).toHaveBeenCalledOnce();
    expect(
      redirectToAuthorization.mock.calls[0]?.[0].searchParams.get("state"),
    ).toBe("fixture-state");
    expect(
      redirectToAuthorization.mock.calls[0]?.[0].searchParams.get("scope"),
    ).toBe(
      [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
      ].join(" "),
    );
    expect(saveTokens).toHaveBeenCalledOnce();
    const gmailSkill = runtime.capabilities.find(
      ({ kind, connectorRef }) =>
        kind === "skill" && connectorRef === "mcp:gmail",
    );
    expect(gmailSkill).toMatchObject({
      name: "Gmail",
      connectorRef: "mcp:gmail",
    });
    const gmailSkillResolution = await runtime.resolveCapabilities(
      [gmailSkill!.id],
      new AbortController().signal,
    );
    expect(
      gmailSkillResolution.promptBlocks.map(({ id }) => id),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^skill\./),
        "runtime.capability.mcp.gmail",
      ]),
    );
    expect(connector).toHaveBeenCalledOnce();
    await mcpRuntime.dispose();
  });

  it("ships full artifact skill references for progressive disclosure", async () => {
    const root = temporaryDirectory("threadlight-builtin-skill-resources-");
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [defaultBuiltinPluginRoot()],
    });
    const documents = runtime.snapshot.skills.skills.find(
      ({ invocationName }) => invocationName === "documents:documents",
    );
    const pdf = runtime.snapshot.skills.skills.find(
      ({ invocationName }) => invocationName === "pdf:pdf",
    );
    const excel = runtime.snapshot.skills.skills.find(
      ({ invocationName }) => invocationName === "excel:excel",
    );
    const powerpoint = runtime.snapshot.skills.skills.find(
      ({ invocationName }) => invocationName === "powerpoint:powerpoint",
    );

    expect(documents?.resources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/documents\/references\/tooling\.md$/),
        expect.stringMatching(/documents\/references\/quality-checks\.md$/),
      ]),
    );
    expect(pdf?.resources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/pdf\/references\/tooling\.md$/),
        expect.stringMatching(/pdf\/references\/quality-checks\.md$/),
      ]),
    );
    expect(excel?.resources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/excel\/references\/tooling\.md$/),
        expect.stringMatching(/excel\/references\/quality-checks\.md$/),
      ]),
    );
    expect(powerpoint?.resources).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/powerpoint\/references\/tooling\.md$/),
        expect.stringMatching(
          /powerpoint\/references\/quality-checks\.md$/,
        ),
      ]),
    );
  });

  it("injects Excel and PowerPoint workflows into an offline scripted turn", async () => {
    const root = temporaryDirectory("threadlight-office-skills-");
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [defaultBuiltinPluginRoot()],
    });
    const excel = runtime.capabilities.find(
      ({ kind, name }) => kind === "skill" && name === "Excel",
    );
    const powerpoint = runtime.capabilities.find(
      ({ kind, name }) => kind === "skill" && name === "PowerPoint",
    );

    expect(excel).toMatchObject({
      icon: "excel",
      visibility: "featured",
    });
    expect(powerpoint).toMatchObject({
      icon: "powerpoint",
      visibility: "featured",
    });

    const resolved = await runtime.resolveCapabilities(
      [excel!.id, powerpoint!.id],
      new AbortController().signal,
    );
    const requests: ModelRequest[] = [];
    const result = await new AgentLoop({
      async generate(request) {
        requests.push(request);
        expect(request.instructions).toContain("Required skill read");
        expect(request.instructions).toContain("$excel");
        expect(request.instructions).toContain("$powerpoint");
        expect(request.instructions).not.toContain(
          "Do not replace formulas with cached values",
        );
        expect(request.instructions).not.toContain(
          "Treat slides as a visual narrative",
        );
        return {
          text: "The workbook and deck workflows are loaded.",
          toolCalls: [],
        };
      },
    }).run(
      defineAgent({
        name: "office-artifacts",
        instructions: resolved.promptBlocks
          .map(({ content }) => content)
          .join("\n\n"),
      }),
      "Create an Excel model and a PowerPoint deck.",
    );

    expect(result.output).toBe(
      "The workbook and deck workflows are loaded.",
    );
    expect(requests).toHaveLength(1);
  });

  it("loads plugin skills with a plugin namespace", async () => {
    const root = temporaryDirectory("threadlight-plugin-");
    writePlugin(root, {
      name: "release-tools",
      version: "1.2.0",
      description: "Reusable release workflows.",
      skillName: "prepare-release",
      skillDescription: "Prepare a release when the user asks to ship a build.",
      instructions: "Run release validation and summarize blockers.",
    });

    const plugins = await PluginRegistry.discover({ roots: [root] });
    expect(plugins.plugins).toMatchObject([
      {
        name: "release-tools",
        version: "1.2.0",
      },
    ]);
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [root],
    });

    expect(runtime.snapshot.skills.skills).toMatchObject([
      {
        name: "prepare-release",
        invocationName: "release-tools:prepare-release",
        scope: "plugin",
        plugin: {
          name: "release-tools",
          version: "1.2.0",
        },
      },
    ]);
    expect(runtime.promptBlocks.map((block) => block.content).join("\n"))
      .toContain("$release-tools:prepare-release");
    const explicitBlock = runtime.promptBlocksForTurn(
      "Use $release-tools:prepare-release for this build.",
    )[0]?.content;
    expect(explicitBlock).toContain("Required skill read");
    expect(explicitBlock).toContain("$release-tools:prepare-release");
    expect(explicitBlock).not.toContain("Run release validation");
  });

  it("loads Streamable HTTP MCP connectors without persisting endpoints or credentials in the snapshot", async () => {
    const root = temporaryDirectory("threadlight-plugin-connected-");
    const pluginRoot = writePlugin(root, {
      name: "connected-plugin",
      version: "1.0.0",
      description: "Connected tools.",
      skillName: "connected-workflow",
      skillDescription: "Use a connected workflow.",
      instructions: "Call a connector.",
    });
    const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          name: "connected-plugin",
          version: "1.0.0",
          description: "Connected tools.",
          skills: "./skills/",
          mcpServers: "./.mcp.json",
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(pluginRoot, ".mcp.json"),
      `${JSON.stringify(
        {
          servers: [
            {
              id: "gmail",
              version: "2.1.0",
              name: "Gmail",
              description: "Search mail.",
              transport: "streamable_http",
              urlEnv: "TEST_GMAIL_MCP_URL",
              oauth: {
                clientIdEnv: "TEST_GMAIL_CLIENT_ID",
                scopes: ["mail.read"],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const registry = await PluginRegistry.discover({
      roots: [root],
      environment: {
        TEST_GMAIL_MCP_URL: "https://mail.example.test/mcp",
        TEST_GMAIL_CLIENT_ID: "desktop-client",
      },
    });
    expect(registry.mcpServers()).toMatchObject([
      {
        server: {
          id: "gmail",
          url: "https://mail.example.test/mcp",
          oauth: {
            clientId: "desktop-client",
            scopes: ["mail.read"],
          },
        },
      },
    ]);
    const serialized = JSON.stringify(registry.snapshot());
    expect(serialized).toContain('"id":"gmail"');
    expect(serialized).toContain('"version":"2.1.0"');
    expect(serialized).not.toContain("mail.example.test");
    expect(serialized).not.toContain("desktop-client");
  });
});

function writePlugin(
  root: string,
  options: {
    name: string;
    version: string;
    description: string;
    skillName: string;
    skillDescription: string;
    instructions: string;
  },
): string {
  const pluginRoot = join(root, options.name);
  const manifestDirectory = join(pluginRoot, ".codex-plugin");
  const skillDirectory = join(pluginRoot, "skills", options.skillName);
  mkdirSync(manifestDirectory, { recursive: true });
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(
    join(manifestDirectory, "plugin.json"),
    `${JSON.stringify(
      {
        name: options.name,
        version: options.version,
        description: options.description,
        skills: "./skills/",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(skillDirectory, "SKILL.md"),
    [
      "---",
      `name: ${options.skillName}`,
      `description: ${JSON.stringify(options.skillDescription)}`,
      "---",
      "",
      options.instructions,
      "",
    ].join("\n"),
  );
  return pluginRoot;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
