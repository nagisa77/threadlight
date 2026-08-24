import {
  CHECK_AGENTS_TOOL,
  CLOSE_AGENT_TOOL,
  DEFAULT_AGENT_WAIT_TIMEOUT_MS,
  MAX_AGENT_WAIT_TIMEOUT_MS,
  READ_AGENT_RESULT_TOOL,
  FOLLOWUP_TASK_TOOL,
  FOLLOW_UP_AGENT_TOOL,
  INTERRUPT_AGENT_TOOL,
  RETRY_AGENT_TOOL,
  SEND_MESSAGE_TOOL,
  SPAWN_AGENT_TOOL,
  STEER_AGENT_TOOL,
  WAIT_FOR_AGENTS_TOOL,
  collaborationInputParameters,
  collaborationMessageParameters,
  collaborationTargetParameters,
  collaborationTargetsParameters,
  objectArguments,
  optionalAgentIds,
  stringArgument,
  taskNameArgument,
  waitTimeoutArgument,
} from "./collaboration-contract.js";
import {
  agentThreadId,
  collaborationStatus,
  isTerminal,
} from "./orchestrator-records.js";
import type {
  AgentMailboxEvent,
  AgentTaskRecord,
  SpawnOptions,
} from "./orchestrator-types.js";
import type { AgentTaskMessage, AgentTaskSnapshot, Tool } from "./types.js";

export interface CollaborationToolHost {
  profileNames: readonly string[];
  spawn(role: string, task: string, options: SpawnOptions): AgentTaskSnapshot;
  flushRuntimeCheckpoints(): Promise<void>;
  sendMessageOrThrow(
    caller: string,
    target: string,
    text: string,
  ): AgentTaskMessage;
  agentMessage(
    caller: string,
    target: string,
    text: string,
    kind: "follow_up",
  ): AgentTaskMessage;
  followUpFromOrThrow(
    caller: string,
    target: string,
    text: string,
    message?: AgentTaskMessage,
  ): AgentTaskSnapshot;
  retryFromOrThrow(caller: string, target: string): AgentTaskSnapshot;
  resolveCurrentAgentRecords(
    caller: string,
    ids: readonly string[],
  ): AgentTaskRecord[];
  readAgentResultOrThrow(caller: string, target: string): unknown;
  currentDirectChildRecords(caller: string): AgentTaskRecord[];
  waitRecords(
    caller: string,
    ids: readonly string[] | undefined,
  ): AgentTaskRecord[];
  waitForMailbox(
    threadIds: ReadonlySet<string>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<
    | { reason: "agent_updated"; event: AgentMailboxEvent }
    | { reason: "timeout" }
  >;
  scheduleRuntimeCheckpoint(): void;
  steerFromOrThrow(caller: string, target: string, input: string): void;
  interruptFromOrThrow(caller: string, target: string): void;
  closeFromOrThrow(caller: string, target: string): void;
}

export class CollaborationToolFactory {
  private readonly deliveredRevisions = new Map<string, number>();

  constructor(private readonly host: CollaborationToolHost) {}

  tools(callerThreadId: string): Tool[] {
    return [
      this.spawnTool(callerThreadId),
      this.sendMessageTool(callerThreadId),
      this.followupTaskTool(callerThreadId),
      this.followUpTool(callerThreadId),
      this.retryTool(callerThreadId),
      this.readResultTool(callerThreadId),
      this.checkTool(callerThreadId),
      this.waitTool(callerThreadId),
      this.steerTool(callerThreadId),
      this.interruptTool(callerThreadId),
      this.closeTool(callerThreadId),
    ];
  }

