import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { ProjectMemoryStore } from "@threadlight/project-memory";

import type {
  DesktopProject,
  DesktopSearchMode,
  DesktopSearchResult,
} from "../shared/desktop-api.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const INTERNAL_IGNORED_PATH_PREFIXES = [".threadlight/conversations/"];
const FALLBACK_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".threadlight",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "venv",
]);

interface SearchRequest {
  project: DesktopProject;
  workspacePath: string;
  query: string;
  mode: DesktopSearchMode;
  limit: number;
}

interface RankedResult {
  result: DesktopSearchResult;
  score: number;
  order: number;
}

interface StoredActivity {
  id: string;
  name: string;
  status?: string;
  detail?: string;
  process?: {
    command?: string;
    cwd?: string;
    stdout?: string;
    stderr?: string;
  };
}

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  progress?: readonly {
    text?: string;
    activities?: readonly StoredActivity[];
  }[];
  activities?: readonly StoredActivity[];
}

interface ConversationMessages {
  conversation: DesktopProject["conversations"][number];
  messages: readonly StoredMessage[];
}

export class ProjectSearchService {
  private readonly fileCache = new Map<
    string,
    { expiresAt: number; paths: Promise<readonly string[]> }
  >();
  private readonly conversationCache = new Map<
    string,
    {
      fingerprint: string;
      expiresAt: number;
      conversations: Promise<readonly ConversationMessages[]>;
    }
  >();

  async search(request: SearchRequest): Promise<readonly DesktopSearchResult[]> {
    const query = normalizeQuery(request.query);
    if (request.mode === "files") {
      return this.searchFiles(
        request.project.id,
        request.workspacePath,
        query,
        request.limit,
      );
    }
    if (!query) return [];

    const [conversations, memory, files] = await Promise.all([
      this.searchConversations(request.project, query),
      this.searchMemory(request.project, query),
      this.searchFiles(
        request.project.id,
        request.workspacePath,
        query,
        request.limit,
      ),
    ]);
    const ranked = [
      ...conversations,
      ...memory,
      ...files.map((result, order) => ({
        result,
        score: matchScore(result.title, query) + 180,
        order,
      })),
    ];
    return ranked
      .sort(compareRankedResults)
      .slice(0, request.limit)
      .map(({ result }) => result);
  }

  private async searchConversations(
    project: DesktopProject,
    query: string,
  ): Promise<RankedResult[]> {
    const results: RankedResult[] = [];
    let order = 0;
    const conversations = await this.conversations(project);
    for (const { conversation, messages } of conversations) {
      for (const message of messages) {
        const searchableMessage = [
          message.text,
          ...(message.progress?.map((step) => step.text ?? "") ?? []),
        ]
          .filter(Boolean)
          .join("\n");
        const messageScore = matchScore(searchableMessage, query);
        if (messageScore >= 0) {
          results.push({
            score: messageScore + 520,
            order: order++,
            result: {
              id: `message:${conversation.id}:${message.id}`,
              kind: "message",
              projectId: project.id,
              threadId: conversation.id,
              messageId: message.id,
              title: conversation.title,
              subtitle: message.role,
              snippet: matchingSnippet(searchableMessage, query),
            },
          });
        }

        for (const activity of messageActivities(message)) {
          const toolText = [activity.name, activity.detail]
            .filter(Boolean)
            .join("\n");
          const toolScore = matchScore(toolText, query);
          if (toolScore >= 0) {
            results.push({
              score: toolScore + 400,
              order: order++,
              result: {
                id: `tool:${conversation.id}:${message.id}:${activity.id}`,
                kind: "tool",
                projectId: project.id,
                threadId: conversation.id,
                messageId: message.id,
                activityId: activity.id,
                title: activity.name,
                subtitle: conversation.title,
                snippet: matchingSnippet(
                  activity.detail || activity.name,
                  query,
                ),
              },
            });
          }

          if (!activity.process) continue;
          const commandText = [
            activity.process.command,
            activity.process.cwd,
            activity.process.stdout,
            activity.process.stderr,
          ]
            .filter(Boolean)
            .join("\n");
          const commandScore = matchScore(commandText, query);
          if (commandScore < 0) continue;
          results.push({
            score: commandScore + 460,
            order: order++,
            result: {
              id: `command:${conversation.id}:${message.id}:${activity.id}`,
              kind: "command",
              projectId: project.id,
              threadId: conversation.id,
              messageId: message.id,
              activityId: activity.id,
              title: activity.process.command || activity.name,
              subtitle: conversation.title,
              snippet: matchingSnippet(commandText, query),
            },
          });
        }
      }
    }
    return results;
  }

  private async searchMemory(
    project: DesktopProject,
    query: string,
  ): Promise<RankedResult[]> {
    let content: string;
    let path: string;
    try {
      const memory = await new ProjectMemoryStore(project.basePath).read();
      content = memory.content;
      path = memory.path;
    } catch {
      return [];
    }

    return content.split(/\r?\n/).flatMap((line, index) => {
      const score = matchScore(line, query);
      if (score < 0) return [];
      return [
        {
          score: score + 440,
          order: index,
          result: {
            id: `memory:${index + 1}`,
            kind: "memory" as const,
            projectId: project.id,
            path,
            line: index + 1,
            title: path,
            subtitle: project.name,
            snippet: matchingSnippet(line, query),
          },
        },
      ];
    });
  }

