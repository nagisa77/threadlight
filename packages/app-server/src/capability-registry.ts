import type { Tool } from "@threadlight/agent-loop";
import type { CapabilityDescriptor } from "@threadlight/protocol";

import type { PromptBlock } from "./prompt-composer.js";
import type { SkillRegistry } from "./skill-registry.js";

const MAX_SELECTED_CAPABILITIES = 16;

export interface CapabilityResolution {
  promptBlocks: readonly PromptBlock[];
  tools: readonly Tool[];
}

export interface CapabilitySource {
  descriptor: CapabilityDescriptor;
  resolve(
    signal: AbortSignal,
  ): CapabilityResolution | Promise<CapabilityResolution>;
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
        return source.resolve(signal);
      }),
    );
    return {
      promptBlocks: resolutions.flatMap(({ promptBlocks }) => promptBlocks),
      tools: resolutions.flatMap(({ tools }) => tools),
    };
  }
}

export function skillCapabilitySources(
  registry: SkillRegistry,
): CapabilitySource[] {
  return registry.descriptors().map((skill) => ({
    descriptor: {
      id: `skill:${skill.id}`,
      kind: "skill",
      name: skill.invocationName,
      description: skill.description,
      source: skill.plugin?.name ?? skill.scope,
    },
    resolve() {
      return {
        promptBlocks: [registry.promptBlock(skill.id)],
        tools: [],
      };
    },
  }));
}

function validateDescriptor(descriptor: CapabilityDescriptor): void {
  if (
    !descriptor.id.trim() ||
    descriptor.id.length > 256 ||
    !descriptor.name.trim() ||
    descriptor.name.length > 128 ||
    !descriptor.description.trim() ||
    descriptor.description.length > 2_000 ||
    (descriptor.kind !== "skill" && descriptor.kind !== "mcp")
  ) {
    throw new Error("Capability descriptor is invalid");
  }
}
