import { defineTool, type Tool } from "@threadlight/agent-loop";
import {
  PROJECT_MEMORY_MAX_CHARS,
  ProjectMemoryStore,
  type ProjectMemorySnapshot,
} from "@threadlight/project-memory";

export interface ProjectMemoryToolOptions {
  store: ProjectMemoryStore;
  needsApproval?: Tool["needsApproval"];
}

interface ProjectMemoryToolArguments {
  action: "read" | "write";
  content: string | null;
  expected_revision: string | null;
}

export function createProjectMemoryTool(
  options: ProjectMemoryToolOptions,
): Tool {
  return defineTool({
    name: "project_memory",
    description:
      "Read or replace the project's durable Markdown memory at .threadlight/MEMORY.md. Before writing, read the latest file and pass its revision. Keep memory concise, specific, and useful across future tasks; revise duplicates and stale entries. Never store secrets, transient task status, chat transcripts, or unverified assumptions.",
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
        expected_revision: {
          type: ["string", "null"],
          description:
            "For write, the revision returned by the latest read. For read, null.",
        },
      },
      required: ["action", "content", "expected_revision"],
      additionalProperties: false,
    },
    needsApproval: options.needsApproval ?? false,
    async execute(arguments_) {
      const parsed = parseArguments(arguments_);
      if (parsed.action === "read") {
        return toolSnapshot(await options.store.read());
      }
      return toolSnapshot(
        await options.store.write(parsed.content, parsed.expected_revision),
      );
    },
  });
}

function parseArguments(value: unknown):
  | {
      action: "read";
      content: null;
      expected_revision: null;
    }
  | {
      action: "write";
      content: string;
      expected_revision: string;
    } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("arguments must be an object");
  }
  const arguments_ = value as Partial<ProjectMemoryToolArguments>;

  if (arguments_.action === "read") {
    if (arguments_.content !== null || arguments_.expected_revision !== null) {
      throw new Error("read requires null content and expected_revision");
    }
    return { action: "read", content: null, expected_revision: null };
  }
  if (arguments_.action === "write") {
    if (typeof arguments_.content !== "string") {
      throw new Error("write requires string content");
    }
    if (
      typeof arguments_.expected_revision !== "string" ||
      arguments_.expected_revision.length === 0
    ) {
      throw new Error("write requires a non-empty expected_revision");
    }
    return {
      action: "write",
      content: arguments_.content,
      expected_revision: arguments_.expected_revision,
    };
  }

  throw new Error("action must be read or write");
}

function toolSnapshot(snapshot: ProjectMemorySnapshot) {
  if (snapshot.content.length > PROJECT_MEMORY_MAX_CHARS) {
    throw new Error(
      `Project memory exceeds ${PROJECT_MEMORY_MAX_CHARS} characters; compact it in an editor before using project_memory`,
    );
  }
  return {
    path: snapshot.path,
    content: snapshot.content,
    revision: snapshot.revision,
  };
}
