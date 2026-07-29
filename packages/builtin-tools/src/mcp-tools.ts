import { createHash } from "node:crypto";

import { defineTool, type Tool } from "@threadlight/agent-loop";

import {
  ConversationMcpRuntime,
  type McpConnectResult,
} from "./mcp-runtime.js";

export function createMcpConnectTool(
  runtime: ConversationMcpRuntime,
): Tool {
  return defineTool({
    name: "mcp_connect",
    description:
      "Connect to an exact MCP server supplied by the user or grounded in the workspace, then return its instructions and tool schemas. Never invent an endpoint or command. stdio commands may execute downloaded code.",
    parameters: {
      type: "object",
      properties: {
        transport: {
          type: "string",
          enum: ["stdio", "streamable_http"],
          description: "The MCP transport to use.",
        },
        command: {
          type: ["string", "null"],
          description: "Executable for a stdio MCP server; otherwise null.",
        },
        args: {
          type: ["array", "null"],
          items: { type: "string" },
          description: "Arguments for a stdio MCP server; otherwise null.",
        },
        cwd: {
          type: ["string", "null"],
          description:
            "Optional workspace-relative cwd for a stdio server; otherwise null.",
        },
        url: {
          type: ["string", "null"],
          description:
            "Streamable HTTP MCP endpoint URL; otherwise null. Remote URLs must use HTTPS.",
        },
      },
      required: ["transport", "command", "args", "cwd", "url"],
      additionalProperties: false,
    },
    execute(arguments_, context) {
      return runtime.connect(arguments_, context.signal);
    },
  });
}

export function createMcpCallTool(
  runtime: ConversationMcpRuntime,
): Tool {
  return defineTool({
    name: "mcp_call",
    description:
      "Call one tool advertised by a previous mcp_connect result. Use the exact connection_id, tool name, and input schema returned by that result.",
    parameters: {
      type: "object",
      properties: {
        connection_id: {
          type: "string",
          minLength: 1,
          description: "Opaque connection id returned by mcp_connect.",
        },
        tool_name: {
          type: "string",
          minLength: 1,
          description: "Exact MCP tool name returned by mcp_connect.",
        },
        arguments: {
          type: "object",
          additionalProperties: true,
          description: "Arguments matching the MCP tool inputSchema.",
        },
      },
      required: ["connection_id", "tool_name", "arguments"],
      additionalProperties: false,
    },
    execute(arguments_, context) {
      return runtime.call(arguments_, context.signal);
    },
  });
}

export function createMcpCapabilityTools(
  runtime: ConversationMcpRuntime,
  capabilityId: string,
  connection: McpConnectResult,
): Tool[] {
  const names = new Set<string>();
  return connection.tools.map((tool) => {
    const name = uniqueToolName(capabilityId, tool.name, names);
    names.add(name);
    return defineTool({
      name,
      description:
        tool.description ??
        `Call ${tool.name} from the selected ${capabilityId} MCP capability.`,
      parameters: tool.inputSchema,
      mutability:
        tool.annotations?.readOnlyHint === true &&
        tool.annotations?.destructiveHint !== true
          ? "read"
          : "write",
      impact: {
        destructive:
          tool.annotations?.destructiveHint === true ||
          (tool.annotations?.readOnlyHint !== true &&
            tool.annotations?.destructiveHint !== false),
        external: tool.annotations?.openWorldHint !== false,
      },
      execute(arguments_, context) {
        if (!isObject(arguments_)) {
          throw new Error(`${name} arguments must be an object`);
        }
        return runtime.call(
          {
            connection_id: connection.connectionId,
            tool_name: tool.name,
            arguments: arguments_,
          },
          context.signal,
        );
      },
    });
  });
}

function uniqueToolName(
  capabilityId: string,
  remoteName: string,
  existing: ReadonlySet<string>,
): string {
  const prefix = normalizeToolName(capabilityId);
  const suffix = normalizeToolName(remoteName);
  const base = `${prefix}__${suffix}`;
  let candidate =
    base.length <= 64
      ? base
      : `${base.slice(0, 55)}_${shortHash(base)}`;
  if (existing.has(candidate)) {
    candidate = `${candidate.slice(0, 55)}_${shortHash(`${base}\0${remoteName}`)}`;
  }
  return candidate;
}

function normalizeToolName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
