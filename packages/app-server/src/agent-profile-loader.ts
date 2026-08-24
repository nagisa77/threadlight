import type { SubagentProfile } from "@threadlight/agent-loop";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse } from "smol-toml";

const PROFILE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const PROFILE_KEYS = new Set([
  "name",
  "description",
  "instructions",
  "tool_access",
  "excluded_tools",
  "model",
  "provider",
  "max_steps",
  "leaf",
  "skill_role",
]);

export const BUILTIN_SUBAGENT_PROFILES: readonly SubagentProfile[] = [
  {
    name: "default",
    description:
      "Handle general delegated analysis, review, and synthesis without changing workspace or external state.",
    instructions:
      "Investigate the delegated question, use concrete evidence, identify risks or missing information, and return a concise result without modifying workspace or external state.",
    toolAccess: "read-only",
    leaf: true,
    skillRole: "default",
  },
  {
    name: "worker",
    description:
      "Implement one well-scoped change with exclusive workspace write ownership.",
    instructions:
      "Implement only the delegated change, preserve unrelated user work, verify the result proportionally, and report changed files plus test evidence.",
    toolAccess: "all",
    excludedTools: [
      "update_plan",
      "advance_plan",
      "request_plan_input",
      "project_memory",
    ],
    leaf: true,
    skillRole: "worker",
  },
  {
    name: "explorer",
    description:
      "Quickly inspect the workspace, trace code paths, and return evidence without changing state.",
    instructions:
      "Search broadly enough to answer the delegated question, cite concrete files and symbols, and do not modify workspace or external state.",
    toolAccess: "read-only",
    leaf: true,
    skillRole: "explorer",
  },
];

export interface SubagentProfileLoadOptions {
  personalDirectory?: string;
  projectDirectory?: string;
}

interface ProfileOverride {
  name: string;
  description?: string;
  instructions?: string;
  toolAccess?: SubagentProfile["toolAccess"];
  excludedTools?: readonly string[];
  model?: string;
  provider?: string;
  maxSteps?: number;
  leaf?: boolean;
  skillRole?: string;
}

/**
 * Loads provider-neutral subagent roles with deterministic precedence:
 * project TOML > personal TOML > built-in profile.
 */
export async function loadSubagentProfiles(
  options: SubagentProfileLoadOptions = {},
): Promise<readonly SubagentProfile[]> {
  const profiles = new Map<string, SubagentProfile>();
  for (const profile of BUILTIN_SUBAGENT_PROFILES) {
    validateCompleteProfile(profile, "built-in profile");
    if (profiles.has(profile.name)) {
      throw new Error(`Duplicate built-in agent profile: ${profile.name}`);
    }
    profiles.set(profile.name, cloneProfile(profile));
  }

  if (options.personalDirectory) {
    await applyDirectory(profiles, options.personalDirectory, "personal");
  }
  if (options.projectDirectory) {
    await applyDirectory(profiles, options.projectDirectory, "project");
  }
  return [...profiles.values()];
}

async function applyDirectory(
  profiles: Map<string, SubagentProfile>,
  directory: string,
  scope: "personal" | "project",
): Promise<void> {
  const files = await tomlFiles(directory);
  const seen = new Map<string, string>();
  for (const file of files) {
    const path = join(directory, file);
    const override = await readProfile(path);
    const duplicate = seen.get(override.name);
    if (duplicate) {
      throw new Error(
        `Duplicate ${scope} agent profile ${override.name}: ${duplicate} and ${path}`,
      );
    }
    seen.set(override.name, path);
    const existing = profiles.get(override.name);
    const merged = {
      ...(existing ?? {
        name: override.name,
        toolAccess: "read-only" as const,
      }),
      ...override,
    };
    validateCompleteProfile(merged, path);
    profiles.set(override.name, merged);
  }
}

async function tomlFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() && extname(entry.name).toLowerCase() === ".toml",
      )
      .map(({ name }) => name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw new Error(
      `Unable to read agent profile directory ${directory}: ${errorMessage(error)}`,
    );
  }
}

