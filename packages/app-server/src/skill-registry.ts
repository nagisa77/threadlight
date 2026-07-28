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
  private readonly byInvocationName: ReadonlyMap<string, LoadedSkill>;
  private readonly byId: ReadonlyMap<string, LoadedSkill>;

  private constructor(
    private readonly loadedSkills: readonly LoadedSkill[],
    readonly warnings: readonly string[],
    private readonly maxCatalogChars: number,
  ) {
    this.byInvocationName = new Map(
      loadedSkills.map((skill) => [skill.invocationName, skill]),
    );
    this.byId = new Map(loadedSkills.map((skill) => [skill.id, skill]));
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
    let snapshotChars = 0;

    for (const source of options.sources) {
      const discovered = await discoverSource(source, maxSkillChars, warnings);
      for (const skill of discovered) {
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
    const skill =
      this.byInvocationName.get(normalized) ?? this.byId.get(normalized);
    if (!skill) throw new Error(`Unknown skill: ${nameOrId}`);
    const { source: _source, ...result } = skill;
    return result;
  }

  catalogPrompt(): string {
    if (this.loadedSkills.length === 0) return "";
    const introduction = [
      "Available skills are listed below using progressive disclosure.",
      "When the user explicitly names a skill with $skill-name, follow the injected skill instructions.",
      "When an unnamed task clearly matches a skill description, call skill_read before acting. Do not infer a skill's workflow from its description alone.",
    ].join(" ");
    const lines = this.loadedSkills.map(
      (skill) =>
        `- $${skill.invocationName} [${skill.id}]: ${skill.description}`,
    );
    const warnings =
      this.warnings.length === 0
        ? []
        : [
            "Skill discovery warnings:",
            ...this.warnings.map((warning) => `- ${warning}`),
          ];
    return [introduction, ...lines, ...warnings]
      .join("\n")
      .slice(0, this.maxCatalogChars);
  }

  promptBlocksForExplicitMentions(input: string): PromptBlock[] {
    const names = explicitSkillMentions(input);
    return names.flatMap((name) => {
      const loaded = this.byInvocationName.get(name);
      if (!loaded) return [];
      const skill = this.read(name);
      return {
        id: `skill.explicit.${skill.id.slice(0, 16)}`,
        version: 1,
        authority: "skill",
        source: skill.path,
        content: skill.instructions,
      };
    });
  }
}

export function createSkillReadTool(registry: SkillRegistry): Tool {
  return defineTool({
    name: "skill_read",
    description:
      "Load the full instructions and resource inventory for one available skill. Use this before following an implicitly matched skill; explicitly mentioned skills are already injected.",
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