  private spawnTool(callerThreadId: string): Tool {
    return {
      name: SPAWN_AGENT_TOOL,
      description:
        "Start a direct child-agent task. Returns immediately so independent tasks can run concurrently.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            enum: [...this.host.profileNames],
            description: "Configured subagent role",
          },
          task: {
            type: "string",
            minLength: 1,
            description: "Self-contained delegated task and expected result",
          },
          taskName: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9_-]{0,63}$",
            description:
              "Optional stable sibling-unique name used for addressing, such as api_review",
          },
        },
        required: ["role", "task"],
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const snapshot = this.host.spawn(
          stringArgument(values.role, "role"),
          stringArgument(values.task, "task"),
          {
            callerId: callerThreadId,
            parentId: callerThreadId,
            ...(values.taskName === undefined
              ? {}
              : { name: taskNameArgument(values.taskName) }),
          },
        );
        await this.host.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private sendMessageTool(callerThreadId: string): Tool {
    return {
      name: SEND_MESSAGE_TOOL,
      description:
        "Send a message to a queued or running agent. Delivery happens at the next safe model/tool boundary without starting a new turn.",
      parameters: collaborationMessageParameters(
        "Message, evidence, question, or correction for the active agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const target = stringArgument(values.target, "target");
        const message = this.host.sendMessageOrThrow(
          callerThreadId,
          target,
          stringArgument(values.message, "message"),
        );
        await this.host.flushRuntimeCheckpoints();
        return { accepted: true, message };
      },
    };
  }

  private followupTaskTool(callerThreadId: string): Tool {
    return {
      name: FOLLOWUP_TASK_TOOL,
      description:
        "Wake an idle direct child or read-only peer with follow-up work in the same stable thread, preserving opaque provider state and visible history.",
      parameters: collaborationMessageParameters(
        "The next task or question for the idle agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const target = stringArgument(values.target, "target");
        const text = stringArgument(values.message, "message");
        const message = this.host.agentMessage(
          callerThreadId,
          target,
          text,
          "follow_up",
        );
        const snapshot = this.host.followUpFromOrThrow(
          callerThreadId,
          target,
          text,
          message,
        );
        await this.host.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private followUpTool(callerThreadId: string): Tool {
    return {
      name: FOLLOW_UP_AGENT_TOOL,
      description:
        "Compatibility alias for continuing an idle agent thread with preserved provider state.",
      parameters: collaborationInputParameters(
        "The next task or question for the same agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        const snapshot = this.host.followUpFromOrThrow(
          callerThreadId,
          agentId,
          stringArgument(values.input, "input"),
        );
        await this.host.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private retryTool(callerThreadId: string): Tool {
    return {
      name: RETRY_AGENT_TOOL,
      description:
        "Retry a finished or interrupted agent turn from fresh provider state while keeping the same stable agent thread.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        const snapshot = this.host.retryFromOrThrow(callerThreadId, agentId);
        await this.host.flushRuntimeCheckpoints();
        return snapshot;
      },
    };
  }

  private checkTool(callerThreadId: string): Tool {
    return {
      name: CHECK_AGENTS_TOOL,
      description:
        "Inspect selected agents without waiting. Omit IDs to inspect this caller's direct children.",
      parameters: collaborationTargetsParameters(
        "Agent IDs, names, or canonical paths; omit for direct children",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const requested = optionalAgentIds(values.agentIds);
        const records = requested
          ? this.host.resolveCurrentAgentRecords(callerThreadId, requested)
          : this.host.currentDirectChildRecords(callerThreadId);
        return this.incrementalStatus(callerThreadId, records);
      },
    };
  }

  private readResultTool(callerThreadId: string): Tool {
    return {
      name: READ_AGENT_RESULT_TOOL,
      description:
        "Read one agent's exact result on demand. check_agents and wait_for_agents return only incremental summaries.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            minLength: 1,
            description:
              "Agent task ID, stable thread ID, caller-relative task name, or canonical path",
          },
        },
        required: ["target"],
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const target = stringArgument(values.target, "target");
        return this.host.readAgentResultOrThrow(callerThreadId, target);
      },
    };
  }

  private waitTool(callerThreadId: string): Tool {
    return {
      name: WAIT_FOR_AGENTS_TOOL,
      description:
        "Wait for selected agents or, by default, this caller's direct children. The wait is bounded and returns partial status snapshots.",
      parameters: {
        type: "object",
        properties: {
          agentIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Agent IDs, names, or canonical paths; omit for direct children",
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
            maximum: MAX_AGENT_WAIT_TIMEOUT_MS,
            description: `Maximum wait in milliseconds; defaults to ${DEFAULT_AGENT_WAIT_TIMEOUT_MS}`,
          },
        },
        additionalProperties: false,
      },
      mutability: "read",
      execute: async (arguments_, context) => {
        const values = objectArguments(arguments_);
        const requested = optionalAgentIds(values.agentIds);
        const timeoutMs = waitTimeoutArgument(values.timeoutMs);
        let records = this.host.waitRecords(callerThreadId, requested);
        let wakeReason:
          "all_terminal" | "results_available" | "agent_updated" | "timeout";
        let mailboxEvent: AgentMailboxEvent | undefined;

        if (
          records.length === 0 ||
          records.every(({ snapshot }) => isTerminal(snapshot.status))
        ) {
          wakeReason = "all_terminal";
        } else if (
          records.some(({ snapshot }) => isTerminal(snapshot.status))
        ) {
          wakeReason = "results_available";
        } else {
          const wake = await this.host.waitForMailbox(
            new Set(records.map(agentThreadId)),
            timeoutMs,
            context.signal,
          );
          wakeReason = wake.reason;
          if (wake.reason === "agent_updated") mailboxEvent = wake.event;
          await Promise.resolve();
          records = this.host.waitRecords(callerThreadId, requested);
        }

        for (const record of records) {
          if (isTerminal(record.snapshot.status)) record.collected = true;
        }
        this.host.scheduleRuntimeCheckpoint();
        await this.host.flushRuntimeCheckpoints();
        const status = this.incrementalStatus(callerThreadId, records);
        return {
          wakeReason,
          timedOut: wakeReason === "timeout",
          timeoutMs,
          ...(mailboxEvent ? { mailboxEvent } : {}),
          ...status,
        };
      },
    };
  }

  private incrementalStatus(
    callerThreadId: string,
    records: readonly AgentTaskRecord[],
  ) {
    const changed = records.filter((record) => {
      const key = `${callerThreadId}\0${record.snapshot.id}`;
      return this.deliveredRevisions.get(key) !== record.revision;
    });
    for (const record of changed) {
      this.deliveredRevisions.set(
        `${callerThreadId}\0${record.snapshot.id}`,
        record.revision,
      );
    }
    return collaborationStatus(records, changed);
  }

  private steerTool(callerThreadId: string): Tool {
    return {
      name: STEER_AGENT_TOOL,
      description:
        "Add direction or a constraint to a queued or running agent at its next safe boundary.",
      parameters: collaborationInputParameters(
        "Direction or constraint for the active agent",
      ),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        this.host.steerFromOrThrow(
          callerThreadId,
          agentId,
          stringArgument(values.input, "input"),
        );
        await this.host.flushRuntimeCheckpoints();
        return { agentId, accepted: true };
      },
    };
  }

  private interruptTool(callerThreadId: string): Tool {
    return {
      name: INTERRUPT_AGENT_TOOL,
      description:
        "Interrupt an agent's current turn and active descendants without closing their reusable threads.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        this.host.interruptFromOrThrow(callerThreadId, agentId);
        await this.host.flushRuntimeCheckpoints();
        return { agentId, interrupted: true };
      },
    };
  }

  private closeTool(callerThreadId: string): Tool {
    return {
      name: CLOSE_AGENT_TOOL,
      description:
        "Permanently close an agent thread and its descendant threads. Closed threads reject future collaboration actions.",
      parameters: collaborationTargetParameters(),
      mutability: "read",
      execute: async (arguments_) => {
        const values = objectArguments(arguments_);
        const agentId = stringArgument(values.agentId, "agentId");
        this.host.closeFromOrThrow(callerThreadId, agentId);
        await this.host.flushRuntimeCheckpoints();
        return { agentId, closed: true };
      },
    };
  }
}
