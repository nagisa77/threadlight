import type {
  RunController,
  RunControllerContext,
  RunControllerToolDecision,
  Tool,
  ToolCall,
} from "@threadlight/agent-loop";

export type ExecutionRisk = "read" | "write" | "destructive";

export interface ExecutionApprovalRequest {
  threadId: string;
  runId: string;
  toolName: string;
  permissionKey: string;
  risk: "write";
  summary: string;
  detail?: string;
  external: boolean;
}

export interface ExecutionApprovalRequester {
  request(
    request: ExecutionApprovalRequest,
    signal?: AbortSignal,
  ): Promise<"allow" | "deny">;
}

export class ExecutionPolicyRunController implements RunController {
  constructor(
    private readonly threadId: string,
    private readonly approvals: ExecutionApprovalRequester,
    private readonly signal?: AbortSignal,
  ) {}

  async beforeToolCall(
    call: ToolCall,
    tool: Tool | undefined,
    context: RunControllerContext,
  ): Promise<RunControllerToolDecision> {
    const classification = classifyToolCall(call, tool);
    if (classification.risk === "read") return { allowed: true };
    if (classification.risk === "destructive") {
      return {
        allowed: false,
        message: `Blocked by the execution safety policy: ${classification.summary}. Destructive operations are not permitted.`,
      };
    }

    const decision = await this.approvals.request(
      {
        threadId: this.threadId,
        runId: context.runId,
        toolName: call.name,
        permissionKey: classification.permissionKey,
        risk: "write",
        summary: classification.summary,
        ...(classification.detail ? { detail: classification.detail } : {}),
        external: classification.external,
      },
      this.signal,
    );
    return decision === "allow"
      ? { allowed: true }
      : {
          allowed: false,
          message: `The user denied permission for: ${classification.summary}.`,
        };
  }
}

export function classifyToolCall(
  call: ToolCall,
  tool?: Tool,
): {
  risk: ExecutionRisk;
  permissionKey: string;
  summary: string;
  detail?: string;
  external: boolean;
} {
  const arguments_ = objectValue(call.arguments);

  if (call.name === "exec_command") {
    return classifyShellCommand(
      typeof arguments_.command === "string" ? arguments_.command : "",
    );
  }
  if (call.name === "computer") {
    const actions = Array.isArray(arguments_.actions) ? arguments_.actions : [];
    const readOnly =
      actions.length > 0 &&
      actions.every((action) => {
        const type = objectValue(action).type;
        return type === "screenshot" || type === "wait";
      });
    return {
      risk: readOnly ? "read" : "write",
      permissionKey: readOnly ? "computer:observe" : "computer:control",
      summary: readOnly ? "Observe the shared screen" : "Control the shared computer",
      external: true,
    };
  }
  if (call.name === "computer_share") {
    const action = stringValue(arguments_.action);
    return {
      risk: action === "list" ? "read" : "write",
      permissionKey: `computer_share:${action || "change"}`,
      summary:
        action === "list"
          ? "List available screen sharing targets"
          : action === "clear"
            ? "Stop screen sharing"
            : "Change the shared screen or application",
      external: true,
    };
  }
  if (call.name === "project_memory") {
    const action = stringValue(arguments_.action);
    return {
      risk: action === "read" ? "read" : "write",
      permissionKey: `project_memory:${action || "write"}`,
      summary:
        action === "read"
          ? "Read project memory"
          : "Update persistent project memory",
      external: false,
    };
  }

  const mutability = tool?.mutability ?? "write";
  const destructive = tool?.impact?.destructive === true;
  return {
    risk: destructive ? "destructive" : mutability,
    permissionKey: `tool:${call.name}`,
    summary:
      mutability === "read"
        ? `Read data with ${call.name}`
        : `Run write-capable tool ${call.name}`,
    external: tool?.impact?.external === true,
  };
}

function classifyShellCommand(command: string): {
  risk: ExecutionRisk;
  permissionKey: string;
  summary: string;
  detail?: string;
  external: boolean;
} {
  const trimmed = command.trim();
  const permissionKey = shellPermissionKey(trimmed);
  const detail = trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
  const destructive = [
    /(^|[;&|]\s*)(sudo\s+)?rm(?:\s|$)/i,
    /(^|[;&|]\s*)rmdir(?:\s|$)/i,
    /\bgit\s+(?:reset\s+--hard|clean(?:\s|$)|checkout\s+--|restore\s+.+--source)\b/i,
    /\bgit\s+branch\s+(?:-[dD]\b|--delete\b)/i,
    /\bgit\s+(?:tag\s+(?:-d\b|--delete\b)|remote\s+(?:remove|rm)\b)/i,
    /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?\b|\s-f\b)/i,
    /\b(?:mkfs|fdisk|diskutil\s+erase|dd\s+if=|truncate\s+-s\s*0)\b/i,
    /\b(?:drop|truncate)\s+(?:table|database)\b/i,
    /(^|[;&|]\s*)(?:kill|pkill|killall)(?:\s|$)/i,
  ].some((pattern) => pattern.test(trimmed));
  if (destructive) {
    return {
      risk: "destructive",
      permissionKey,
      summary: `Run destructive ${shellOperationLabel(permissionKey)}`,
      detail,
      external: shellCommandIsExternal(trimmed),
    };
  }

  const readOnly = isReadOnlyShellCommand(trimmed);
  return {
    risk: readOnly ? "read" : "write",
    permissionKey,
    summary: `${readOnly ? "Run read-only" : "Run"} ${shellOperationLabel(permissionKey)}`,
    detail,
    external: shellCommandIsExternal(trimmed),
  };
}

