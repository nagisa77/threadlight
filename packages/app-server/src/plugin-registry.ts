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

import type { CapabilityVisibility } from "@threadlight/protocol";

import type { SkillSource } from "./skill-registry.js";

const PLUGIN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONNECTOR_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PluginPresentation {
  icon?: string;
  visibility?: CapabilityVisibility;
  keywords?: readonly string[];
}

export interface PluginOAuthConfig {
  clientId?: string;
  clientIdEnv?: string;
  clientSecretRequired?: boolean;
  scopes?: readonly string[];
}

export interface PluginErrorGuidance {
  includes: string;
  message: string;
  code: string;
  retryable: boolean;
  helpUrl?: string;
}

export interface PluginMcpServer {
  id: string;
  version: string;
  name: string;
  description: string;
  transport: "streamable_http";
  url?: string;
  urlEnv?: string;
  oauth?: PluginOAuthConfig;
  errorGuidance?: readonly PluginErrorGuidance[];
  presentation?: PluginPresentation;
}

export interface Plugin {
  name: string;
  version: string;
  description: string;
  path: string;
  manifestPath: string;
  skillsPath?: string;
  mcpServers: readonly PluginMcpServer[];
  presentation?: PluginPresentation;
  hash: string;
}

export interface PluginConnectorSnapshot {
  id: string;
  version: string;
}

export interface PluginSnapshotV2 {
  name: string;
  version: string;
  description: string;
  path: string;
  manifestPath: string;
  skillsPath?: string;
  connectors: readonly PluginConnectorSnapshot[];
  hash: string;
}

export interface PluginRegistrySnapshotV2 {
  version: 2;
  plugins: readonly PluginSnapshotV2[];
  warnings: readonly string[];
}

interface LegacySkillsOnlyPlugin {
  name: string;
  version: string;
  description: string;
  path: string;
  manifestPath: string;
  skillsPath: string;
  hash: string;
}

interface PluginRegistrySnapshotV1 {
  version: 1;
  plugins: readonly LegacySkillsOnlyPlugin[];
  warnings: readonly string[];
}

export type PluginRegistrySnapshot =
  | PluginRegistrySnapshotV1
  | PluginRegistrySnapshotV2;

export interface DiscoverPluginsOptions {
  roots: readonly string[];
  environment?: NodeJS.ProcessEnv;
}

export class PluginRegistry {
  private constructor(
    readonly plugins: readonly Plugin[],
    readonly warnings: readonly string[],
  ) {}

