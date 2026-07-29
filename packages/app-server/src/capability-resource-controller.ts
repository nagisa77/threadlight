import { defineTool, type Tool } from "@threadlight/agent-loop";

import type {
  CapabilityResource,
  CapabilityResourceContent,
} from "./capability-registry.js";

export class CapabilityResourceController {
  private readonly resources = new Map<string, CapabilityResource>();

  constructor(resources: readonly CapabilityResource[] = []) {
    this.add(resources);
  }

  add(resources: readonly CapabilityResource[]): boolean {
    const wasEmpty = this.resources.size === 0;
    for (const resource of resources) {
      const existing = this.resources.get(resource.path);
      if (existing && existing.source !== resource.source) {
        throw new Error(
          `Conflicting capability resource grant: ${resource.path}`,
        );
      }
      this.resources.set(resource.path, resource);
    }
    return wasEmpty && this.resources.size > 0;
  }

  hasResources(): boolean {
    return this.resources.size > 0;
  }

  tool(): Tool {
    return defineTool({
      name: "capability_resource_read",
      mutability: "read",
      description:
        "Read one bundled resource declared by a capability active in the current turn. Use the exact path shown in that capability's instructions. Other filesystem paths are rejected.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            minLength: 1,
            description:
              "Exact absolute resource path declared by an active capability.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: (arguments_, context) =>
        this.read(parseResourcePath(arguments_), context.signal),
    });
  }

  private async read(
    path: string,
    signal: AbortSignal,
  ): Promise<CapabilityResourceContent> {
    const resource = this.resources.get(path);
    if (!resource) {
      throw new Error(
        "resource is not declared by a capability active in this turn",
      );
    }
    signal.throwIfAborted();
    return resource.read(signal);
  }
}

function parseResourcePath(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("capability_resource_read arguments must be an object");
  }
  const path = (value as { path?: unknown }).path;
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("path must be a non-empty string");
  }
  return path.trim();
}
