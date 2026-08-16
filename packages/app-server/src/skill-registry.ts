import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import {
  isAbsolute,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { defineTool, type Tool } from "@threadlight/agent-loop";

import type { PromptBlock } from "./prompt-composer.js";

const DEFAULT_MAX_SKILL_CHARS = 64_000;
const DEFAULT_MAX_CATALOG_CHARS = 8_000;
const DEFAULT_MAX_SKILLS = 128;
const DEFAULT_MAX_SNAPSHOT_CHARS = 2_000_000;
const DEFAULT_MAX_RESOURCE_CHARS = 64_000;
const MAX_RESOURCE_BYTES = 1_000_000;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_DIRECTORIES = [
  "agents",
  "scripts",
  "references",
  "assets",
] as const;

export type SkillScope = "builtin" | "repo" | "user" | "plugin";

export interface SkillSource {
  scope: SkillScope;
  root: string;
  namespace?: string;
  plugin?: {
    name: string;
    version: string;
  };
}

export interface SkillDescriptor {
  id: string;
  name: string;
  invocationName: string;
  description: string;
  scope: SkillScope;
  path: string;
  hash: string;
  plugin?: {
    name: string;
    version: string;
  };
}

export interface SkillReadResult extends SkillDescriptor {
  instructions: string;
  resources: readonly string[];
}

export interface SkillListOptions {
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface SkillListResult {
  skills: readonly SkillDescriptor[];
  nextCursor?: string;
}

export interface SkillSnapshotEntry extends SkillDescriptor {
  source: string;
  resources: readonly string[];
}

export interface SkillRegistrySnapshot {
  version: 1;
  skills: readonly SkillSnapshotEntry[];
  warnings: readonly string[];
}

export interface DiscoverSkillsOptions {
  sources: readonly SkillSource[];
  maxSkillChars?: number;
  maxCatalogChars?: number;
  maxSkills?: number;
  maxSnapshotChars?: number;
}

interface LoadedSkill extends SkillSnapshotEntry {
  instructions: string;
}

export class SkillRegistry {
  private byInvocationName: ReadonlyMap<string, LoadedSkill>;
  private byId: ReadonlyMap<string, LoadedSkill>;

  private constructor(
    private loadedSkills: readonly LoadedSkill[],
    warnings: readonly string[],
    private readonly maxCatalogChars: number,
  ) {
    this.warnings = warnings;
    this.byInvocationName = new Map(
      loadedSkills.map((skill) => [skill.invocationName, skill]),
    );
    this.byId = new Map(loadedSkills.map((skill) => [skill.id, skill]));
  }

  warnings: readonly string[];

  replaceWith(next: SkillRegistry): void {
    this.loadedSkills = [...next.loadedSkills];
    this.warnings = [...next.warnings];
    this.byInvocationName = new Map(
      this.loadedSkills.map((skill) => [skill.invocationName, skill]),
    );
    this.byId = new Map(this.loadedSkills.map((skill) => [skill.id, skill]));
  }

  static async discover(
    options: DiscoverSkillsOptions,
  ): Promise<SkillRegistry> {
    const maxSkillChars = positiveInteger(
      options.maxSkillChars ?? DEFAULT_MAX_SKILL_CHARS,
      "maxSkillChars",
    );
    const maxCatalogChars = positiveInteger(
      options.maxCatalogChars ?? DEFAULT_MAX_CATALOG_CHARS,
      "maxCatalogChars",
    );
    const maxSkills = positiveInteger(
      options.maxSkills ?? DEFAULT_MAX_SKILLS,
      "maxSkills",
    );
    const maxSnapshotChars = positiveInteger(
      options.maxSnapshotChars ?? DEFAULT_MAX_SNAPSHOT_CHARS,
      "maxSnapshotChars",
    );
    const skills: LoadedSkill[] = [];
    const warnings: string[] = [];
    const invocationNames = new Set<string>();
    const loadedSkillPaths = new Set<string>();
    let snapshotChars = 0;

    for (const source of options.sources) {
      const discovered = await discoverSource(source, maxSkillChars, warnings);
      for (const skill of discovered) {
        // The same canonical SKILL.md can be reachable from several sources
        // (for example .agents/skills and .codex/skills). Skip the
        // duplicate silently; the same file may still load under a different
        // plugin namespace.
        if (
          loadedSkillPaths.has(skill.path) &&
          invocationNames.has(skill.invocationName)
        ) {
          continue;
        }
        if (skills.length >= maxSkills) {
          warnings.push(
            `Skill discovery stopped after reaching the ${maxSkills}-skill limit`,
          );
          return new SkillRegistry(skills, warnings, maxCatalogChars);
        }
        if (snapshotChars + skill.source.length > maxSnapshotChars) {
          warnings.push(
            `${skill.path} was skipped because the skill snapshot exceeds ${maxSnapshotChars} characters`,
          );
          continue;
        }
        if (invocationNames.has(skill.invocationName)) {
          warnings.push(
            `${skill.path} was skipped because $${skill.invocationName} is already registered`,
          );
          continue;
        }
        invocationNames.add(skill.invocationName);
        loadedSkillPaths.add(skill.path);
        skills.push(skill);
        snapshotChars += skill.source.length;
      }
    }

    return new SkillRegistry(skills, warnings, maxCatalogChars);
  }

  static fromSnapshot(
    snapshot: SkillRegistrySnapshot,
    options: { maxCatalogChars?: number } = {},
  ): SkillRegistry {
    validateSkillRegistrySnapshot(snapshot);
    const skills = snapshot.skills.map((entry) => {
      const parsed = parseSkillFile(entry.source, entry.path);
      if (
        parsed.name !== entry.name ||
        parsed.description !== entry.description ||
        contentHash(entry.source) !== entry.hash ||
        entry.id !==
          contentHash(
            `${entry.scope}\0${entry.invocationName}\0${entry.path}\0${entry.hash}`,
          )
      ) {
        throw new Error(`Skill snapshot hash mismatch: ${entry.invocationName}`);
      }
      const skillRoot = dirname(entry.path);
      if (
        entry.resources.some(
          (resource) =>
            !isAbsolute(resource) || !isWithin(skillRoot, resource),
        )
      ) {
        throw new Error(
          `Skill snapshot contains an invalid resource: ${entry.invocationName}`,
        );
      }
      return {
        ...entry,
        instructions: renderSkillInstructions(entry, parsed.body),
      };
    });
    return new SkillRegistry(
      skills,
      [...snapshot.warnings],
      positiveInteger(
        options.maxCatalogChars ?? DEFAULT_MAX_CATALOG_CHARS,
        "maxCatalogChars",
      ),
    );
  }

  descriptors(): readonly SkillDescriptor[] {
    return this.loadedSkills.map(
      ({ source: _source, resources: _resources, instructions: _instructions, ...skill }) =>
        skill,
    );
  }

  snapshot(): SkillRegistrySnapshot {
    return {
      version: 1,
      skills: this.loadedSkills.map(
        ({ instructions: _instructions, ...skill }) => skill,
      ),
      warnings: [...this.warnings],
    };
  }

  read(nameOrId: string): SkillReadResult {
    const normalized = nameOrId.trim().replace(/^\$/, "");
    const skill = this.resolve(normalized);
    if (!skill) throw new Error(`Unknown skill: ${nameOrId}`);
    const { source: _source, ...result } = skill;
    return result;
  }

  resources(nameOrId: string): readonly string[] {
    const normalized = nameOrId.trim().replace(/^\$/, "");
    const skill = this.resolve(normalized);
    if (!skill) throw new Error(`Unknown skill: ${nameOrId}`);
    return [...skill.resources];
  }

  async readResource(
    nameOrId: string,
    requestedPath: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; content: string; truncated: boolean }> {
    const normalized = nameOrId.trim().replace(/^\$/, "");
    const skill = this.resolve(normalized);
    if (!skill) throw new Error(`Unknown skill: ${nameOrId}`);
    if (!skill.resources.includes(requestedPath)) {
      throw new Error("resource is not declared by this skill");
    }

    signal?.throwIfAborted();
    const canonical = await realpath(requestedPath);
    const skillRoot = dirname(skill.path);
    if (!isWithin(skillRoot, canonical) || canonical !== requestedPath) {
      throw new Error("resource no longer resolves inside its skill directory");
    }
    const metadata = await stat(canonical);
    if (!metadata.isFile()) throw new Error("skill resource is not a file");
    if (metadata.size > MAX_RESOURCE_BYTES) {
      throw new Error(
        `skill resource exceeds the ${MAX_RESOURCE_BYTES}-byte read limit`,
      );
    }
    const bytes = await readFile(canonical, { signal });
    if (bytes.includes(0)) {
      throw new Error("skill resource is not readable text");
    }
    const text = bytes.toString("utf8");
    const content = text.slice(0, DEFAULT_MAX_RESOURCE_CHARS);
    return {
      path: canonical,
      content,
      truncated: content.length < text.length,
    };
  }

  list(options: SkillListOptions = {}): SkillListResult {
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const offset = parseListCursor(options.cursor);
    const limit = listLimit(options.limit);
    const matches = this.loadedSkills.filter((skill) =>
      !query || skillSearchText(skill).includes(query)
    );
    if (offset > matches.length) {
      throw new Error("skill_list cursor is out of range");
    }
    const page = matches.slice(offset, offset + limit);
    const skills = page.map(
      ({ source: _source, resources: _resources, instructions: _instructions, ...skill }) =>
        skill,
    );
    const nextOffset = offset + page.length;
    return {
      skills,
      ...(nextOffset < matches.length
        ? { nextCursor: String(nextOffset) }
        : {}),
    };
  }

  promptBlock(nameOrId: string): PromptBlock {
    const skill = this.read(nameOrId);
    return {
      id: `skill.explicit.${skill.id.slice(0, 16)}`,
      version: 1,
      authority: "skill",
      source: skill.path,
      content: skill.instructions,
    };
  }

  /**
   * Returns a small binding directive for an explicitly requested skill.
   * The full SKILL.md body is deliberately NOT injected here; the model must
   * call skill_read and read every bundled resource before acting.
   */
  requiredReadPromptBlock(nameOrId: string): PromptBlock {
    const skill = this.read(nameOrId);
    return {
      id: `skill.required-read.${skill.id.slice(0, 16)}`,
      version: 1,
      authority: "skill",
      source: skill.path,
      content: renderRequiredSkillReadInstructions(skill),
    };
  }

  catalogPrompt(): string {
    if (this.loadedSkills.length === 0) return "";
    const introduction = [
      "Available skills are listed below using progressive disclosure.",
      "When the user explicitly names a skill with $skill-name, you MUST call skill_read to load its full instructions; only a short required-read directive is injected.",
      "When an unnamed task clearly matches a skill description, call skill_read before acting. Do not infer a skill's workflow from its description alone.",
      "Use skill_list to search or page through skills that are not present in this compact catalog.",
    ].join(" ");
    const prioritized = this.loadedSkills
      .map((skill, index) => ({ skill, index }))
      .sort(
        (left, right) =>
          skillCatalogPriority(left.skill.scope) -
            skillCatalogPriority(right.skill.scope) ||
          left.index - right.index,
      )
      .map(({ skill }) => skill);
    const lines = prioritized.map(
      (skill) =>
        `- $${skill.invocationName}: ${skill.description}`,
    );
    const warningLines =
      this.warnings.length === 0
        ? []
        : [
            "Skill discovery warnings:",
            ...this.warnings.map((warning) => `- ${warning}`),
          ];
    const included = [introduction];
    let omitted = 0;
    for (const line of lines) {
      if (joinedLength(included, line) <= this.maxCatalogChars) {
        included.push(line);
      } else {
        omitted += 1;
      }
    }
    if (omitted > 0) {
      appendWholeLineWithinBudget(
        included,
        `${omitted} skill ${omitted === 1 ? "entry was" : "entries were"} omitted from this compact catalog. Use skill_list to find them.`,
        this.maxCatalogChars,
      );
    }
    for (const line of warningLines) {
      appendWholeLineWithinBudget(included, line, this.maxCatalogChars);
    }
    return included.join("\n");
  }

  promptBlocksForExplicitMentions(input: string): PromptBlock[] {
    const names = explicitSkillMentions(input);
    return names.flatMap((name) => {
      const loaded = this.resolve(name);
      if (!loaded) return [];
      return this.requiredReadPromptBlock(name);
    });
  }

  /** Capability refs (`skill:<id>`) for skills explicitly mentioned as $name in the input. */
  refsForExplicitMentions(input: string): string[] {
    return explicitSkillMentions(input).flatMap((name) => {
      const loaded = this.resolve(name);
      return loaded ? [`skill:${loaded.id}`] : [];
    });
  }

  private resolve(normalized: string): LoadedSkill | undefined {
    const exact =
      this.byInvocationName.get(normalized) ?? this.byId.get(normalized);
    if (exact) return exact;
    const shortNameMatches = this.loadedSkills.filter(
      (skill) => skill.name === normalized,
    );
    if (shortNameMatches.length === 1) return shortNameMatches[0];
    if (shortNameMatches.length > 1) {
      throw new Error(
        `Ambiguous skill ${normalized}; use one of: ${shortNameMatches
          .map(({ invocationName }) => invocationName)
          .join(", ")}`,
      );
    }
  }
}

export function createSkillListTool(registry: SkillRegistry): Tool {
  return defineTool({
    name: "skill_list",
    description:
      "Search and page through available skills by name, description, scope, or plugin. Use this when the compact skill catalog does not contain a relevant skill.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional case-insensitive search text, such as gmail, pdf, or review.",
        },
        cursor: {
          type: "string",
          description:
            "Opaque nextCursor returned by a previous skill_list call.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum skills to return. Defaults to 20.",
        },
      },
      additionalProperties: false,
    },
    execute(arguments_) {
      return Promise.resolve(registry.list(parseSkillListArguments(arguments_)));
    },
  });
}

