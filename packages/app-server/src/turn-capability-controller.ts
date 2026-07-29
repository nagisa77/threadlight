import {
  defineTool,
  type RunController,
  type RunControllerModelDirective,
  type Tool,
} from "@threadlight/agent-loop";
import type { CapabilityDescriptor } from "@threadlight/protocol";

import type {
  CapabilityActivation,
  CapabilityResolution,
} from "./capability-registry.js";
import type { PromptBlock } from "./prompt-composer.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface TurnCapabilityControllerOptions {
  capabilities: readonly CapabilityDescriptor[];
  initialRefs?: readonly string[];
  resolve(
    refs: readonly string[],
    signal: AbortSignal,
    activation?: CapabilityActivation,
  ): CapabilityResolution | Promise<CapabilityResolution>;
  addTools(tools: readonly Tool[]): void;
}

export class TurnCapabilityController implements RunController {
  private readonly activeRefs: Set<string>;
  private readonly modelActivatedRefs: string[] = [];
  private readonly promptBlocks = new Map<string, PromptBlock>();

  constructor(private readonly options: TurnCapabilityControllerOptions) {
    this.activeRefs = new Set(options.initialRefs ?? []);
  }

  tools(): readonly Tool[] {
    if (this.discoverableCapabilities().length === 0) return [];
    return [
      defineTool({
        name: "capability_list",
        description:
          "Search and page through available skills, connectors, and runtime capabilities. Use this when the user's request needs an external service or specialized capability that is not already available as a tool.",
        mutability: "read",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Optional case-insensitive search text, such as gmail, pdf, mail, or document.",
            },
            cursor: {
              type: "string",
              description:
                "Opaque nextCursor returned by a previous capability_list call.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: MAX_PAGE_SIZE,
              description: `Maximum capabilities to return. Defaults to ${DEFAULT_PAGE_SIZE}.`,
            },
          },
          additionalProperties: false,
        },
        execute: async (arguments_) =>
          this.list(parseListArguments(arguments_)),
      }),
      defineTool({
        name: "capability_activate",
        description:
          "Activate one capability returned by capability_list for the current turn. Its trusted instructions and tools become available on the next model step. Use the exact capability id; do not guess ids.",
        mutability: "read",
        impact: { external: true },
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              minLength: 1,
              description:
                "Exact capability id returned by capability_list.",
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
        execute: async (arguments_, context) =>
          this.activate(parseActivateArguments(arguments_), context.signal),
      }),
    ];
  }

  beforeModel(): RunControllerModelDirective {
    if (this.promptBlocks.size === 0) return {};
    return {
      instructions: [...this.promptBlocks.values()]
        .map(({ content }) => content)
        .join("\n\n"),
    };
  }

  activatedRefs(): readonly string[] {
    return [...this.modelActivatedRefs];
  }

  private list(options: CapabilityListArguments) {
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const offset = parseCursor(options.cursor);
    const limit = pageSize(options.limit);
    const matches = this.discoverableCapabilities().filter(
      (capability) =>
        !query || capabilitySearchText(capability).includes(query),
    );
    if (offset > matches.length) {
      throw new Error("capability_list cursor is out of range");
    }
    const capabilities = matches.slice(offset, offset + limit);
    const nextOffset = offset + capabilities.length;
    return {
      capabilities,
      ...(nextOffset < matches.length
        ? { nextCursor: String(nextOffset) }
        : {}),
    };
  }

  private async activate(
    id: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const capability = this.discoverableCapabilities().find(
      (candidate) => candidate.id === id,
    );
    if (!capability) {
      throw new Error(
        `Unknown or non-discoverable capability: ${id}. Call capability_list and use an exact returned id.`,
      );
    }
    if (this.activeRefs.has(id)) {
      return {
        activated: capability,
        alreadyActive: true,
        tools: [],
      };
    }

    const resolution = await this.options.resolve(
      [id],
      signal,
      "model",
    );
    for (const block of resolution.promptBlocks) {
      const existing = this.promptBlocks.get(block.id);
      if (existing && !samePromptBlock(existing, block)) {
        throw new Error(`Conflicting activated prompt block: ${block.id}`);
      }
    }
    this.options.addTools(resolution.tools);
    for (const block of resolution.promptBlocks) {
      this.promptBlocks.set(block.id, block);
    }
    this.activeRefs.add(id);
    this.modelActivatedRefs.push(id);
    return {
      activated: capability,
      alreadyActive: false,
      tools: resolution.tools.map(({ name }) => name),
    };
  }

  private discoverableCapabilities(): readonly CapabilityDescriptor[] {
    return this.options.capabilities.filter(
      ({ visibility }) => visibility !== "hidden",
    );
  }
}

interface CapabilityListArguments {
  query?: string;
  cursor?: string;
  limit?: number;
}

function parseListArguments(value: unknown): CapabilityListArguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("capability_list arguments must be an object");
  }
  const arguments_ = value as Record<string, unknown>;
  const query = arguments_.query;
  const cursor = arguments_.cursor;
  const limit = arguments_.limit;
  if (query !== undefined && typeof query !== "string") {
    throw new Error("query must be a string");
  }
  if (cursor !== undefined && typeof cursor !== "string") {
    throw new Error("cursor must be a string");
  }
  if (limit !== undefined && !Number.isSafeInteger(limit)) {
    throw new Error("limit must be an integer");
  }
  return {
    ...(query !== undefined ? { query } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    ...(limit !== undefined ? { limit: Number(limit) } : {}),
  };
}

function parseActivateArguments(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("capability_activate arguments must be an object");
  }
  const id = (value as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim() || id.length > 256) {
    throw new Error("id must be a non-empty capability id");
  }
  return id.trim();
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/.test(cursor)) {
    throw new Error("capability_list cursor is invalid");
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) {
    throw new Error("capability_list cursor is invalid");
  }
  return offset;
}

function pageSize(limit: number | undefined): number {
  const value = limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(
      `capability_list limit must be between 1 and ${MAX_PAGE_SIZE}`,
    );
  }
  return value;
}

function capabilitySearchText(
  capability: CapabilityDescriptor,
): string {
  return [
    capability.id,
    capability.name,
    capability.description,
    capability.source ?? "",
    capability.kind,
    ...(capability.keywords ?? []),
  ]
    .join("\n")
    .toLocaleLowerCase();
}

function samePromptBlock(left: PromptBlock, right: PromptBlock): boolean {
  return (
    left.version === right.version &&
    left.authority === right.authority &&
    left.source === right.source &&
    left.content === right.content
  );
}
