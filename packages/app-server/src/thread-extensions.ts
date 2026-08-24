import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { ToolExecutionError, type Tool } from "@threadlight/agent-loop";
import {
  createMcpCapabilityTools,
  type ConversationMcpRuntime,
  type McpServerSpec,
} from "@threadlight/builtin-tools";
import type {
  CapabilityDescriptor,
  CapabilityStatus,
  ConnectorStatusData,
} from "@threadlight/protocol";

import {
  CapabilityRegistry,
  skillCapabilitySources,
  type CapabilityActivation,
  type CapabilityResolution,
  type CapabilitySource,
} from "./capability-registry.js";
import type { PromptBlock } from "./prompt-composer.js";
import {
  PluginRegistry,
  type PluginErrorGuidance,
  type PluginRegistrySnapshot,
  validatePluginRegistrySnapshot,
} from "./plugin-registry.js";
import { createSkillCreateTool } from "./skill-creator.js";
import {
  createSkillCapsuleTool,
  createSkillListTool,
  createSkillReadTool,
  SkillRegistry,
  type SkillRegistrySnapshot,
  type SkillSource,
  validateSkillRegistrySnapshot,
} from "./skill-registry.js";

export interface SkillPluginRuntimeSnapshot {
  version: 1;
  skills: SkillRegistrySnapshot;
  plugins: PluginRegistrySnapshot;
}

export interface SkillPluginRuntimeOptions {
  workspaceRoot: string;
  /** Durable project state root when the workspace is an isolated worktree. */
  projectStateRoot?: string;
  userHome?: string;
  builtinSkillRoots?: readonly string[];
  repoSkillRoots?: readonly string[];
  userSkillRoots?: readonly string[];
  pluginRoots?: readonly string[];
  mcpRuntime?: ConversationMcpRuntime;
  fixedMcpServers?: readonly FixedMcpServerCapability[];
  mentionableTools?: readonly MentionableToolCapability[];
  connections?: ConnectorConnectionManager;
}

export interface ConnectorConnectionManager {
  connectorStatus(
    connectorId: string,
    version: string,
  ): Promise<{
    configured: boolean;
    authorized: boolean;
  }>;
  configureConnector(
    connectorId: string,
    version: string,
    clientId: string,
    clientSecret: string,
  ): Promise<unknown>;
  disconnectConnector(connectorId: string, version: string): Promise<unknown>;
  connectorRedirectUrl(connectorId: string): string;
}

export interface FixedMcpServerCapability {
  id: string;
  name: string;
  description: string;
  server: McpServerSpec;
}

export interface MentionableToolCapability {
  id: string;
  name: string;
  description: string;
  prompt: string;
  icon: string;
  keywords?: readonly string[];
  visibility?: "featured" | "search" | "hidden";
}

export interface SkillPluginThreadRuntime {
  tools: Tool[];
  promptBlocks: readonly PromptBlock[];
  promptBlocksForTurn(input: string): readonly PromptBlock[];
  /** Capability refs (`skill:<id>`) for skills explicitly mentioned as $name in the input. */
  explicitSkillRefsForInput(input: string): readonly string[];
  capabilities: readonly CapabilityDescriptor[];
  resolveCapabilities(
    refs: readonly string[],
    signal: AbortSignal,
    activation?: CapabilityActivation,
  ): Promise<CapabilityResolution>;
  connectorStatus(capabilityId: string): Promise<ConnectorStatusData>;
  configureConnector(
    capabilityId: string,
    clientId: string,
    clientSecret: string,
  ): Promise<ConnectorStatusData>;
  authorizeConnector(
    capabilityId: string,
    signal: AbortSignal,
  ): Promise<ConnectorStatusData>;
  disconnectConnector(capabilityId: string): Promise<ConnectorStatusData>;
  refreshCapabilities(): Promise<void>;
  snapshot: SkillPluginRuntimeSnapshot;
}