export function createSkillReadTool(registry: SkillRegistry): Tool {
  return defineTool({
    name: "skill_read",
    description:
      "Load the full instructions and resource inventory for one available skill. Use this before following an implicitly matched skill; explicitly requested skills are also loaded through this tool (only a required-read directive is injected). After reading, read every bundled resource listed in the result with capability_resource_read (resources under references/, agents/, scripts/ and assets/ are collected recursively; use the exact absolute paths returned by skill_read).",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          minLength: 1,
          description:
            "Exact skill invocation name or opaque id from the available skills list.",
        },
      },
      required: ["skill"],
      additionalProperties: false,
    },
    execute(arguments_) {
      const skill = parseSkillReadArguments(arguments_);
      return Promise.resolve(registry.read(skill));
    },
  });
}

export function validateSkillName(name: string): void {
  if (
    name.length > 64 ||
    !SKILL_NAME_PATTERN.test(name)
  ) {
    throw new Error(
      "Skill name must be 1-64 lowercase letters, digits, and single hyphens",
    );
  }
}

export function validateSkillRegistrySnapshot(
  value: unknown,
): asserts value is SkillRegistrySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Skill registry snapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.skills) ||
    !Array.isArray(snapshot.warnings) ||
    !snapshot.warnings.every((warning) => typeof warning === "string")
  ) {
    throw new Error("Skill registry snapshot has an unsupported format");
  }
  for (const value of snapshot.skills) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Skill registry snapshot contains an invalid skill");
    }
    const skill = value as Record<string, unknown>;
    if (
      typeof skill.id !== "string" ||
      typeof skill.name !== "string" ||
      typeof skill.invocationName !== "string" ||
      typeof skill.description !== "string" ||
      !["builtin", "repo", "user", "plugin"].includes(String(skill.scope)) ||
      typeof skill.path !== "string" ||
      typeof skill.hash !== "string" ||
      typeof skill.source !== "string" ||
      !Array.isArray(skill.resources) ||
      !skill.resources.every((resource) => typeof resource === "string")
    ) {
      throw new Error("Skill registry snapshot contains an invalid skill");
    }
    validateSkillName(skill.name);
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(
        skill.invocationName,
      )
    ) {
      throw new Error("Skill registry snapshot has an invalid invocation name");
    }
  }
  if (snapshot.skills.length > DEFAULT_MAX_SKILLS) {
    throw new Error("Skill registry snapshot exceeds the skill limit");
  }
  const sourceChars = snapshot.skills.reduce(
    (total, value) =>
      total + ((value as Record<string, unknown>).source as string).length,
    0,
  );
  if (sourceChars > DEFAULT_MAX_SNAPSHOT_CHARS) {
    throw new Error("Skill registry snapshot exceeds the content limit");
  }
}

