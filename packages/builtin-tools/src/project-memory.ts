import { randomBytes } from "node:crypto";

import { defineTool, type Tool } from "@threadlight/agent-loop";
import {
  PROJECT_MEMORY_MAX_CHARS,
  ProjectMemoryStore,
  type ProjectMemorySnapshot,
} from "@threadlight/project-memory";

export interface ProjectMemoryToolOptions {
  store: ProjectMemoryStore;
  tokenFactory?: () => string;
}

interface ProjectMemoryToolArguments {
  action: "read" | "write";
  content: string | null;
  read_token: string | null;
}

export function createProjectMemoryTool(
  options: ProjectMemoryToolOptions,
): Tool {
  const latestReads = new Map<
    string,
    { runId: string; token: string; revision: string }
  >();
  const tokenFactory = options.tokenFactory ?? createReadToken;

  return defineTool({
    name: "project_memory",
    description:
      "Read or replace the project's durable Markdown memory at .threadlight/MEMORY.md. Before writing, read the latest file and pass the short read_token exactly as returned; the token is scoped to this task and consumed by one write. Keep memory concise, specific, and useful across future tasks; revise duplicates and stale entries. Never store secrets, transient task status, chat transcripts, or unverified assumptions.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "write"],
          description: "Read the current memory or replace the full Markdown file.",
        },
        content: {
          type: ["string", "null"],
          description:
            "For write, the complete updated Markdown. For read, null.",
        },
        read_token: {
          type: ["string", "null"],
          description:
            "For write, the short token returned by the latest read in this task. For read, null.",
        },
      },
      required: ["action", "content", "read_token"],
      additionalProperties: false,
    },
    async execute(arguments_, context) {
      const parsed = parseArguments(arguments_);
      const scope = context.scopeId ?? context.runId;
      if (parsed.action === "read") {
        const snapshot = await options.store.read();
        const token = tokenFactory();
        latestReads.set(scope, {
          runId: context.runId,
          token,
          revision: snapshot.revision,
        });
        return readToolSnapshot(snapshot, token);
      }
      const latest = latestReads.get(scope);
      if (
        !latest ||
        latest.runId !== context.runId ||
        latest.token !== parsed.read_token
      ) {
        throw new Error(
          "read_token is invalid or expired; read project memory again before writing",
        );
      }
      latestReads.delete(scope);
      return writeToolSnapshot(
        await options.store.write(parsed.content, latest.revision),
      );
    },
  });
}

function parseArguments(value: unknown):
  | {
      action: "read";
      content: null;
      read_token: null;
    }
  | {
      action: "write";
      content: string;
      read_token: string;
    } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  const arguments_ = value as Partial<ProjectMemoryToolArguments>;

  if (arguments_.action === "read") {
    if (arguments_.content !== null || arguments_.read_token !== null) {
      throw new Error("read requires null content and read_token");
    }
    return { action: "read", content: null, read_token: null };
  }
  if (arguments_.action === "write") {
    if (typeof arguments_.content !== "string") {
      throw new Error("write requires string content");
    }
    if (
      typeof arguments_.read_token !== "string" ||
      arguments_.read_token.length === 0
    ) {
      throw new Error("write requires a non-empty read_token");
    }
    return {
      action: "write",
      content: arguments_.content,
      read_token: arguments_.read_token,
    };
  }

  throw new Error("action must be read or write");
}

function readToolSnapshot(snapshot: ProjectMemorySnapshot, readToken: string) {
  return {
    ...sharedToolSnapshot(snapshot),
    read_token: readToken,
  };
}

function writeToolSnapshot(snapshot: ProjectMemorySnapshot) {
  return sharedToolSnapshot(snapshot);
}

function sharedToolSnapshot(snapshot: ProjectMemorySnapshot) {
  if (snapshot.content.length > PROJECT_MEMORY_MAX_CHARS) {
    throw new Error(
      `Project memory exceeds ${PROJECT_MEMORY_MAX_CHARS} characters; compact it in an editor before using project_memory`,
    );
  }
  return {
    path: snapshot.path,
    content: snapshot.content,
  };
}

function createReadToken(): string {
  return `mem_${randomBytes(6).toString("base64url")}`;
}
