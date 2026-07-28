import { createHash } from "node:crypto";
import {
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { SkillSource } from "./skill-registry.js";

const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillsOnlyPlugin {
  name: string;
  version: string;
  description: string;
  path: string;
  manifestPath: string;
  skillsPath: string;
  hash: string;
}

export interface PluginRegistrySnapshot {
  version: 1;
  plugins: readonly SkillsOnlyPlugin[];
  warnings: readonly string[];
}

export interface DiscoverPluginsOptions {
  roots: readonly string[];
}

export class SkillsOnlyPluginRegistry {
  private constructor(
    readonly plugins: readonly SkillsOnlyPlugin[],
    readonly warnings: readonly string[],
  ) {}

  static async discover(
    options: DiscoverPluginsOptions,
  ): Promise<SkillsOnlyPluginRegistry> {
    const plugins: SkillsOnlyPlugin[] = [];
    const warnings: string[] = [];
    const names = new Set<string>();
    const visited = new Set<string>();

    for (const configuredRoot of options.roots) {
      let root: string;
      try {
        root = await realpath(resolve(configuredRoot));
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") continue;
        warnings.push(
          `${configuredRoot} could not be scanned: ${errorMessage(error)}`,
        );
        continue;
      }
      const candidates = [
        ...(await childDirectories(root)),
        ...(await childDirectories(join(root, "plugins"))),
      ];
      for (const candidate of candidates) {
        let pluginRoot: string;
        try {
          pluginRoot = await realpath(candidate);
          if (!isWithin(root, pluginRoot) || visited.has(pluginRoot)) continue;
          visited.add(pluginRoot);
          const plugin = await loadPlugin(pluginRoot);
          if (!plugin) continue;
          if (names.has(plugin.name)) {
            warnings.push(
              `${plugin.manifestPath} was skipped because plugin ${plugin.name} is already registered`,
            );
            continue;
          }
          names.add(plugin.name);
          plugins.push(plugin);
        } catch (error) {
          if (isNodeError(error) && error.code === "ENOENT") continue;
          warnings.push(`${candidate} could not be loaded: ${errorMessage(error)}`);
        }
      }
    }
    return new SkillsOnlyPluginRegistry(plugins, warnings);
  }

  static fromSnapshot(
    value: PluginRegistrySnapshot,
  ): SkillsOnlyPluginRegistry {
    validatePluginRegistrySnapshot(value);
    return new SkillsOnlyPluginRegistry(
      value.plugins.map((plugin) => ({ ...plugin })),
      [...value.warnings],
    );
  }

  snapshot(): PluginRegistrySnapshot {
    return {
      version: 1,
      plugins: this.plugins.map((plugin) => ({ ...plugin })),
      warnings: [...this.warnings],
    };
  }

  skillSources(): SkillSource[] {
    return this.plugins.map((plugin) => ({
      scope: "plugin",
      root: plugin.skillsPath,
      namespace: plugin.name,
      plugin: {
        name: plugin.name,
        version: plugin.version,
      },
    }));
  }
}

export function validatePluginRegistrySnapshot(
  value: unknown,
): asserts value is PluginRegistrySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plugin registry snapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.plugins) ||
    !Array.isArray(snapshot.warnings) ||
    !snapshot.warnings.every((warning) => typeof warning === "string")
  ) {
    throw new Error("Plugin registry snapshot has an unsupported format");
  }
  for (const value of snapshot.plugins) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Plugin registry snapshot contains an invalid plugin");
    }
    const plugin = value as Record<string, unknown>;
    if (
      typeof plugin.name !== "string" ||
      typeof plugin.version !== "string" ||
      typeof plugin.description !== "string" ||
      typeof plugin.path !== "string" ||
      typeof plugin.manifestPath !== "string" ||
      typeof plugin.skillsPath !== "string" ||
      typeof plugin.hash !== "string"
    ) {
      throw new Error("Plugin registry snapshot contains an invalid plugin");
    }
  }
}

async function loadPlugin(
  pluginRoot: string,
): Promise<SkillsOnlyPlugin | undefined> {
  const configuredManifestPath = join(
    pluginRoot,
    ".codex-plugin",
    "plugin.json",
  );
  let manifestPath: string;
  let source: string;
  try {
    manifestPath = await realpath(configuredManifestPath);
    if (!isWithin(pluginRoot, manifestPath)) {
      throw new Error(
        `${configuredManifestPath} resolves outside the plugin root`,
      );
    }
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  const value = JSON.parse(source) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${manifestPath} must contain a JSON object`);
  }
  const manifest = value as Record<string, unknown>;
  const name = requireString(manifest.name, "name", manifestPath);
  const version = requireString(manifest.version, "version", manifestPath);
  const description = requireString(
    manifest.description,
    "description",
    manifestPath,
  );
  const skills = requireString(manifest.skills, "skills", manifestPath);
  if (!PLUGIN_NAME_PATTERN.test(name) || name.length > 64) {
    throw new Error(`${manifestPath} has an invalid plugin name`);
  }
  if (basename(pluginRoot) !== name) {
    throw new Error(`${manifestPath} plugin name must match its folder`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${manifestPath} has an invalid semantic version`);
  }
  for (const unsupported of ["mcpServers", "apps", "hooks"]) {
    if (manifest[unsupported] !== undefined) {
      throw new Error(
        `${manifestPath} declares unsupported ${unsupported}; Threadlight currently accepts skills-only plugins`,
      );
    }
  }
  if (!skills.startsWith("./")) {
    throw new Error(`${manifestPath} skills path must start with ./`);
  }
  const skillsPath = await realpath(resolve(pluginRoot, skills));
  if (
    !isWithin(pluginRoot, skillsPath) ||
    !(await stat(skillsPath)).isDirectory()
  ) {
    throw new Error(`${manifestPath} skills path leaves the plugin root`);
  }
  return {
    name,
    version,
    description,
    path: pluginRoot,
    manifestPath,
    skillsPath,
    hash: createHash("sha256").update(source).digest("hex"),
  };
}

async function childDirectories(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(root, entry.name));
}

function requireString(
  value: unknown,
  field: string,
  path: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} requires a non-empty ${field}`);
  }
  return value.trim();
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