async function discoverSource(
  source: SkillSource,
  maxSkillChars: number,
  warnings: string[],
): Promise<LoadedSkill[]> {
  let root: string;
  try {
    root = await realpath(resolve(source.root));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    warnings.push(`${source.root} could not be scanned: ${errorMessage(error)}`);
    return [];
  }
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    warnings.push(`${source.root} could not be scanned: ${errorMessage(error)}`);
    return [];
  }

  const skills: LoadedSkill[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const candidate = join(root, entry.name);
    try {
      const skillRoot = await realpath(candidate);
      if (!isWithin(root, skillRoot) || !(await stat(skillRoot)).isDirectory()) {
        warnings.push(`${candidate} resolves outside its skill source`);
        continue;
      }
      const skillPath = join(skillRoot, "SKILL.md");
      const canonicalSkillPath = await realpath(skillPath);
      if (!isWithin(skillRoot, canonicalSkillPath)) {
        warnings.push(`${skillPath} resolves outside its skill directory`);
        continue;
      }
      const sourceText = await readFile(canonicalSkillPath, "utf8");
      if (sourceText.length > maxSkillChars) {
        warnings.push(
          `${canonicalSkillPath} exceeds the ${maxSkillChars}-character skill limit`,
        );
        continue;
      }
      const parsed = parseSkillFile(sourceText, canonicalSkillPath);
      if (entry.name !== parsed.name) {
        warnings.push(
          `${canonicalSkillPath} was skipped because its folder and skill name differ`,
        );
        continue;
      }
      const invocationName = source.namespace
        ? `${source.namespace}:${parsed.name}`
        : parsed.name;
      const hash = contentHash(sourceText);
      const descriptor: SkillSnapshotEntry = {
        id: contentHash(
          `${source.scope}\0${invocationName}\0${canonicalSkillPath}\0${hash}`,
        ),
        name: parsed.name,
        invocationName,
        description: parsed.description,
        scope: source.scope,
        path: canonicalSkillPath,
        hash,
        ...(source.plugin ? { plugin: source.plugin } : {}),
        source: sourceText,
        resources: await collectResources(skillRoot, warnings),
      };
      skills.push({
        ...descriptor,
        instructions: renderSkillInstructions(descriptor, parsed.body),
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      warnings.push(`${candidate} could not be loaded: ${errorMessage(error)}`);
    }
  }
  return skills;
}

function parseSkillFile(
  source: string,
  path: string,
): { name: string; description: string; body: string } {
  const normalized = source.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${path} must start with YAML frontmatter`);
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${path} has unterminated YAML frontmatter`);
  const frontmatter = normalized.slice(4, end);
  const values = parseFrontmatter(frontmatter);
  const name = values.get("name");
  const description = values.get("description");
  if (!name || !description) {
    throw new Error(`${path} requires name and description frontmatter`);
  }
  validateSkillName(name);
  if (description.length > 2_048) {
    throw new Error(`${path} description exceeds 2048 characters`);
  }
  return {
    name,
    description,
    body: normalized.slice(end + 5).trim(),
  };
}

