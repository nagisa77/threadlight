import {
  THREADLIGHT_HOST_PROTOCOL_VERSION,
  type HostProjectSummary,
  type HostProjectsSnapshot,
  type ThreadlightNotification,
  type ThreadlightNotificationMap,
  type TokenUsageData,
} from "@threadlight/protocol";

import { ThreadlightClient } from "./client.js";
import { HttpHostClient } from "./http-host-client.js";
import { HttpRuntimeTransport } from "./http-runtime-transport.js";

export interface RemoteTaskApproval {
  request: ThreadlightNotificationMap["execution/approval-required"];
  project: HostProjectSummary;
  threadId: string;
}

export interface RunRemoteTaskOptions {
  endpoint: string;
  token: string;
  prompt: string;
  project?: string;
  standalone?: boolean;
  threadId?: string;
  developmentMode?: "local" | "worktree";
  turnMode?: "default" | "plan";
  fullAccess?: boolean;
  provider?: string;
  model?: string;
  capabilityRefs?: readonly string[];
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  approve?(approval: RemoteTaskApproval): Promise<"allow" | "deny">;
  onStatus?(status: RemoteTaskStatus): void;
}

export type RemoteTaskStatus =
  | { type: "connected"; hostId: string; hostName: string }
  | { type: "task-created"; projectId: string; threadId: string }
  | { type: "task-resumed"; projectId: string; threadId: string }
  | {
      type: "approval";
      requestId: string;
      decision: "allow" | "deny";
      summary: string;
    }
  | { type: "turn-started"; threadId: string; turnId: string };

export interface RemoteTaskResult {
  hostId: string;
  hostName: string;
  projectId: string;
  projectName: string;
  threadId: string;
  turnId: string;
  created: boolean;
  status: "completed" | "failed";
  output?: string;
  error?: string;
  usage?: TokenUsageData;
}

interface TurnTerminalEvent {
  status: "completed" | "failed";
  threadId: string;
  turnId: string;
  output?: string;
  error?: string;
  usage?: TokenUsageData;
}