  static async discover(
    options: DiscoverPluginsOptions,
  ): Promise<PluginRegistry> {
    const plugins: Plugin[] = [];
    const warnings: string[] = [];
    const names = new Set<string>();
    const connectorIds = new Set<string>();
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
          const plugin = await loadPlugin(
            pluginRoot,
            options.environment ?? process.env,
          );
          if (!plugin) continue;
          if (names.has(plugin.name)) {
            warnings.push(
              `${plugin.manifestPath} was skipped because plugin ${plugin.name} is already registered`,
            );
            continue;
          }
          const duplicateConnector = plugin.mcpServers.find(({ id }) =>
            connectorIds.has(id),
          );
          if (duplicateConnector) {
            warnings.push(
              `${plugin.manifestPath} was skipped because connector ${duplicateConnector.id} is already registered`,
            );
            continue;
          }
          names.add(plugin.name);
          for (const server of plugin.mcpServers) connectorIds.add(server.id);
          plugins.push(plugin);
        } catch (error) {
          if (isNodeError(error) && error.code === "ENOENT") continue;
          warnings.push(`${candidate} could not be loaded: ${errorMessage(error)}`);
        }
      }
    }
    return new PluginRegistry(plugins, warnings);
  }

  static async fromSnapshot(
    value: PluginRegistrySnapshot,
    environment: NodeJS.ProcessEnv = process.env,
  ): Promise<PluginRegistry> {
    validatePluginRegistrySnapshot(value);
    const plugins: Plugin[] = [];
    const warnings = [...value.warnings];
    for (const snapshot of value.plugins) {
      try {
        const plugin = await loadPlugin(snapshot.path, environment);
        if (!plugin) {
          warnings.push(`${snapshot.path} is no longer an installed plugin`);
          continue;
        }
        if (
          plugin.name !== snapshot.name ||
          plugin.version !== snapshot.version ||
          (plugin.hash !== snapshot.hash &&
            !(
              value.version === 1 &&
              (await legacyManifestHash(plugin.manifestPath)) ===
                snapshot.hash
            ))
        ) {
          warnings.push(
            `${snapshot.name}@${snapshot.version} changed since this task was created and was not restored`,
          );
          continue;
        }
        plugins.push(plugin);
      } catch (error) {
        warnings.push(
          `${snapshot.path} could not be restored: ${errorMessage(error)}`,
        );
      }
    }
    return new PluginRegistry(plugins, warnings);
  }

  snapshot(): PluginRegistrySnapshotV2 {
    return {
      version: 2,
      plugins: this.plugins.map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        path: plugin.path,
        manifestPath: plugin.manifestPath,
        ...(plugin.skillsPath ? { skillsPath: plugin.skillsPath } : {}),
        connectors: plugin.mcpServers.map(({ id, version }) => ({
          id,
          version,
        })),
        hash: plugin.hash,
      })),
      warnings: [...this.warnings],
    };
  }

  skillSources(): SkillSource[] {
    return this.plugins.flatMap((plugin) =>
      plugin.skillsPath
        ? [
            {
              scope: "plugin" as const,
              root: plugin.skillsPath,
              namespace: plugin.name,
              plugin: {
                name: plugin.name,
                version: plugin.version,
              },
            },
          ]
        : [],
    );
  }

  mcpServers(): Array<{
    plugin: Plugin;
    server: PluginMcpServer;
  }> {
    return this.plugins.flatMap((plugin) =>
      plugin.mcpServers.map((server) => ({ plugin, server })),
    );
  }
}

async function legacyManifestHash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path, "utf8"))
    .digest("hex");
}

/** @deprecated Use PluginRegistry. Kept for source compatibility. */
export const SkillsOnlyPluginRegistry = PluginRegistry;
/** @deprecated Use Plugin. */
export type SkillsOnlyPlugin = Plugin;

export function validatePluginRegistrySnapshot(
  value: unknown,
): asserts value is PluginRegistrySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plugin registry snapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  if (
    (snapshot.version !== 1 && snapshot.version !== 2) ||
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
      typeof plugin.hash !== "string" ||
      (plugin.skillsPath !== undefined &&
        typeof plugin.skillsPath !== "string")
    ) {
      throw new Error("Plugin registry snapshot contains an invalid plugin");
    }
    if (
      snapshot.version === 2 &&
      (!Array.isArray(plugin.connectors) ||
        !plugin.connectors.every(isConnectorSnapshot))
    ) {
      throw new Error(
        "Plugin registry snapshot contains invalid connector state",
      );
    }
  }
}