function parseFrontmatter(source: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line || /^\s/.test(line) || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value === "|" || value === ">") {
      const folded = value === ">";
      const continuation: string[] = [];
      while (
        index + 1 < lines.length &&
        (/^\s/.test(lines[index + 1] ?? "") ||
          (lines[index + 1] ?? "") === "")
      ) {
        index += 1;
        continuation.push((lines[index] ?? "").replace(/^\s{1,2}/, ""));
      }
      value = continuation.join(folded ? " " : "\n").trim();
    }
    values.set(key, unquoteYamlScalar(value));
  }
  return values;
}

function unquoteYamlScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function renderSkillInstructions(
  skill: SkillDescriptor,
  body: string,
): string {
  const resources =
    "resources" in skill && Array.isArray(skill.resources)
      ? skill.resources
      : [];
  return [
    `Skill: $${skill.invocationName}`,
    `Skill file: ${skill.path}`,
    resources.length > 0
      ? `Bundled resources:\n${resources.map((path) => `- ${path}`).join("\n")}`
      : "Bundled resources: none",
    body || "Follow the skill description and return the requested result.",
  ].join("\n\n");
}

function renderRequiredSkillReadInstructions(
  skill: SkillReadResult,
): string {
  const resources =
    skill.resources.length > 0
      ? skill.resources.map((path) => `- ${path}`).join("\n")
      : "- none";
  return [
    `[BINDING] Required skill read — $${skill.invocationName}`,
    `Skill file: ${skill.path}`,
    "The user explicitly requested this skill. Its full instructions are deliberately NOT injected; you must load them before acting:",
    `1. Call skill_read(skill="${skill.invocationName}") to load the complete instructions and the bundled resource inventory.`,
    "2. Read EVERY bundled resource listed in the skill_read result with capability_resource_read (resources under references/, agents/, scripts/ and assets/ are collected recursively; use the exact absolute paths returned by skill_read).",
    `Bundled resources:\n${resources}`,
    "3. Only after the full read, confirm that you have loaded the skill and follow its requirements for the rest of the task.",
  ].join("\n\n");
}

