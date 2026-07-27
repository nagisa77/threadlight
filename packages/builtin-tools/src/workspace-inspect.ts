import {
  readFile,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { defineTool, type Tool } from "@threadlight/agent-loop";

const DEFAULT_MAX_DEPTH = 2;
const MAX_DEPTH = 5;
const MAX_ENTRIES = 500;
const MAX_READ_LINES = 500;
const MAX_SEARCH_FILES = 1_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 1_000_000;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".threadlight",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

export interface WorkspaceInspectToolOptions {
  workspaceRoot?: string;
}

type WorkspaceInspectArguments =
  | { action: "list"; path?: string; max_depth?: number }
  | {
      action: "read";
      path: string;
      start_line?: number;
      end_line?: number;
    }
  | { action: "search"; path?: string; query: string };

export function createWorkspaceInspectTool(
  options: WorkspaceInspectToolOptions = {},
): Tool {
  const configuredRoot = resolve(options.workspaceRoot ?? process.cwd());

  return defineTool({
    name: "workspace_inspect",
    mutability: "read",
    description:
      "Safely inspect the configured workspace without changing it. List files, read a bounded line range, or search text literally. Generated and dependency directories are skipped.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "read", "search"],
        },
        path: {
          type: ["string", "null"],
          description:
            "Workspace-relative file or directory. Use null or omit for the workspace root.",
        },
        query: {
          type: ["string", "null"],
          description: "Literal case-insensitive search text for search.",
        },
        start_line: {
          type: ["integer", "null"],
          minimum: 1,
          description: "First 1-based line for read.",
        },
        end_line: {
          type: ["integer", "null"],
          minimum: 1,
          description: "Last 1-based line for read.",
        },
        max_depth: {
          type: ["integer", "null"],
          minimum: 1,
          maximum: MAX_DEPTH,
          description: "Directory depth for list.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(arguments_) {
      const root = await realpath(configuredRoot);
      const parsed = parseArguments(arguments_);
      if (parsed.action === "read") {
        return readWorkspaceFile(root, parsed);
      }
      const directory = await resolveInside(root, parsed.path ?? ".");
      if (!(await stat(directory)).isDirectory()) {
        throw new Error("path must resolve to a directory");
      }
      return parsed.action === "list"
        ? listWorkspace(root, directory, parsed.max_depth ?? DEFAULT_MAX_DEPTH)
        : searchWorkspace(root, directory, parsed.query);
    },
  });
}

async function listWorkspace(
  root: string,
  directory: string,
  maxDepth: number,
): Promise<{
  path: string;
  entries: readonly string[];
  truncated: boolean;
}> {
  const entries: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [
    { path: directory, depth: 0 },
  ];
  while (queue.length > 0 && entries.length < MAX_ENTRIES) {
    const current = queue.shift();
    if (!current) break;
    const children = await readdir(current.path, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (
        entries.length >= MAX_ENTRIES ||
        child.isSymbolicLink() ||
        (child.isDirectory() && IGNORED_DIRECTORIES.has(child.name))
      ) {
        continue;
      }
      const path = resolve(current.path, child.name);
      const display = workspacePath(root, path);
      entries.push(child.isDirectory() ? `${display}/` : display);
      if (child.isDirectory() && current.depth + 1 < maxDepth) {
        queue.push({ path, depth: current.depth + 1 });
      }
    }
  }
  return {
    path: workspacePath(root, directory),
    entries,
    truncated: queue.length > 0 || entries.length >= MAX_ENTRIES,
  };
}

async function readWorkspaceFile(
  root: string,
  arguments_: Extract<WorkspaceInspectArguments, { action: "read" }>,
): Promise<{
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  truncated: boolean;
}> {
  const path = await resolveInside(root, arguments_.path);
  if (!(await stat(path)).isFile()) {
    throw new Error("path must resolve to a file");
  }
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  const startLine = arguments_.start_line ?? 1;
  if (startLine > lines.length) {
    throw new Error("start_line exceeds the file length");
  }
  const requestedEnd = arguments_.end_line ?? startLine + MAX_READ_LINES - 1;
  if (requestedEnd < startLine) {
    throw new Error("end_line must be greater than or equal to start_line");
  }
  const endLine = Math.min(
    requestedEnd,
    startLine + MAX_READ_LINES - 1,
    lines.length,
  );
  return {
    path: workspacePath(root, path),
    startLine,
    endLine,
    totalLines: lines.length,
    content: lines.slice(startLine - 1, endLine).join("\n"),
    truncated: endLine < lines.length,
  };
}

async function searchWorkspace(
  root: string,
  directory: string,
  query: string,
): Promise<{
  path: string;
  query: string;
  matches: readonly { path: string; line: number; text: string }[];
  truncated: boolean;
}> {
  const normalizedQuery = query.toLocaleLowerCase();
  const matches: Array<{ path: string; line: number; text: string }> = [];
  const queue = [directory];
  let inspectedFiles = 0;
  while (
    queue.length > 0 &&
    inspectedFiles < MAX_SEARCH_FILES &&
    matches.length < MAX_SEARCH_RESULTS
  ) {
    const current = queue.shift();
    if (!current) break;
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (
        child.isSymbolicLink() ||
        (child.isDirectory() && IGNORED_DIRECTORIES.has(child.name))
      ) {
        continue;
      }
      const path = resolve(current, child.name);
      if (child.isDirectory()) {
        queue.push(path);
        continue;
      }
      if (!child.isFile() || inspectedFiles >= MAX_SEARCH_FILES) continue;
      inspectedFiles += 1;
      if ((await stat(path)).size > MAX_SEARCH_FILE_BYTES) continue;
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch {
        continue;
      }
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (!line.toLocaleLowerCase().includes(normalizedQuery)) continue;
        matches.push({
          path: workspacePath(root, path),
          line: index + 1,
          text: line.slice(0, 500),
        });
        if (matches.length >= MAX_SEARCH_RESULTS) break;
      }
    }
  }
  return {
    path: workspacePath(root, directory),
    query,
    matches,
    truncated:
      queue.length > 0 ||
      inspectedFiles >= MAX_SEARCH_FILES ||
      matches.length >= MAX_SEARCH_RESULTS,
  };
}

function parseArguments(value: unknown): WorkspaceInspectArguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  const arguments_ = value as Record<string, unknown>;
  const path = optionalString(arguments_.path, "path");
  if (arguments_.action === "list") {
    const maxDepth = optionalInteger(
      arguments_.max_depth,
      "max_depth",
      1,
      MAX_DEPTH,
    );
    return {
      action: "list",
      ...(path ? { path } : {}),
      ...(maxDepth ? { max_depth: maxDepth } : {}),
    };
  }
  if (arguments_.action === "read") {
    if (!path) throw new Error("read requires path");
    const startLine = optionalInteger(
      arguments_.start_line,
      "start_line",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const endLine = optionalInteger(
      arguments_.end_line,
      "end_line",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    return {
      action: "read",
      path,
      ...(startLine ? { start_line: startLine } : {}),
      ...(endLine ? { end_line: endLine } : {}),
    };
  }
  if (arguments_.action === "search") {
    const query = requiredString(arguments_.query, "query");
    return { action: "search", query, ...(path ? { path } : {}) };
  }
  throw new Error("action must be list, read, or search");
}

async function resolveInside(root: string, requested: string): Promise<string> {
  const candidate = await realpath(resolve(root, requested));
  const path = relative(root, candidate);
  if (
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error("path resolves outside the workspace");
  }
  return candidate;
}

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/") || ".";
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return;
  return requiredString(value, name);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null) return;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return Number(value);
}