export async function createSkillPluginThreadRuntime(
  options: SkillPluginRuntimeOptions,
  restoredSnapshot?: unknown,
): Promise<SkillPluginThreadRuntime> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const projectStateRoot = resolve(options.projectStateRoot ?? workspaceRoot);
  const userHome = resolve(options.userHome ?? homedir());
  let registry: SkillRegistry | undefined;
  let plugins: PluginRegistry;

  if (restoredSnapshot !== undefined) {
    validateSkillPluginRuntimeSnapshot(restoredSnapshot);
    registry = SkillRegistry.fromSnapshot(restoredSnapshot.skills);
    plugins = await PluginRegistry.fromSnapshot(restoredSnapshot.plugins);
  } else {
    plugins = await PluginRegistry.discover({
      roots: options.pluginRoots ?? [
        defaultBuiltinPluginRoot(),
        join(workspaceRoot, ".agents", "plugins"),
        join(projectStateRoot, ".threadlight", "plugins"),
        join(userHome, ".agents", "plugins"),
        join(userHome, ".threadlight", "plugins"),
      ],
    });
  }

  const sources: SkillSource[] = [
    ...(options.builtinSkillRoots ?? [defaultBuiltinSkillRoot()]).map(
      (root) => ({ scope: "builtin" as const, root }),
    ),
    ...(
      options.repoSkillRoots ?? [
        join(workspaceRoot, ".agents", "skills"),
        join(workspaceRoot, ".codex", "skills"),
      ]
    ).map((root) => ({ scope: "repo" as const, root })),
    ...(
      options.userSkillRoots ?? [
        join(userHome, ".agents", "skills"),
        join(userHome, ".codex", "skills"),
      ]
    ).map((root) => ({ scope: "user" as const, root })),
    ...plugins.skillSources(),
  ];
  if (!registry) {
    registry = await SkillRegistry.discover({ sources });
  }
  const snapshot: SkillPluginRuntimeSnapshot = {
    version: 1,
    skills: registry.snapshot(),
    plugins: plugins.snapshot(),
  };
  const promptBlocks: PromptBlock[] = [];
  const catalog = registry.catalogPrompt();
  if (catalog) {
    promptBlocks.push({
      id: "runtime.skill-catalog",
      version: 1,
      authority: "runtime",
      source: "skill-registry",
      content: catalog,
    });
  }
  if (plugins.plugins.length > 0 || plugins.warnings.length > 0) {
    promptBlocks.push({
      id: "runtime.plugins",
      version: 1,
      authority: "runtime",
      source: "plugin-registry",
      content: [
        "Installed plugins:",
        ...plugins.plugins.map(
          (plugin) =>
            `- ${plugin.name}@${plugin.version}: ${plugin.description}`,
        ),
        ...(plugins.warnings.length > 0
          ? [
              "Plugin discovery warnings:",
              ...plugins.warnings.map((warning) => `- ${warning}`),
            ]
          : []),
      ].join("\n"),
    });
  }
  const connectorSources = pluginMcpCapabilitySources(
    plugins,
    options.mcpRuntime,
  );
  const buildCapabilityRegistry = () => {
    const skillSources = skillCapabilitySources(registry, (pluginName) => {
      const plugin = plugins.plugins.find(({ name }) => name === pluginName);
      if (!plugin) return;
      const connectorRef =
        plugin.mcpServers.length === 1
          ? `mcp:${plugin.mcpServers[0]!.id}`
          : undefined;
      if (!plugin.presentation && !connectorRef) return;
      return {
        ...(plugin.presentation ?? {}),
        ...(plugin.mcpServers.length > 0
          ? { visibility: "search" as const }
          : {}),
        ...(connectorRef ? { connectorRef } : {}),
      };
    });
    return new CapabilityRegistry([
      ...linkPluginSkillConnectors(skillSources, connectorSources),
      ...connectorSources,
      ...mcpCapabilitySources(
        options.fixedMcpServers ?? [],
        options.mcpRuntime,
      ),
      ...mentionableToolCapabilitySources(options.mentionableTools ?? []),
    ]);
  };
  let capabilityRegistry = buildCapabilityRegistry();
  const connectors = new PluginConnectorController({
    plugins,
    sources: connectorSources,
    mcpRuntime: options.mcpRuntime,
    connections: options.connections,
  });
  await connectors.refreshAll();

  return {
    tools: [
      createSkillListTool(registry),
      createSkillReadTool(registry),
      createSkillCapsuleTool(registry),
      createSkillCreateTool({
        project: join(workspaceRoot, ".agents", "skills"),
        user: join(userHome, ".agents", "skills"),
      }),
    ],
    promptBlocks,
    promptBlocksForTurn(input) {
      return registry.promptBlocksForExplicitMentions(input);
    },
    explicitSkillRefsForInput(input) {
      return registry.refsForExplicitMentions(input);
    },
    get capabilities() {
      return capabilityRegistry.descriptors();
    },
    resolveCapabilities(refs, signal, activation) {
      return capabilityRegistry.resolve(refs, signal, activation);
    },
    connectorStatus(capabilityId) {
      return connectors.status(capabilityId);
    },
    configureConnector(capabilityId, clientId, clientSecret) {
      return connectors.configure(capabilityId, clientId, clientSecret);
    },
    authorizeConnector(capabilityId, signal) {
      return connectors.authorize(capabilityId, signal);
    },
    disconnectConnector(capabilityId) {
      return connectors.disconnect(capabilityId);
    },
    async refreshCapabilities() {
      registry.replaceWith(await SkillRegistry.discover({ sources }));
      capabilityRegistry = buildCapabilityRegistry();
      snapshot.skills = registry.snapshot();
    },
    snapshot,
  };
}