export async function runRemoteTask(
  options: RunRemoteTaskOptions,
): Promise<RemoteTaskResult> {
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("A non-empty task prompt is required.");
  if (options.project && options.standalone) {
    throw new Error("Use either a project selector or standalone mode.");
  }

  const host = new HttpHostClient({
    endpoint: options.endpoint,
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const health = await host.health();
  if (health.protocolVersion !== THREADLIGHT_HOST_PROTOCOL_VERSION) {
    throw new Error(
      `Incompatible Threadlight Host protocol: client ${THREADLIGHT_HOST_PROTOCOL_VERSION}, Host ${health.protocolVersion}.`,
    );
  }
  options.onStatus?.({
    type: "connected",
    hostId: health.hostId,
    hostName: health.name,
  });

  const initialProjects = await host.projects();
  const project = await resolveTaskProject(host, initialProjects, options);
  const transport = new HttpRuntimeTransport({
    endpoint: options.endpoint,
    token: options.token,
    projectId: project.id,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const client = new ThreadlightClient(transport, {
    capabilities: { executionApprovals: true },
  });
  let threadId = options.threadId;
  let created = false;
  let interrupting = false;

  try {
    await transport.waitUntilConnected();
    await client.initialize();
    if (threadId) {
      const resumed = await client.resumeThread(threadId);
      if (resumed.activeTurn) {
        throw new Error(
          `Task ${threadId} already has a running turn. Wait for it to finish before sending another message.`,
        );
      }
      options.onStatus?.({
        type: "task-resumed",
        projectId: project.id,
        threadId,
      });
    } else {
      const started = await client.startThread(
        options.developmentMode ?? "local",
      );
      threadId = started.threadId;
      created = true;
      await host.upsertConversation({
        projectId: project.id,
        id: threadId,
        title: taskTitle(prompt),
      });
      options.onStatus?.({
        type: "task-created",
        projectId: project.id,
        threadId,
      });
    }

    const activeThreadId = threadId;
    await host.updateConversation({
      projectId: project.id,
      id: activeThreadId,
      accessMode: options.fullAccess ? "full" : "approval",
    });
    const terminal = terminalEventWatcher(activeThreadId);
    const approvalTasks = new Set<Promise<void>>();
    const unsubscribe = client.subscribe((notification) => {
      terminal.observe(notification as ThreadlightNotification);
      if (notification.method !== "execution/approval-required") return;
      const request =
        notification.params as ThreadlightNotificationMap["execution/approval-required"];
      if (request.threadId !== activeThreadId) return;
      const task = handleApproval(
        client,
        request,
        project,
        activeThreadId,
        options,
      ).catch((error) => terminal.reject(toError(error)));
      approvalTasks.add(task);
      void task.finally(() => approvalTasks.delete(task));
    });

    const abort = async (reason: Error) => {
      if (interrupting) return;
      interrupting = true;
      await client.interruptTurn(activeThreadId).catch(() => undefined);
      terminal.reject(reason);
    };
    const onAbort = () => void abort(abortReason(options.signal));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          void abort(
            new Error(
              `Remote task did not finish within ${Math.ceil(options.timeoutMs! / 1_000)} seconds.`,
            ),
          );
        }, options.timeoutMs)
      : undefined;

    try {
      if (options.signal?.aborted) throw abortReason(options.signal);
      const started = await client.startTurn(
        activeThreadId,
        prompt,
        [],
        options.turnMode ?? "default",
        options.capabilityRefs ?? [],
        options.fullAccess ? "full" : "approval",
        options.provider,
        options.model,
      );
      terminal.setTurnId(started.turnId);
      options.onStatus?.({
        type: "turn-started",
        threadId: activeThreadId,
        turnId: started.turnId,
      });
      const event = await terminal.result;
      await Promise.allSettled([...approvalTasks]);
      return {
        hostId: health.hostId,
        hostName: health.name,
        projectId: project.id,
        projectName: project.name,
        threadId: activeThreadId,
        turnId: event.turnId,
        created,
        status: event.status,
        ...(event.output !== undefined ? { output: event.output } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
        ...(event.usage ? { usage: event.usage } : {}),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
  } finally {
    client.dispose();
    transport.close();
  }
}

async function resolveTaskProject(
  host: HttpHostClient,
  snapshot: HostProjectsSnapshot,
  options: Pick<RunRemoteTaskOptions, "project" | "standalone" | "threadId">,
): Promise<HostProjectSummary> {
  if (options.standalone) {
    let standalone = snapshot.projects.find(
      (candidate) => candidate.scope === "standalone",
    );
    if (!standalone) {
      const created = await host.createStandaloneTask();
      standalone = created.projects.find(
        (candidate) => candidate.scope === "standalone",
      );
    }
    if (!standalone)
      throw new Error("The Host did not create standalone task storage.");
    requireThreadInProject(standalone, options.threadId);
    return standalone;
  }

  if (options.project) {
    const project = selectHostProject(snapshot, options.project);
    requireThreadInProject(project, options.threadId);
    return project;
  }

  if (options.threadId) {
    const matches = snapshot.projects.filter((candidate) =>
      candidate.conversations.some(({ id }) => id === options.threadId),
    );
    if (matches.length === 1) return matches[0]!;
    if (matches.length === 0) {
      throw new Error(`Unknown task: ${options.threadId}`);
    }
    throw new Error(
      `Task ${options.threadId} exists in more than one project; pass --project to disambiguate.`,
    );
  }

  throw new Error("Choose a project or standalone mode.");
}

export function selectHostProject(
  snapshot: HostProjectsSnapshot,
  selector: string,
): HostProjectSummary {
  const value = selector.trim();
  if (!value) throw new Error("Project selector cannot be empty.");
  const exact = snapshot.projects.filter(
    (project) =>
      project.id === value ||
      project.name === value ||
      project.basePath === value,
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new Error(
      `Project selector is ambiguous: ${value}. Use the project id or absolute path.`,
    );
  }
  const nameMatches = snapshot.projects.filter(
    (project) => project.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
  );
  if (nameMatches.length === 1) return nameMatches[0]!;
  if (nameMatches.length > 1) {
    throw new Error(
      `Project name is ambiguous: ${value}. Use the project id or absolute path.`,
    );
  }
  throw new Error(
    `Unknown project: ${value}. Run 'threadlight projects' to list available targets.`,
  );
}

function requireThreadInProject(
  project: HostProjectSummary,
  threadId: string | undefined,
): void {
  if (
    threadId &&
    !project.conversations.some((conversation) => conversation.id === threadId)
  ) {
    throw new Error(
      `Task ${threadId} does not belong to project ${project.name}.`,
    );
  }
}

async function handleApproval(
  client: ThreadlightClient,
  request: ThreadlightNotificationMap["execution/approval-required"],
  project: HostProjectSummary,
  threadId: string,
  options: RunRemoteTaskOptions,
): Promise<void> {
  const decision = options.approve
    ? await options.approve({ request, project, threadId })
    : "deny";
  options.onStatus?.({
    type: "approval",
    requestId: request.requestId,
    decision,
    summary: request.summary,
  });
  await client.request("execution/approval/respond", {
    requestId: request.requestId,
    decision,
    threadId,
  });
}

function terminalEventWatcher(threadId: string): {
  result: Promise<TurnTerminalEvent>;
  observe(notification: ThreadlightNotification): void;
  setTurnId(turnId: string): void;
  reject(error: Error): void;
} {
  let expectedTurnId: string | undefined;
  let settled = false;
  const buffered: TurnTerminalEvent[] = [];
  let resolveResult!: (event: TurnTerminalEvent) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<TurnTerminalEvent>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settle = (event: TurnTerminalEvent) => {
    if (settled || event.threadId !== threadId) return;
    if (!expectedTurnId) {
      buffered.push(event);
      return;
    }
    if (event.turnId !== expectedTurnId) return;
    settled = true;
    resolveResult(event);
  };
  return {
    result,
    observe(notification) {
      if (notification.method === "turn/completed") {
        settle({
          status: "completed",
          threadId: notification.params.threadId,
          turnId: notification.params.turnId,
          output: notification.params.output,
          usage: notification.params.usage,
        });
      }
      if (notification.method === "turn/failed") {
        settle({
          status: "failed",
          threadId: notification.params.threadId,
          turnId: notification.params.turnId,
          error: notification.params.error,
        });
      }
    },
    setTurnId(turnId) {
      expectedTurnId = turnId;
      for (const event of buffered.splice(0)) settle(event);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectResult(error);
    },
  };
}

function taskTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  return reason instanceof Error
    ? reason
    : new Error("Remote task was interrupted.");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