async function loadPlugin(
  pluginRoot: string,
  environment: NodeJS.ProcessEnv,
): Promise<Plugin | undefined> {
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
  if (!isObject(value)) {
    throw new Error(`${manifestPath} must contain a JSON object`);
  }
  const name = requireString(value.name, "name", manifestPath);
  const version = requireString(value.version, "version", manifestPath);
  const description = requireString(
    value.description,
    "description",
    manifestPath,
  );
  if (!PLUGIN_NAME_PATTERN.test(name) || name.length > 64) {
    throw new Error(`${manifestPath} has an invalid plugin name`);
  }
  if (basename(pluginRoot) !== name) {
    throw new Error(`${manifestPath} plugin name must match its folder`);
  }
  validateVersion(version, manifestPath);

  let skillsPath: string | undefined;
  if (value.skills !== undefined) {
    const skills = requireString(value.skills, "skills", manifestPath);
    if (!skills.startsWith("./")) {
      throw new Error(`${manifestPath} skills path must start with ./`);
    }
    skillsPath = await realpath(resolve(pluginRoot, skills));
    if (
      !isWithin(pluginRoot, skillsPath) ||
      !(await stat(skillsPath)).isDirectory()
    ) {
      throw new Error(`${manifestPath} skills path leaves the plugin root`);
    }
  }

  let mcpServers: readonly PluginMcpServer[] = [];
  let mcpSource = "";
  if (value.mcpServers !== undefined) {
    const configuredPath = requireString(
      value.mcpServers,
      "mcpServers",
      manifestPath,
    );
    if (!configuredPath.startsWith("./")) {
      throw new Error(`${manifestPath} mcpServers path must start with ./`);
    }
    const mcpPath = await realpath(resolve(pluginRoot, configuredPath));
    if (!isWithin(pluginRoot, mcpPath)) {
      throw new Error(`${manifestPath} mcpServers path leaves the plugin root`);
    }
    mcpSource = await readFile(mcpPath, "utf8");
    mcpServers = parseMcpServers(
      JSON.parse(mcpSource) as unknown,
      mcpPath,
      version,
      environment,
    );
  }
  if (!skillsPath && mcpServers.length === 0) {
    throw new Error(
      `${manifestPath} must declare skills or at least one MCP server`,
    );
  }
  for (const unsupported of ["apps", "hooks"]) {
    if (value[unsupported] !== undefined) {
      throw new Error(
        `${manifestPath} declares unsupported ${unsupported}`,
      );
    }
  }
  const presentation = parsePresentation(value.presentation, manifestPath);
  return {
    name,
    version,
    description,
    path: pluginRoot,
    manifestPath,
    ...(skillsPath ? { skillsPath } : {}),
    mcpServers,
    ...(presentation ? { presentation } : {}),
    hash: createHash("sha256")
      .update(source)
      .update("\0")
      .update(mcpSource)
      .digest("hex"),
  };
}