  private async searchFiles(
    projectId: string,
    workspacePath: string,
    query: string,
    limit: number,
  ): Promise<readonly DesktopSearchResult[]> {
    const paths = await this.workspaceFiles(workspacePath);
    return paths
      .flatMap((path, order) => {
        const score = query ? matchScore(path, query) : 0;
        return score < 0 ? [] : [{ path, score, order }];
      })
      .sort((left, right) =>
        right.score - left.score ||
        left.path.length - right.path.length ||
        left.order - right.order,
      )
      .slice(0, limit)
      .map(({ path }) => ({
        id: `file:${path}`,
        kind: "file" as const,
        projectId,
        path,
        title: path,
        subtitle: basename(path),
        snippet: path,
      }));
  }

  private workspaceFiles(
    workspacePath: string,
  ): Promise<readonly string[]> {
    const key = resolve(workspacePath);
    const cached = this.fileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.paths;
    const paths = workspaceFiles(key).catch((error) => {
      this.fileCache.delete(key);
      throw error;
    });
    this.fileCache.set(key, {
      expiresAt: Date.now() + 2_000,
      paths,
    });
    return paths;
  }

  private conversations(
    project: DesktopProject,
  ): Promise<readonly ConversationMessages[]> {
    const fingerprint = project.conversations
      .map(({ id, updatedAt }) => `${id}:${updatedAt}`)
      .join("\n");
    const cached = this.conversationCache.get(project.basePath);
    if (
      cached?.fingerprint === fingerprint &&
      cached.expiresAt > Date.now()
    ) {
      return cached.conversations;
    }
    const conversations = Promise.all(
      project.conversations.map(async (conversation) => ({
        conversation,
        messages: await readConversationMessages(
          project.basePath,
          conversation.id,
        ),
      })),
    ).catch((error) => {
      this.conversationCache.delete(project.basePath);
      throw error;
    });
    this.conversationCache.set(project.basePath, {
      fingerprint,
      expiresAt: Date.now() + 1_000,
      conversations,
    });
    return conversations;
  }
}

export function matchScore(value: string, normalizedQuery: string): number {
  const normalized = value.toLocaleLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    const index = normalized.indexOf(token);
    if (index < 0) return -1;
    score += Math.max(0, 160 - index);
    if (normalized === token) score += 600;
    else if (normalized.startsWith(token)) score += 260;
    else if (
      index === 0 ||
      /[/_\-.\s]/.test(normalized.charAt(index - 1))
    ) {
      score += 120;
    }
  }
  return score - Math.min(value.length, 400) / 20;
}

export function matchingSnippet(
  value: string,
  normalizedQuery: string,
  maxLength = 180,
): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const firstToken = normalizedQuery.split(/\s+/).find(Boolean) ?? "";
  const match = compact.toLocaleLowerCase().indexOf(firstToken);
  const start = Math.max(0, match - Math.floor(maxLength * 0.32));
  const end = Math.min(compact.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end).trim()}${
    end < compact.length ? "…" : ""
  }`;
}

async function readConversationMessages(
  projectPath: string,
  threadId: string,
): Promise<readonly StoredMessage[]> {
  if (!threadId || basename(threadId) !== threadId || !/^[\w-]+$/.test(threadId)) {
    return [];
  }
  const path = join(
    projectPath,
    ".threadlight",
    "conversations",
    `${threadId}.json`,
  );
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return [];
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(value) || !Array.isArray(value.messages)) return [];
    return value.messages.filter(isStoredMessage);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    return [];
  }
}

function messageActivities(message: StoredMessage): readonly StoredActivity[] {
  const activities = [
    ...(message.progress?.flatMap((step) => step.activities ?? []) ?? []),
    ...(message.activities ?? []),
  ];
  return [...new Map(activities.map((activity) => [activity.id, activity])).values()];
}

async function workspaceFiles(workspacePath: string): Promise<readonly string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
      {
        cwd: workspacePath,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
      },
    );
    return validateWorkspaceFiles(
      workspacePath,
      stdout.split("\0").filter(Boolean),
    );
  } catch {
    return fallbackWorkspaceFiles(workspacePath);
  }
}

async function validateWorkspaceFiles(
  workspacePath: string,
  paths: readonly string[],
): Promise<readonly string[]> {
  const safe = await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const normalized = normalizeRelativePath(path);
      if (
        !normalized ||
        INTERNAL_IGNORED_PATH_PREFIXES.some((prefix) =>
          normalized.startsWith(prefix),
        )
      ) {
        return;
      }
      const absolute = resolve(workspacePath, normalized);
      if (!isInside(workspacePath, absolute)) return;
      try {
        const metadata = await lstat(absolute);
        return metadata.isFile() && !metadata.isSymbolicLink()
          ? normalized
          : undefined;
      } catch {
        return;
      }
    }),
  );
  return safe.filter((path): path is string => Boolean(path)).sort();
}

async function fallbackWorkspaceFiles(
  workspacePath: string,
): Promise<readonly string[]> {
  const root = resolve(workspacePath);
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (
        entry.isDirectory() &&
        !FALLBACK_IGNORED_DIRECTORIES.has(entry.name)
      ) {
        await visit(absolute);
      } else if (entry.isFile()) {
        paths.push(normalizeRelativePath(relative(root, absolute)));
      }
    }
  }

  await visit(root);
  return paths.sort();
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/").replace(/^\.\//, "");
}

function isInside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith("/"))
  );
}

function compareRankedResults(left: RankedResult, right: RankedResult): number {
  return right.score - left.score || left.order - right.order;
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.text === "string"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