async function collectResources(
  skillRoot: string,
  warnings: string[],
): Promise<string[]> {
  const resources: string[] = [];
  for (const directoryName of RESOURCE_DIRECTORIES) {
    const directory = join(skillRoot, directoryName);
    await collectDirectoryFiles(skillRoot, directory, resources, warnings);
  }
  return resources.sort();
}

async function collectDirectoryFiles(
  skillRoot: string,
  directory: string,
  resources: string[],
  warnings: string[],
): Promise<void> {
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    warnings.push(`${directory} could not be scanned: ${errorMessage(error)}`);
    return;
  }
  if (!isWithin(skillRoot, canonicalDirectory)) {
    warnings.push(`${directory} resolves outside its skill directory`);
    return;
  }
  const entries = await readdir(canonicalDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = join(canonicalDirectory, entry.name);
    const canonical = await realpath(candidate);
    if (!isWithin(skillRoot, canonical)) {
      warnings.push(`${candidate} resolves outside its skill directory`);
      continue;
    }
    if (entry.isDirectory()) {
      await collectDirectoryFiles(skillRoot, canonical, resources, warnings);
    } else if (entry.isFile()) {
      resources.push(canonical);
    }
  }
}

function explicitSkillMentions(input: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /(?:^|[\s(])\$([a-z0-9][a-z0-9:-]*)/g;
  for (const match of input.matchAll(pattern)) {
    const name = match[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function parseSkillReadArguments(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skill_read arguments must be an object");
  }
  const skill = (value as Record<string, unknown>).skill;
  if (typeof skill !== "string" || !skill.trim()) {
    throw new Error("skill must be a non-empty string");
  }
  return skill;
}

function parseSkillListArguments(value: unknown): SkillListOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skill_list arguments must be an object");
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

function parseListCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/.test(cursor)) {
    throw new Error("skill_list cursor is invalid");
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset)) {
    throw new Error("skill_list cursor is invalid");
  }
  return offset;
}

function listLimit(limit: number | undefined): number {
  const value = limit ?? 20;
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error("skill_list limit must be between 1 and 50");
  }
  return value;
}

function skillSearchText(skill: LoadedSkill): string {
  return [
    skill.name,
    skill.invocationName,
    skill.description,
    skill.scope,
    skill.plugin?.name ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase();
}

function skillCatalogPriority(scope: SkillScope): number {
  if (scope === "builtin") return 0;
  if (scope === "plugin") return 1;
  if (scope === "repo") return 2;
  return 3;
}

function joinedLength(lines: readonly string[], addition: string): number {
  return lines.reduce((total, line) => total + line.length, 0) +
    lines.length +
    addition.length;
}

function appendWholeLineWithinBudget(
  lines: string[],
  line: string,
  maxChars: number,
): void {
  if (joinedLength(lines, line) <= maxChars) lines.push(line);
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