export function validateSkillPluginRuntimeSnapshot(
  value: unknown,
): asserts value is SkillPluginRuntimeSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Skill/plugin runtime snapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1) {
    throw new Error("Skill/plugin runtime snapshot has an unsupported format");
  }
  validateSkillRegistrySnapshot(snapshot.skills);
  validatePluginRegistrySnapshot(snapshot.plugins);
}

export function defaultBuiltinSkillRoot(): string {
  return fileURLToPath(new URL("./builtin-skills", import.meta.url));
}

export function defaultBuiltinPluginRoot(): string {
  return fileURLToPath(new URL("./builtin-plugins", import.meta.url));
}

function pluginMcpCapabilitySources(
  plugins: PluginRegistry,
  runtime: ConversationMcpRuntime | undefined,
): CapabilitySource[] {
  return plugins.mcpServers().map(({ plugin, server }) => {
    const configured = Boolean(server.url);
    return {
      descriptor: {
        id: `mcp:${server.id}`,
        kind: "tool",
        name: server.name,
        description: server.description,
        source: plugin.name,
        icon:
          server.presentation?.icon ?? plugin.presentation?.icon ?? "plugin",
        visibility:
          server.presentation?.visibility ??
          plugin.presentation?.visibility ??
          "search",
        keywords:
          server.presentation?.keywords ?? plugin.presentation?.keywords,
        status: configured ? "ready" : "needs_configuration",
      },
      async resolve(signal, activation = "explicit") {
        if (!server.url) {
          throw new Error(
            `${server.name} requires ${server.urlEnv ?? "an MCP URL"} before it can be used`,
          );
        }
        if (!runtime) {
          throw new Error(`${server.name} MCP runtime is unavailable`);
        }
        const connection = await runtime.connect(
          pluginServerSpec(server),
          signal,
        );
        return {
          promptBlocks: [
            {
              id: `runtime.capability.mcp.${server.id}`,
              version: 1,
              authority: "runtime",
              source: plugin.name,
              content: [
                activation === "explicit"
                  ? `The user explicitly selected @${server.name} for this turn.`
                  : `The @${server.name} capability is active for this turn after matching the user's request.`,
                connection.instructions,
              ]
                .filter(Boolean)
                .join("\n\n"),
            },
          ],
          tools: applyPluginErrorGuidance(
            createMcpCapabilityTools(runtime, server.id, connection),
            server.errorGuidance,
          ),
          resources: [],
        };
      },
    };
  });
}