function parseMcpServers(
  value: unknown,
  path: string,
  pluginVersion: string,
  environment: NodeJS.ProcessEnv,
): readonly PluginMcpServer[] {
  if (!isObject(value) || !Array.isArray(value.servers)) {
    throw new Error(`${path} must contain a servers array`);
  }
  const ids = new Set<string>();
  return value.servers.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${path} server ${index + 1} must be an object`);
    }
    const id = requireString(entry.id, "id", path);
    if (
      !CONNECTOR_ID_PATTERN.test(id) ||
      id.length > 64 ||
      ids.has(id)
    ) {
      throw new Error(`${path} has an invalid or duplicate connector id`);
    }
    ids.add(id);
    const transport = requireString(entry.transport, "transport", path);
    if (transport !== "streamable_http") {
      throw new Error(
        `${path} connector ${id} must use streamable_http transport`,
      );
    }
    const url = optionalString(entry.url);
    const urlEnv = optionalString(entry.urlEnv);
    if (url && urlEnv) {
      throw new Error(`${path} connector ${id} cannot set url and urlEnv`);
    }
    const resolvedUrl =
      url ?? (urlEnv ? optionalString(environment[urlEnv]) : undefined);
    if (resolvedUrl) validateRemoteUrl(resolvedUrl, path, id);
    const oauth = parseOAuthConfig(entry.oauth, path, id, environment);
    const errorGuidance = parseErrorGuidance(entry.errorGuidance, path, id);
    const presentation = parsePresentation(entry.presentation, path);
    return {
      id,
      version: optionalString(entry.version) ?? pluginVersion,
      name: requireString(entry.name, "name", path),
      description: requireString(entry.description, "description", path),
      transport: "streamable_http" as const,
      ...(resolvedUrl ? { url: resolvedUrl } : {}),
      ...(urlEnv ? { urlEnv } : {}),
      ...(oauth ? { oauth } : {}),
      ...(errorGuidance ? { errorGuidance } : {}),
      ...(presentation ? { presentation } : {}),
    };
  });
}

function parseOAuthConfig(
  value: unknown,
  path: string,
  id: string,
  environment: NodeJS.ProcessEnv,
): PluginOAuthConfig | undefined {
  if (value === undefined) return;
  if (!isObject(value)) {
    throw new Error(`${path} connector ${id} oauth must be an object`);
  }
  const clientIdEnv = optionalString(value.clientIdEnv);
  const configuredClientId = optionalString(value.clientId);
  const clientId =
    configuredClientId ??
    (clientIdEnv ? optionalString(environment[clientIdEnv]) : undefined);
  const scopes =
    value.scopes === undefined
      ? undefined
      : requireStringArray(value.scopes, `${path} connector ${id} scopes`);
  const clientSecretRequired =
    value.clientSecretRequired === undefined
      ? undefined
      : requireBoolean(
          value.clientSecretRequired,
          `${path} connector ${id} clientSecretRequired`,
        );
  return {
    ...(clientId ? { clientId } : {}),
    ...(clientIdEnv ? { clientIdEnv } : {}),
    ...(clientSecretRequired !== undefined
      ? { clientSecretRequired }
      : {}),
    ...(scopes ? { scopes } : {}),
  };
}

function parseErrorGuidance(
  value: unknown,
  path: string,
  id: string,
): readonly PluginErrorGuidance[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error(
      `${path} connector ${id} errorGuidance must be a non-empty array with at most 20 entries`,
    );
  }
  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(
        `${path} connector ${id} errorGuidance ${index + 1} must be an object`,
      );
    }
    const includes = requireString(
      entry.includes,
      `errorGuidance ${index + 1} includes`,
      path,
    );
    const message = requireString(
      entry.message,
      `errorGuidance ${index + 1} message`,
      path,
    );
    const code = requireString(
      entry.code,
      `errorGuidance ${index + 1} code`,
      path,
    );
    if (includes.length > 512 || message.length > 4_000) {
      throw new Error(
        `${path} connector ${id} errorGuidance ${index + 1} is too long`,
      );
    }
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(code) || code.length > 96) {
      throw new Error(
        `${path} connector ${id} errorGuidance ${index + 1} has an invalid code`,
      );
    }
    const retryable = requireBoolean(
      entry.retryable,
      `${path} connector ${id} errorGuidance ${index + 1} retryable`,
    );
    const helpUrl = optionalString(entry.helpUrl);
    if (helpUrl) validateHelpUrl(helpUrl, path, id, index);
    return {
      includes,
      message,
      code,
      retryable,
      ...(helpUrl ? { helpUrl } : {}),
    };
  });
}

function parsePresentation(
  value: unknown,
  path: string,
): PluginPresentation | undefined {
  if (value === undefined) return;
  if (!isObject(value)) {
    throw new Error(`${path} presentation must be an object`);
  }
  const icon = optionalString(value.icon);
  const visibilityValue = optionalString(value.visibility);
  if (
    visibilityValue &&
    visibilityValue !== "featured" &&
    visibilityValue !== "search" &&
    visibilityValue !== "hidden"
  ) {
    throw new Error(`${path} has an invalid presentation visibility`);
  }
  const visibility = visibilityValue as CapabilityVisibility | undefined;
  const keywords =
    value.keywords === undefined
      ? undefined
      : requireStringArray(value.keywords, `${path} presentation keywords`);
  return {
    ...(icon ? { icon } : {}),
    ...(visibility ? { visibility } : {}),
    ...(keywords ? { keywords } : {}),
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function validateVersion(version: string, path: string): void {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${path} has an invalid semantic version`);
  }
}

function validateRemoteUrl(url: string, path: string, id: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${path} connector ${id} has an invalid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${path} connector ${id} URL must use HTTPS`);
  }
}

function validateHelpUrl(
  url: string,
  path: string,
  id: string,
  index: number,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${path} connector ${id} errorGuidance ${index + 1} has an invalid helpUrl`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `${path} connector ${id} errorGuidance ${index + 1} helpUrl must use HTTPS`,
    );
  }
}

function isConnectorSnapshot(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.version === "string"
  );
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