function isReadOnlyShellCommand(command: string): boolean {
  if (!command || /(?:^|[^<])>{1,2}|<<?|`|\$\(/.test(command)) return false;
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  return (
    segments.length > 0 &&
    segments.every((segment) => {
      const words = shellWords(segment);
      const executable = words[0]?.replace(/^.*\//, "");
      if (!executable) return false;
      if (
        [
          "pwd",
          "ls",
          "rg",
          "grep",
          "cat",
          "head",
          "tail",
          "wc",
          "stat",
          "file",
          "which",
          "whereis",
          "printenv",
          "uname",
          "whoami",
          "realpath",
          "dirname",
          "basename",
        ].includes(executable)
      ) {
        return true;
      }
      if (executable === "sed") {
        return words.includes("-n") && !words.some((word) => /^-.*i/.test(word));
      }
      if (executable === "find") {
        return !words.some((word) =>
          ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(word),
        );
      }
      if (executable === "env") return words.length === 1;
      if (executable === "git") {
        const subcommand = words[1] ?? "";
        if (
          [
          "status",
          "diff",
          "log",
          "show",
          "rev-parse",
          "ls-files",
          "ls-tree",
          ].includes(subcommand)
        ) {
          return true;
        }
        if (subcommand === "branch") {
          return !words.slice(2).some((word) =>
            /^-(?:d|D|m|M|c|C)$/.test(word) ||
            [
              "--delete",
              "--move",
              "--copy",
              "--edit-description",
              "--set-upstream-to",
              "--unset-upstream",
            ].some((option) => word === option || word.startsWith(`${option}=`)),
          );
        }
        if (subcommand === "remote") {
          return words.length === 2 || (words.length === 3 && words[2] === "-v");
        }
        if (subcommand === "tag") {
          return words
            .slice(2)
            .every((word) => word === "-l" || word === "--list");
        }
        return false;
      }
      return false;
    })
  );
}

function shellPermissionKey(command: string): string {
  const words = shellWords(command);
  const executable = (words[0] ?? "shell").replace(/^.*\//, "");
  const knownSubcommands: Record<string, readonly string[]> = {
    git: [
      "status", "diff", "log", "show", "rev-parse", "branch", "remote",
      "ls-files", "ls-tree", "tag", "add", "commit", "push", "pull", "fetch",
      "clone", "merge", "rebase", "switch", "checkout", "restore", "reset",
      "clean", "stash",
    ],
    gh: ["pr", "issue", "repo", "workflow", "run", "auth", "api", "release"],
    npm: ["install", "ci", "run", "test", "publish", "uninstall", "update"],
    pnpm: ["install", "run", "test", "publish", "add", "remove", "update"],
    yarn: ["install", "run", "test", "publish", "add", "remove", "upgrade"],
    cargo: ["build", "check", "test", "run", "publish", "install", "update"],
    docker: ["build", "run", "compose", "pull", "push", "stop", "restart"],
    kubectl: ["get", "describe", "logs", "apply", "create", "delete", "edit"],
  };
  const subcommand = knownSubcommands[executable]?.find((candidate) =>
    words.slice(1).includes(candidate),
  );
  return `exec_command:${executable}${subcommand ? `:${subcommand}` : ""}`;
}

function shellCommandIsExternal(command: string): boolean {
  return /\b(?:curl|wget|ssh|scp|rsync|git\s+(?:push|fetch|pull|clone)|gh|npm\s+(?:publish|install)|pnpm\s+(?:publish|install)|yarn\s+(?:publish|add))\b/i.test(
    command,
  );
}

function shellOperationLabel(permissionKey: string): string {
  const [, executable = "shell", subcommand] = permissionKey.split(":");
  return subcommand
    ? `${executable} ${subcommand} commands`
    : `${executable} commands`;
}

function shellWords(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^['"]|['"]$/g, ""));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