function applyPluginErrorGuidance(
  tools: readonly Tool[],
  guidance: readonly PluginErrorGuidance[] | undefined,
): Tool[] {
  if (!guidance?.length) return [...tools];
  return tools.map((tool) => ({
    ...tool,
    async execute(arguments_, context) {
      try {
        return await tool.execute(arguments_, context);
      } catch (error) {
        const original = error instanceof Error ? error.message : String(error);
        const match = guidance.find(({ includes }) =>
          original.includes(includes),
        );
        if (!match) throw error;
        const message = [
          match.message,
          match.helpUrl ? `Help: ${match.helpUrl}` : "",
          `Remote error: ${original}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        throw new ToolExecutionError(message, {
          code: match.code,
          retryable: match.retryable,
          ...(match.helpUrl
            ? {
                userAction: {
                  kind: "open_url",
                  data: { url: match.helpUrl },
                },
              }
            : {}),
        });
      }
    },
  }));
}

function linkPluginSkillConnectors(
  skills: readonly CapabilitySource[],
  connectors: readonly CapabilitySource[],
): CapabilitySource[] {
  const connectorsById = new Map(
    connectors.map((source) => [source.descriptor.id, source]),
  );
  return skills.map((skill) => {
    const connectorRef = skill.descriptor.connectorRef;
    if (!connectorRef) return skill;
    const connector = connectorsById.get(connectorRef);
    if (!connector) {
      throw new Error(
        `${skill.descriptor.name} references an unavailable connector: ${connectorRef}`,
      );
    }
    return {
      ...skill,
      async resolve(signal, activation = "explicit") {
        const [skillResolution, connectorResolution] = await Promise.all([
          skill.resolve(signal, activation),
          connector.resolve(signal, activation),
        ]);
        return {
          promptBlocks: [
            ...skillResolution.promptBlocks,
            ...connectorResolution.promptBlocks,
          ],
          tools: [...skillResolution.tools, ...connectorResolution.tools],
          resources: [
            ...(skillResolution.resources ?? []),
            ...(connectorResolution.resources ?? []),
          ],
        };
      },
    };
  });
}

class PluginConnectorController {
  private readonly byCapabilityId: ReadonlyMap<
    string,
    {
      source: CapabilitySource;
      plugin: PluginRegistry["plugins"][number];
      server: ReturnType<PluginRegistry["mcpServers"]>[number]["server"];
    }
  >;

  constructor(
    private readonly options: {
      plugins: PluginRegistry;
      sources: readonly CapabilitySource[];
      mcpRuntime?: ConversationMcpRuntime;
      connections?: ConnectorConnectionManager;
    },
  ) {
    const sources = new Map(
      options.sources.map((source) => [source.descriptor.id, source]),
    );
    this.byCapabilityId = new Map(
      options.plugins.mcpServers().map(({ plugin, server }) => {
        const capabilityId = `mcp:${server.id}`;
        return [
          capabilityId,
          {
            plugin,
            server,
            source: sources.get(capabilityId)!,
          },
        ];
      }),
    );
  }

  async refreshAll(): Promise<void> {
    await Promise.all(
      [...this.byCapabilityId.keys()].map((capabilityId) =>
        this.status(capabilityId),
      ),
    );
  }

  async status(capabilityId: string): Promise<ConnectorStatusData> {
    const connector = this.require(capabilityId);
    const connection = await this.connectionStatus(connector.server);
    const status = connectorStatus(
      connector.server,
      connection.configured,
      connection.authorized,
    );
    connector.source.descriptor.status = status;
    return {
      capabilityId,
      connectorId: connector.server.id,
      name: connector.server.name,
      status,
      configured: connection.configured,
      authorized: connection.authorized,
      redirectUrl:
        this.options.connections?.connectorRedirectUrl(connector.server.id) ??
        "",
    };
  }

  async configure(
    capabilityId: string,
    clientId: string,
    clientSecret: string,
  ): Promise<ConnectorStatusData> {
    const connector = this.require(capabilityId);
    if (!connector.server.oauth?.clientSecretRequired) {
      throw new Error(
        `${connector.server.name} does not accept manual OAuth credentials`,
      );
    }
    const connections = this.requireConnections(connector.server.name);
    await this.options.mcpRuntime?.disconnect(
      pluginServerSpec(connector.server),
    );
    await connections.configureConnector(
      connector.server.id,
      connector.server.version,
      requireCredential(clientId, "clientId"),
      requireCredential(clientSecret, "clientSecret"),
    );
    return this.status(capabilityId);
  }

  async authorize(
    capabilityId: string,
    signal: AbortSignal,
  ): Promise<ConnectorStatusData> {
    const connector = this.require(capabilityId);
    if (!connector.server.url) {
      throw new Error(`${connector.server.name} has no MCP server URL`);
    }
    if (!this.options.mcpRuntime) {
      throw new Error(`${connector.server.name} MCP runtime is unavailable`);
    }
    const before = await this.status(capabilityId);
    if (before.status === "needs_configuration") {
      throw new Error(
        `${connector.server.name} requires OAuth client credentials`,
      );
    }
    await this.options.mcpRuntime.authorize(
      pluginServerSpec(connector.server),
      signal,
    );
    return this.status(capabilityId);
  }

  async disconnect(capabilityId: string): Promise<ConnectorStatusData> {
    const connector = this.require(capabilityId);
    await this.options.mcpRuntime?.disconnect(
      pluginServerSpec(connector.server),
    );
    await this.requireConnections(connector.server.name).disconnectConnector(
      connector.server.id,
      connector.server.version,
    );
    return this.status(capabilityId);
  }

  private async connectionStatus(
    server: ReturnType<PluginRegistry["mcpServers"]>[number]["server"],
  ): Promise<{ configured: boolean; authorized: boolean }> {
    if (!server.oauth) {
      return { configured: true, authorized: true };
    }
    if (server.oauth.clientId && !server.oauth.clientSecretRequired) {
      return { configured: true, authorized: false };
    }
    if (!this.options.connections) {
      return { configured: false, authorized: false };
    }
    return this.options.connections.connectorStatus(server.id, server.version);
  }

  private require(capabilityId: string) {
    const connector = this.byCapabilityId.get(capabilityId);
    if (!connector) {
      throw new Error(`Unknown connector capability: ${capabilityId}`);
    }
    return connector;
  }

  private requireConnections(name: string): ConnectorConnectionManager {
    if (!this.options.connections) {
      throw new Error(`${name} desktop connection service is unavailable`);
    }
    return this.options.connections;
  }
}

function pluginServerSpec(
  server: ReturnType<PluginRegistry["mcpServers"]>[number]["server"],
): McpServerSpec {
  if (!server.url) {
    throw new Error(
      `${server.name} requires ${server.urlEnv ?? "an MCP URL"} before it can be used`,
    );
  }
  return {
    transport: "streamable_http",
    url: server.url,
    ...(server.oauth
      ? {
          oauth: {
            connectorId: server.id,
            version: server.version,
            ...(server.oauth.clientId
              ? { clientId: server.oauth.clientId }
              : {}),
            ...(server.oauth.clientSecretRequired !== undefined
              ? {
                  clientSecretRequired: server.oauth.clientSecretRequired,
                }
              : {}),
            ...(server.oauth.scopes ? { scopes: server.oauth.scopes } : {}),
          },
        }
      : {}),
  };
}

function connectorStatus(
  server: ReturnType<PluginRegistry["mcpServers"]>[number]["server"],
  configured: boolean,
  authorized: boolean,
): CapabilityStatus {
  if (!server.url || (server.oauth?.clientSecretRequired && !configured)) {
    return "needs_configuration";
  }
  if (server.oauth && !authorized) return "needs_authorization";
  return "ready";
}

function requireCredential(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function mcpCapabilitySources(
  capabilities: readonly FixedMcpServerCapability[],
  runtime: ConversationMcpRuntime | undefined,
): CapabilitySource[] {
  if (capabilities.length > 0 && !runtime) {
    throw new Error("Fixed MCP capabilities require an MCP runtime");
  }
  return capabilities.map((capability) => {
    validateFixedMcpCapability(capability);
    return {
      descriptor: {
        id: `mcp:${capability.id}`,
        kind: "tool",
        name: capability.name,
        description: capability.description,
        source: "fixed",
        icon: "plugin",
        visibility: "search",
        status: "ready",
      },
      async resolve(signal, activation = "explicit") {
        const connection = await runtime!.connect(capability.server, signal);
        const instructions = [
          activation === "explicit"
            ? `The user explicitly selected the @${capability.name} MCP capability for this turn.`
            : `The @${capability.name} MCP capability is active for this turn after matching the user's request.`,
          connection.instructions,
        ]
          .filter(Boolean)
          .join("\n\n");
        return {
          promptBlocks: [
            {
              id: `runtime.capability.mcp.${capability.id}`,
              version: 1,
              authority: "runtime",
              source: capability.id,
              content: instructions,
            },
          ],
          tools: createMcpCapabilityTools(runtime!, capability.id, connection),
          resources: [],
        };
      },
    };
  });
}

function mentionableToolCapabilitySources(
  tools: readonly MentionableToolCapability[],
): CapabilitySource[] {
  return tools.map((tool) => ({
    descriptor: {
      id: `tool:${tool.id}`,
      kind: "tool",
      name: tool.name,
      description: tool.description,
      source: "threadlight",
      icon: tool.icon,
      visibility: tool.visibility ?? "search",
      ...(tool.keywords ? { keywords: tool.keywords } : {}),
      status: "ready",
    },
    resolve() {
      return {
        promptBlocks: [
          {
            id: `runtime.capability.tool.${tool.id}`,
            version: 1,
            authority: "runtime",
            source: tool.id,
            content: tool.prompt,
          },
        ],
        tools: [],
        resources: [],
      };
    },
  }));
}

function validateFixedMcpCapability(
  capability: FixedMcpServerCapability,
): void {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability.id) ||
    capability.id.length > 64 ||
    !capability.name.trim() ||
    !capability.description.trim()
  ) {
    throw new Error("Fixed MCP capability is invalid");
  }
}
