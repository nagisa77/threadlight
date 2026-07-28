import { createHash } from "node:crypto";

export type PromptAuthority =
  | "host"
  | "runtime"
  | "project"
  | "skill"
  | "turn";

export interface PromptBlock {
  id: string;
  version: number;
  authority: PromptAuthority;
  source: string;
  content: string;
  maxChars?: number;
}

export interface PromptBlockSnapshot {
  id: string;
  version: number;
  authority: PromptAuthority;
  source: string;
  content: string;
  hash: string;
  truncated: boolean;
}

export interface PromptSnapshot {
  version: 1;
  hash: string;
  instructions: string;
  blocks: readonly PromptBlockSnapshot[];
}

const PROMPT_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PROMPT_AUTHORITIES = new Set<PromptAuthority>([
  "host",
  "runtime",
  "project",
  "skill",
  "turn",
]);

export class PromptComposer {
  private readonly blocks: PromptBlock[] = [];

  add(block: PromptBlock): this {
    this.blocks.push(block);
    return this;
  }

  addAll(blocks: readonly PromptBlock[]): this {
    for (const block of blocks) this.add(block);
    return this;
  }

  compose(): PromptSnapshot {
    return composePrompt(this.blocks);
  }
}

export function composePrompt(
  blocks: readonly PromptBlock[],
): PromptSnapshot {
  const ids = new Set<string>();
  const snapshots = blocks.map((block) => {
    validatePromptBlock(block);
    if (ids.has(block.id)) {
      throw new Error(`Duplicate prompt block: ${block.id}`);
    }
    ids.add(block.id);

    const normalized = block.content.trim();
    const content =
      block.maxChars === undefined
        ? normalized
        : normalized.slice(0, block.maxChars);
    return {
      id: block.id,
      version: block.version,
      authority: block.authority,
      source: block.source,
      content,
      hash: promptHash([
        block.id,
        String(block.version),
        block.authority,
        block.source,
        content,
      ]),
      truncated: content.length < normalized.length,
    } satisfies PromptBlockSnapshot;
  });
  const instructions = snapshots
    .map((block) => block.content)
    .filter(Boolean)
    .join("\n\n");

  return {
    version: 1,
    hash: promptHash(
      snapshots.flatMap((block) => [
        block.id,
        String(block.version),
        block.authority,
        block.source,
        block.hash,
      ]),
    ),
    instructions,
    blocks: snapshots,
  };
}

export function promptBlocksFromSnapshot(
  snapshot: PromptSnapshot,
): PromptBlock[] {
  validatePromptSnapshot(snapshot);
  return snapshot.blocks.map((block) => ({
    id: block.id,
    version: block.version,
    authority: block.authority,
    source: block.source,
    content: block.content,
  }));
}

export function validatePromptSnapshot(
  value: unknown,
): asserts value is PromptSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prompt snapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    typeof snapshot.hash !== "string" ||
    typeof snapshot.instructions !== "string" ||
    !Array.isArray(snapshot.blocks)
  ) {
    throw new Error("Prompt snapshot has an unsupported format");
  }
  const blocks = snapshot.blocks as unknown[];
  const restored = blocks.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Prompt snapshot contains an invalid block");
    }
    const block = value as Record<string, unknown>;
    if (
      typeof block.id !== "string" ||
      typeof block.version !== "number" ||
      !PROMPT_AUTHORITIES.has(block.authority as PromptAuthority) ||
      typeof block.source !== "string" ||
      typeof block.content !== "string" ||
      typeof block.hash !== "string" ||
      typeof block.truncated !== "boolean"
    ) {
      throw new Error("Prompt snapshot contains an invalid block");
    }
    return {
      id: block.id,
      version: block.version,
      authority: block.authority as PromptAuthority,
      source: block.source,
      content: block.content,
      hash: block.hash,
      truncated: block.truncated,
    } satisfies PromptBlockSnapshot;
  });
  const recomposed = composePrompt(
    restored.map((block) => ({
      id: block.id,
      version: block.version,
      authority: block.authority,
      source: block.source,
      content: block.content,
    })),
  );
  if (
    recomposed.hash !== snapshot.hash ||
    recomposed.instructions !== snapshot.instructions ||
    recomposed.blocks.some(
      (block, index) => block.hash !== restored[index]?.hash,
    )
  ) {
    throw new Error("Prompt snapshot hash does not match its contents");
  }
}

function validatePromptBlock(block: PromptBlock): void {
  if (!PROMPT_ID_PATTERN.test(block.id)) {
    throw new Error(`Invalid prompt block id: ${block.id}`);
  }
  if (!Number.isSafeInteger(block.version) || block.version < 1) {
    throw new Error(`Prompt block ${block.id} has an invalid version`);
  }
  if (!PROMPT_AUTHORITIES.has(block.authority)) {
    throw new Error(`Prompt block ${block.id} has an invalid authority`);
  }
  if (!block.source.trim()) {
    throw new Error(`Prompt block ${block.id} requires a source`);
  }
  if (
    block.maxChars !== undefined &&
    (!Number.isSafeInteger(block.maxChars) || block.maxChars < 1)
  ) {
    throw new Error(`Prompt block ${block.id} has an invalid maxChars`);
  }
}

function promptHash(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part)));
    hash.update(":");
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}
