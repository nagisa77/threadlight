import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import {
  createMcpCapabilityTools,
  type ConversationMcpRuntime,
  type McpServerSpec,
} from "@threadlight/builtin-tools";
import type { CapabilityDescriptor } from "@threadlight/protocol";

import {
  CapabilityRegistry,
  skillCapabilitySources,
  type CapabilityResolution,
  type CapabilitySource,
} from "./capability-registry.js";
import type { PromptBlock } from "./prompt-composer.js";
import {
  SkillsOnlyPluginRegistry,
  type PluginRegistrySnapshot,
  validatePluginRegistrySnapshot,
} from "./plugin-registry.js";
import { createSkillCreateTool } from "./skill-creator.js";
import {
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
  userHome?: string;
  builtinSkillRoots?: readonly string[];
  repoSkillRoots?: readonly string[];
  userSkillRoots?: readonly string[];
  pluginRoots?: readonly string[];
  mcpRuntime?: ConversationMcpRuntime;
  fixedMcpServers?: readonly FixedMcpServerCapability[];
}

export interface FixedMcpServerCapability {
  id: string;
  name: string;
  description: string;
  server: McpServerSpec;
}

export interface SkillPluginThreadRuntime {
  tools: ReturnType<typeof createSkillReadTool>[];
  promptBlocks: readonly PromptBlock[];
  promptBlocksForTurn(input: string): readonly PromptBlock[];
  capabilities: readonly CapabilityDescriptor[];
  resolveCapabilities(
    refs: readonly string[],
    signal: AbortSignal,
  ): Promise<CapabilityResolution>;
  snapshot: SkillPluginRuntimeSnapshot;
}

export async function createSkillPluginThreadRuntime(
  options: SkillPluginRuntimeOptions,
  restoredSnapshot?: unknown,
): Promise<SkillPluginThreadRuntime> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const userHome = resolve(options.userHome ?? homedir());
  let registry: SkillRegistry;
  let plugins: SkillsOnlyPluginRegistry;

  if (restoredSnapshot !== undefined) {
    validateSkillPluginRuntimeSnapshot(restoredSnapshot);
    registry = SkillRegistry.fromSnapshot(restoredSnapshot.skills);
    plugins = SkillsOnlyPluginRegistry.fromSnapshot(restoredSnapshot.plugins);
  } else {
    plugins = await SkillsOnlyPluginRegistry.discover({
      roots:
        options.pluginRoots ??
        [
          join(workspaceRoot, ".agents", "plugins"),
          join(workspaceRoot, ".threadlight", "plugins"),
          join(userHome, ".agents", "plugins"),
          join(userHome, ".threadlight", "plugins"),
        ],
    });
    const sources: SkillSource[] = [
      ...(options.builtinSkillRoots ?? [defaultBuiltinSkillRoot()]).map(
        (root) => ({ scope: "builtin" as const, root }),
      ),
      ...(options.repoSkillRoots ?? [
        join(workspaceRoot, ".agents", "skills"),
      ]).map((root) => ({ scope: "repo" as const, root })),
      ...(options.userSkillRoots ?? [
        join(userHome, ".agents", "skills"),
      ]).map((root) => ({ scope: "user" as const, root })),
      ...plugins.skillSources(),
    ];
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
      id: "runtime.skills-only-plugins",
      version: 1,
      authority: "runtime",
      source: "plugin-registry",
      content: [
        "Installed skills-only plugins:",
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
  const capabilityRegistry = new CapabilityRegistry([
    ...skillCapabilitySources(registry),
    ...mcpCapabilitySources(
      options.fixedMcpServers ?? [],
      options.mcpRuntime,
    ),
  ]);

  return {
    tools: [
      createSkillReadTool(registry),
      createSkillCreateTool({
        project: join(workspaceRoot, ".agents", "skills"),
        user: join(userHome, ".agents", "skills"),
      }),
    ],
    promptBlocks,
    promptBlocksForTurn(input) {
      return registry.promptBlocksForExplicitMentions(input);
    },
    capabilities: capabilityRegistry.descriptors(),
    resolveCapabilities(refs, signal) {
      return capabilityRegistry.resolve(refs, signal);
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
        kind: "mcp",
        name: capability.name,
        description: capability.description,
        source: "fixed",
      },
      async resolve(signal) {
        const connection = await runtime!.connect(capability.server, signal);
        const instructions = [
          `The user explicitly selected the @${capability.name} MCP capability for this turn.`,
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
          tools: createMcpCapabilityTools(
            runtime!,
            capability.id,
            connection,
          ),
        };
      },
    };
  });
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
