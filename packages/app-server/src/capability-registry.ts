import type { Tool } from "@threadlight/agent-loop";
import type {
  CapabilityDescriptor,
  CapabilityVisibility,
} from "@threadlight/protocol";

import type { PromptBlock } from "./prompt-composer.js";
import type { SkillRegistry } from "./skill-registry.js";

const MAX_SELECTED_CAPABILITIES = 16;

export interface CapabilityResolution {
  promptBlocks: readonly PromptBlock[];
  tools: readonly Tool[];
  resources?: readonly CapabilityResource[];
}

export interface CapabilityResource {
  path: string;
  source: string;
  read(signal: AbortSignal): Promise<CapabilityResourceContent>;
}

export interface CapabilityResourceContent {
  path: string;
  content: string;
  truncated: boolean;
}

export type CapabilityActivation = "explicit" | "model";

export interface CapabilitySource {
  descriptor: CapabilityDescriptor;
  resolve(
    signal: AbortSignal,
    activation?: CapabilityActivation,
  ): CapabilityResolution | Promise<CapabilityResolution>;
}

export interface CapabilityPresentation {
  icon?: string;
  visibility?: CapabilityVisibility;
  keywords?: readonly string[];
  connectorRef?: string;
}

export class CapabilityRegistry {
  private readonly sources: ReadonlyMap<string, CapabilitySource>;

  constructor(sources: readonly CapabilitySource[]) {
    const byId = new Map<string, CapabilitySource>();
    for (const source of sources) {
      validateDescriptor(source.descriptor);
      if (byId.has(source.descriptor.id)) {
        throw new Error(`Duplicate capability: ${source.descriptor.id}`);
      }
      byId.set(source.descriptor.id, source);
    }
    this.sources = byId;
  }

  descriptors(): readonly CapabilityDescriptor[] {
    return [...this.sources.values()].map(({ descriptor }) => ({
      ...descriptor,
    }));
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  async resolve(
    refs: readonly string[],
    signal: AbortSignal,
    activation: CapabilityActivation = "explicit",
  ): Promise<CapabilityResolution> {
    const uniqueRefs = [...new Set(refs)];
    if (uniqueRefs.length > MAX_SELECTED_CAPABILITIES) {
      throw new Error(
        `A turn can select at most ${MAX_SELECTED_CAPABILITIES} capabilities`,
      );
    }
    const resolutions = await Promise.all(
      uniqueRefs.map(async (ref) => {
        const source = this.sources.get(ref);
        if (!source) throw new Error(`Unknown capability: ${ref}`);
        return source.resolve(signal, activation);
      }),
    );
    return {
      promptBlocks: resolutions.flatMap(({ promptBlocks }) => promptBlocks),
      tools: resolutions.flatMap(({ tools }) => tools),
      resources: resolutions.flatMap(({ resources }) => resources ?? []),
    };
  }
}

export function skillCapabilitySources(
  registry: SkillRegistry,
  presentationForPlugin: (
    pluginName: string,
  ) => CapabilityPresentation | undefined = () => undefined,
): CapabilitySource[] {
  return registry.descriptors().map((skill) => {
    const presentation = skill.plugin
      ? presentationForPlugin(skill.plugin.name)
      : undefined;
    return {
      descriptor: {
        id: `skill:${skill.id}`,
        kind: "skill" as const,
        name:
          skill.plugin && skill.name === skill.plugin.name
            ? humanizeCapabilityName(skill.name)
            : skill.invocationName,
        description: skill.description,
        source: skill.plugin?.name ?? skill.scope,
        icon:
          presentation?.icon ??
          (skill.scope === "builtin" && skill.name === "skill-creator"
            ? "skill-creator"
            : "skill"),
        visibility:
          presentation?.visibility ??
          (skill.scope === "repo" || skill.scope === "builtin"
            ? "featured"
            : "search"),
        ...(presentation?.keywords
          ? { keywords: presentation.keywords }
          : {}),
        ...(presentation?.connectorRef
          ? { connectorRef: presentation.connectorRef }
          : {}),
      },
      resolve() {
        return {
          promptBlocks: [registry.promptBlock(skill.id)],
          tools: [],
          resources: registry.resources(skill.id).map((path) => ({
            path,
            source: skill.invocationName,
            read: (signal: AbortSignal) =>
              registry.readResource(skill.id, path, signal),
          })),
        };
      },
    };
  });
}

function humanizeCapabilityName(value: string): string {
  if (value === "powerpoint") return "PowerPoint";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function validateDescriptor(descriptor: CapabilityDescriptor): void {
  if (
    !descriptor.id.trim() ||
    descriptor.id.length > 256 ||
    !descriptor.name.trim() ||
    descriptor.name.length > 128 ||
    !descriptor.description.trim() ||
    descriptor.description.length > 2_000 ||
    (descriptor.kind !== "skill" && descriptor.kind !== "tool") ||
    (descriptor.visibility !== undefined &&
      descriptor.visibility !== "featured" &&
      descriptor.visibility !== "search" &&
      descriptor.visibility !== "hidden") ||
    (descriptor.keywords !== undefined &&
      (!Array.isArray(descriptor.keywords) ||
        !descriptor.keywords.every(
          (keyword) => typeof keyword === "string" && keyword.trim(),
        ))) ||
    (descriptor.connectorRef !== undefined &&
      (!descriptor.connectorRef.startsWith("mcp:") ||
        descriptor.connectorRef.length > 256))
  ) {
    throw new Error("Capability descriptor is invalid");
  }
}
