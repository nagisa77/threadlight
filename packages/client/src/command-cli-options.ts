export type ThreadlightCommand =
  | ThreadlightProjectsCommand
  | ThreadlightRunCommand
  | { action: "help" }
  | { action: "version" };

interface ThreadlightConnectionOptions {
  endpoint?: string;
  token?: string;
  json: boolean;
}

export interface ThreadlightProjectsCommand extends ThreadlightConnectionOptions {
  action: "projects";
}

export interface ThreadlightRunCommand extends ThreadlightConnectionOptions {
  action: "run";
  prompt?: string;
  project?: string;
  standalone: boolean;
  threadId?: string;
  developmentMode: "local" | "worktree";
  turnMode: "default" | "plan";
  fullAccess: boolean;
  approveWrites: boolean;
  provider?: string;
  model?: string;
  capabilityRefs: string[];
  timeoutMs?: number;
}

export class ThreadlightCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadlightCliUsageError";
  }
}

const COMMON_VALUE_OPTIONS = new Set(["--host", "--token"]);
const RUN_VALUE_OPTIONS = new Set([
  "--project",
  "--thread",
  "--provider",
  "--model",
  "--capability",
  "--timeout",
]);

export function parseThreadlightCli(values: string[]): ThreadlightCommand {
  const optionValues = values.slice(
    0,
    values.includes("--") ? values.indexOf("--") : values.length,
  );
  if (
    values.length === 0 ||
    optionValues.includes("--help") ||
    optionValues.includes("-h")
  ) {
    return { action: "help" };
  }
  if (optionValues.includes("--version") || optionValues.includes("-v")) {
    return { action: "version" };
  }

  const [action, ...args] = values;
  if (action === "projects") return parseProjects(args);
  if (action === "run") return parseRun(args);
  throw new ThreadlightCliUsageError(`Unknown command: ${action}`);
}

function parseProjects(values: string[]): ThreadlightProjectsCommand {
  const common = parseCommon(values);
  if (common.positionals.length > 0) {
    throw new ThreadlightCliUsageError(
      "The projects command does not accept positional arguments.",
    );
  }
  return { action: "projects", ...common.options };
}

function parseRun(values: string[]): ThreadlightRunCommand {
  const result: ThreadlightRunCommand = {
    action: "run",
    json: false,
    standalone: false,
    developmentMode: "local",
    turnMode: "default",
    fullAccess: false,
    approveWrites: false,
    capabilityRefs: [],
  };
  const prompt: string[] = [];
  let positionalOnly = false;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (positionalOnly) {
      prompt.push(value);
      continue;
    }
    if (value === "--") {
      positionalOnly = true;
      continue;
    }
    if (!value.startsWith("-")) {
      prompt.push(value);
      continue;
    }
    if (value === "--json") result.json = true;
    else if (value === "--standalone") result.standalone = true;
    else if (value === "--worktree") result.developmentMode = "worktree";
    else if (value === "--plan") result.turnMode = "plan";
    else if (value === "--full-access") result.fullAccess = true;
    else if (value === "--yes" || value === "-y") result.approveWrites = true;
    else if (COMMON_VALUE_OPTIONS.has(value) || RUN_VALUE_OPTIONS.has(value)) {
      const optionValue = values[index + 1];
      if (optionValue === undefined || optionValue.startsWith("--")) {
        throw new ThreadlightCliUsageError(`Missing value for ${value}`);
      }
      index += 1;
      if (value === "--host") result.endpoint = optionValue;
      if (value === "--token") result.token = optionValue;
      if (value === "--project") result.project = optionValue;
      if (value === "--thread") result.threadId = optionValue;
      if (value === "--provider") result.provider = optionValue;
      if (value === "--model") result.model = optionValue;
      if (value === "--capability") result.capabilityRefs.push(optionValue);
      if (value === "--timeout") result.timeoutMs = parseTimeout(optionValue);
    } else {
      throw new ThreadlightCliUsageError(`Unknown option: ${value}`);
    }
  }

  if (result.project && result.standalone) {
    throw new ThreadlightCliUsageError(
      "Use either --project or --standalone, not both.",
    );
  }
  if (result.threadId && result.developmentMode === "worktree") {
    throw new ThreadlightCliUsageError(
      "--worktree only applies when creating a new task.",
    );
  }
  if (!result.threadId && !result.project && !result.standalone) {
    throw new ThreadlightCliUsageError(
      "Choose a target with --project or --standalone when creating a task.",
    );
  }
  if (prompt.length > 0) result.prompt = prompt.join(" ").trim();
  return result;
}

function parseCommon(values: string[]): {
  options: ThreadlightConnectionOptions;
  positionals: string[];
} {
  const options: ThreadlightConnectionOptions = { json: false };
  const positionals: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith("-")) {
      positionals.push(value);
      continue;
    }
    if (value === "--json") {
      options.json = true;
      continue;
    }
    if (!COMMON_VALUE_OPTIONS.has(value)) {
      throw new ThreadlightCliUsageError(`Unknown option: ${value}`);
    }
    const optionValue = values[index + 1];
    if (optionValue === undefined || optionValue.startsWith("--")) {
      throw new ThreadlightCliUsageError(`Missing value for ${value}`);
    }
    index += 1;
    if (value === "--host") options.endpoint = optionValue;
    if (value === "--token") options.token = optionValue;
  }
  return { options, positionals };
}

function parseTimeout(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ThreadlightCliUsageError(
      "--timeout must be a whole number of seconds.",
    );
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new ThreadlightCliUsageError("--timeout must be greater than zero.");
  }
  return seconds * 1_000;
}

export function threadlightCliUsage(): string {
  return `Usage:
  threadlight projects [options]
  threadlight run (--project <id|name|path> | --standalone) [options] [prompt]
  threadlight run --thread <thread-id> [options] [prompt]

Send work to a local or remote Threadlight Host.

Connection options:
  --host <url>          Host URL (or THREADLIGHT_HOST_URL)
  --token <token>       Host token (or THREADLIGHT_HOST_TOKEN)
  --json                Print machine-readable JSON

Run options:
  --project <selector>  Exact project id, name, or absolute path
  --standalone          Run without a project in Host-managed task storage
  --thread <id>         Continue an existing task; project is inferred if omitted
  --worktree            Create an isolated Git worktree task
  --plan                Start the turn in plan mode
  --full-access         Bypass write approval and destructive-operation blocking
  -y, --yes             Approve every non-destructive write request
  --provider <name>     Override the model provider for this turn
  --model <name>        Override the model for this turn
  --capability <id>     Enable a capability; may be repeated
  --timeout <seconds>   Interrupt the turn if it does not finish in time
  -h, --help            Show this help
  -v, --version         Show the installed version

Prompt input:
  Pass the prompt after the options, after --, or pipe it on stdin.
  Without --yes or --full-access, write requests are confirmed interactively
  and denied when stdin is not a terminal.

Examples:
  THREADLIGHT_HOST_TOKEN=... threadlight projects \\
    --host https://tim-france-vps.threadlight.xyz

  THREADLIGHT_HOST_TOKEN=... threadlight run \\
    --host https://tim-france-vps.threadlight.xyz \\
    --project /srv/my-project --worktree \\
    "Fix the failing tests"

  printf '%s\\n' 'Research this topic' | THREADLIGHT_HOST_TOKEN=... \\
    threadlight run --host https://tim-france-vps.threadlight.xyz --standalone
`;
}