async function readProfile(path: string): Promise<ProfileOverride> {
  let value: unknown;
  try {
    value = parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid agent profile ${path}: ${errorMessage(error)}`);
  }
  if (!isObject(value)) {
    throw new Error(`Invalid agent profile ${path}: expected a TOML table`);
  }
  const unknown = Object.keys(value).filter((key) => !PROFILE_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Invalid agent profile ${path}: unknown field${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`,
    );
  }

  const defaultName = basename(path, extname(path));
  const name = optionalString(value.name, "name", path) ?? defaultName;
  validateProfileName(name, path);
  return {
    name,
    ...optionalProfileString(value, "description", path),
    ...optionalProfileString(value, "instructions", path),
    ...optionalToolAccess(value.tool_access, path),
    ...optionalStringArray(value.excluded_tools, "excluded_tools", path),
    ...optionalProfileString(value, "model", path),
    ...optionalProfileString(value, "provider", path),
    ...optionalMaxSteps(value.max_steps, path),
    ...optionalBoolean(value.leaf, "leaf", path),
    ...optionalProfileString(value, "skill_role", path),
  };
}

function validateCompleteProfile(
  profile: Partial<SubagentProfile> & Pick<SubagentProfile, "name">,
  source: string,
): asserts profile is SubagentProfile {
  validateProfileName(profile.name, source);
  requireString(profile.description, "description", source);
  requireString(profile.instructions, "instructions", source);
  if (
    profile.toolAccess !== undefined &&
    profile.toolAccess !== "read-only" &&
    profile.toolAccess !== "all"
  ) {
    throw new Error(
      `Invalid agent profile ${source}: tool_access must be "read-only" or "all"`,
    );
  }
}

function validateProfileName(name: string, source: string): void {
  if (!PROFILE_NAME.test(name)) {
    throw new Error(
      `Invalid agent profile ${source}: name must match ${PROFILE_NAME.source}`,
    );
  }
}

function optionalProfileString(
  value: Record<string, unknown>,
  key: "description" | "instructions" | "model" | "provider" | "skill_role",
  path: string,
): Partial<ProfileOverride> {
  if (value[key] === undefined) return {};
  return key === "skill_role"
    ? { skillRole: requireString(value[key], key, path) }
    : { [key]: requireString(value[key], key, path) };
}

function optionalBoolean(
  value: unknown,
  key: string,
  path: string,
): Pick<ProfileOverride, "leaf"> | Record<string, never> {
  if (value === undefined) return {};
  if (typeof value !== "boolean") {
    throw new Error(`Invalid agent profile ${path}: ${key} must be a boolean`);
  }
  return { leaf: value };
}

function optionalToolAccess(
  value: unknown,
  path: string,
): Pick<ProfileOverride, "toolAccess"> | Record<string, never> {
  if (value === undefined) return {};
  if (value !== "read-only" && value !== "all") {
    throw new Error(
      `Invalid agent profile ${path}: tool_access must be "read-only" or "all"`,
    );
  }
  return { toolAccess: value };
}

function optionalStringArray(
  value: unknown,
  key: "excluded_tools",
  path: string,
): Pick<ProfileOverride, "excludedTools"> | Record<string, never> {
  if (value === undefined) return {};
  if (!Array.isArray(value)) {
    throw new Error(`Invalid agent profile ${path}: ${key} must be an array`);
  }
  const items = value.map((item) => requireString(item, key, path));
  if (new Set(items).size !== items.length) {
    throw new Error(
      `Invalid agent profile ${path}: ${key} must not contain duplicates`,
    );
  }
  return { excludedTools: items };
}

function optionalMaxSteps(
  value: unknown,
  path: string,
): Pick<ProfileOverride, "maxSteps"> | Record<string, never> {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `Invalid agent profile ${path}: max_steps must be a positive integer`,
    );
  }
  return { maxSteps: value };
}

function optionalString(
  value: unknown,
  key: string,
  path: string,
): string | undefined {
  return value === undefined ? undefined : requireString(value, key, path);
}

function requireString(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Invalid agent profile ${path}: ${key} must be a non-empty string`,
    );
  }
  return value.trim();
}

function cloneProfile(profile: SubagentProfile): SubagentProfile {
  return {
    ...profile,
    ...(profile.excludedTools
      ? { excludedTools: [...profile.excludedTools] }
      : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
