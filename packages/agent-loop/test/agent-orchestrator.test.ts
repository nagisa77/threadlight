import { describe, expect, it } from "vitest";

import { AgentLoop } from "../src/agent-loop.js";
import { AgentOrchestrator } from "../src/agent-orchestrator.js";
import { defineAgent, defineTool } from "../src/types.js";
import type {
  AgentRuntimeSnapshot,
  AgentTreeEvent,
  ModelProvider,
  ModelRequest,
  ModelTurn,
  Tool,
} from "../src/types.js";

describe("AgentOrchestrator", () => {
  it("persists an ordered visible transcript for scripted child model and tool events", async () => {
    let rootTurns = 0;
    let childTurns = 0;
    const inspect = defineTool({
      name: "workspace_inspect",
      description: "Inspect the workspace",
      parameters: { type: "object" },
      mutability: "read",
      async execute(arguments_) {
        expect(arguments_).toEqual({ path: "src/index.ts" });
        return { content: "export const ready = true;" };
      },
    });
    const reportSummary = defineTool({
      name: "report_activity_summary",
      description: "Report summary",
      parameters: { type: "object" },
      mutability: "read",
      presentation: {
        visibility: "hidden",
        activitySummaryArgument: "summary",
      },
      async execute() {
        return { accepted: true };
      },
    });
    const provider: ModelProvider = {
      async generate(request, options) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childTurns += 1;
          if (childTurns === 1) {
            options?.onEvent?.({
              type: "output_text.delta",
              delta: "Inspecting the entry point.",
            });
            return {
              text: "Inspecting the entry point.",
              toolCalls: [
                {
                  id: "summary-entry",
                  name: "report_activity_summary",
                  arguments: { summary: "Inspect the entry point" },
                },
                {
                  id: "inspect-entry",
                  name: "workspace_inspect",
                  arguments: { path: "src/index.ts" },
                },
              ],
            };
          }
          expect(
            request.toolResults?.find(
              ({ name }) => name === "workspace_inspect",
            )?.output,
          ).toContain("ready");
          return { text: "The entry point is ready.", toolCalls: [] };
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Delegating inspection.",
            toolCalls: [
              {
                id: "spawn-explorer",
                name: "spawn_agent",
                arguments: { role: "explorer", task: "Inspect the entry" },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Collecting inspection.",
            toolCalls: [
              { id: "wait-explorer", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        return { text: "Inspection complete.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "explorer",
          description: "Inspect",
          instructions: "Inspect read-only",
          toolAccess: "read-only",
        },
      ],
    });

    await orchestrator.run(
      defineAgent({
        name: "root",
        instructions: "ROOT",
        tools: [reportSummary, inspect],
      }),
      "Check the workspace",
    );

    const child = orchestrator.snapshot.agents.find(
      ({ parentId }) => parentId === orchestrator.snapshot.rootId,
    );
    expect(child?.transcript).toEqual([
      expect.objectContaining({
        kind: "model",
        step: 1,
        status: "completed",
        text: "Inspecting the entry point.",
      }),
      expect.objectContaining({
        kind: "tool",
        name: "workspace_inspect",
        status: "completed",
        arguments: '{\n  "path": "src/index.ts"\n}',
        output: '{"content":"export const ready = true;"}',
      }),
      expect.objectContaining({
        kind: "model",
        step: 2,
        status: "completed",
        text: "The entry point is ready.",
      }),
    ]);
    expect(child?.activities).toEqual([
      expect.objectContaining({ name: "workspace_inspect" }),
    ]);
  });

  it("runs scripted subagents concurrently, isolates model state, and makes the parent collect results", async () => {
    const requests: ModelRequest[] = [];
    const waiting: Array<(turn: ModelTurn) => void> = [];
    let rootTurns = 0;
    let activeChildren = 0;
    let maxActiveChildren = 0;
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (request.instructions.includes("SUBAGENT ROLE")) {
          activeChildren += 1;
          maxActiveChildren = Math.max(maxActiveChildren, activeChildren);
          const role = request.instructions.includes("PROFILE_EXPLORER")
            ? "explorer"
            : "reviewer";
          const turn = await new Promise<ModelTurn>((resolve) => {
            waiting.push(resolve);
            if (waiting.length === 2) {
              for (const [index, settle] of waiting.entries()) {
                settle({
                  text: `${index === 0 ? "explorer" : "reviewer"} result`,
                  toolCalls: [],
                  state: { child: index },
                  usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
                });
              }
            }
          });
          activeChildren -= 1;
          expect(["explorer", "reviewer"]).toContain(role);
          return turn;
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          expect(request.state).toBeUndefined();
          return {
            text: "Delegating independent checks.",
            toolCalls: [
              {
                id: "spawn-explorer",
                name: "spawn_agent",
                arguments: { role: "explorer", task: "Trace the code path" },
              },
              {
                id: "spawn-reviewer",
                name: "spawn_agent",
                arguments: { role: "reviewer", task: "Review the behavior" },
              },
            ],
            state: { root: 1 },
          };
        }
        if (rootTurns === 2) {
          expect(request.state).toEqual({ root: 1 });
          return {
            text: "Waiting for both results.",
            toolCalls: [
              { id: "wait-all", name: "wait_for_agents", arguments: {} },
            ],
            state: { root: 2 },
          };
        }
        expect(request.toolResults?.[0]?.output).toContain("explorer result");
        expect(request.toolResults?.[0]?.output).toContain("reviewer result");
        return {
          text: "Synthesized both subagent results.",
          toolCalls: [],
          state: { root: 3 },
        };
      },
    };
    const treeEvents: AgentTreeEvent[] = [];
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "explorer",
          description: "Inspect",
          instructions: "PROFILE_EXPLORER",
          toolAccess: "read-only",
        },
        {
          name: "reviewer",
          description: "Review",
          instructions: "PROFILE_REVIEWER",
          toolAccess: "read-only",
        },
      ],
      maxConcurrent: 2,
      onAgentTreeEvent: (event) => treeEvents.push(event),
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Build the feature",
    );

    expect(result.output).toBe("Synthesized both subagent results.");
    expect(result.usage).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
    });
    expect(maxActiveChildren).toBe(2);
    expect(
      requests
        .filter(({ instructions }) => instructions.includes("SUBAGENT ROLE"))
        .every(({ state }) => state === undefined),
    ).toBe(true);
    expect(orchestrator.snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "root", status: "completed" }),
        expect.objectContaining({ role: "explorer", status: "completed" }),
        expect.objectContaining({ role: "reviewer", status: "completed" }),
      ]),
    );
    expect(treeEvents.some(({ reason }) => reason === "completed")).toBe(true);
  });

  it("enforces exclusive write ownership while a write-capable subagent is active", async () => {
    let rootTurns = 0;
    let releaseWorker!: (turn: ModelTurn) => void;
    let writeExecutions = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          return new Promise<ModelTurn>((resolve) => {
            releaseWorker = resolve;
          });
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Delegating implementation.",
            toolCalls: [
              {
                id: "spawn-worker",
                name: "spawn_agent",
                arguments: { role: "worker", task: "Implement the change" },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Trying to write concurrently.",
            toolCalls: [
              { id: "root-write", name: "write_file", arguments: {} },
            ],
          };
        }
        if (rootTurns === 3) {
          expect(request.toolResults?.[0]).toMatchObject({ isError: true });
          expect(request.toolResults?.[0]?.output).toContain(
            "owns the workspace",
          );
          releaseWorker({ text: "Worker implemented it", toolCalls: [] });
          return {
            text: "Waiting for the writer.",
            toolCalls: [
              { id: "wait-worker", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        return { text: "Done safely", toolCalls: [] };
      },
    };
    const writeTool = defineTool({
      name: "write_file",
      description: "Write a file",
      parameters: { type: "object" },
      mutability: "write",
      async execute() {
        writeExecutions += 1;
        return "written";
      },
    });
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "worker",
          description: "Implement",
          instructions: "PROFILE_WORKER",
          toolAccess: "all",
        },
      ],
    });

    const result = await orchestrator.run(
      defineAgent({
        name: "root",
        instructions: "ROOT",
        tools: [writeTool],
      }),
      "Implement",
    );

    expect(result.output).toBe("Done safely");
    expect(writeExecutions).toBe(0);
  });

  it("keeps the write lock quarantined when an interrupted writer ignores abort", async () => {
    let rootTurns = 0;
    let writerId = "";
    let writeExecutions = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          return new Promise<ModelTurn>(() => undefined);
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting an unresponsive writer.",
            toolCalls: [
              {
                id: "spawn-writer",
                name: "spawn_agent",
                arguments: { role: "worker", task: "Hold the write lock" },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          writerId = (
            JSON.parse(request.toolResults![0]!.output) as {
              agentThreadId: string;
            }
          ).agentThreadId;
          return {
            text: "Interrupting without waiting for provider shutdown.",
            toolCalls: [
              {
                id: "interrupt-writer",
                name: "interrupt_agent",
                arguments: { agentId: writerId },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          expect(request.toolResults?.[0]?.isError).toBeUndefined();
          return {
            text: "Checking that the detached writer remains quarantined.",
            toolCalls: [
              { id: "unsafe-root-write", name: "write_file", arguments: {} },
            ],
          };
        }
        if (rootTurns === 4) {
          expect(request.toolResults?.[0]).toMatchObject({ isError: true });
          expect(request.toolResults?.[0]?.output).toContain(
            "owns the workspace",
          );
          return {
            text: "Collecting the local interrupted state.",
            toolCalls: [
              {
                id: "wait-writer",
                name: "wait_for_agents",
                arguments: { agentIds: [writerId], timeoutMs: 100 },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain('"interrupted"');
        return { text: "Writer stayed quarantined.", toolCalls: [] };
      },
    };
    const writeTool = defineTool({
      name: "write_file",
      description: "Write a file",
      parameters: { type: "object" },
      mutability: "write",
      async execute() {
        writeExecutions += 1;
        return "written";
      },
    });
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "worker",
          description: "Implement",
          instructions: "PROFILE_WORKER",
          toolAccess: "all",
        },
      ],
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT", tools: [writeTool] }),
      "Protect the workspace",
    );

    expect(result.output).toBe("Writer stayed quarantined.");
    expect(writeExecutions).toBe(0);
  });

  it("cancels and retries a scripted child without ending the parent run", async () => {
    const childStarted = Promise.withResolvers<void>();
    let childAttempts = 0;
    let rootTurns = 0;
    let childId = "";
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childAttempts += 1;
          if (childAttempts === 1) {
            childStarted.resolve();
            return new Promise<ModelTurn>((_resolve, reject) => {
              request.signal?.addEventListener(
                "abort",
                () => reject(request.signal?.reason),
                { once: true },
              );
            });
          }
          return { text: "Retry succeeded", toolCalls: [] };
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting a worker.",
            toolCalls: [
              {
                id: "spawn-worker",
                name: "spawn_agent",
                arguments: { role: "worker", task: "Implement once" },
              },
            ],
          };
        }
        if (rootTurns <= 3) {
          return {
            text: "Collecting worker state.",
            toolCalls: [
              {
                id: `wait-${rootTurns}`,
                name: "wait_for_agents",
                arguments: {},
              },
            ],
          };
        }
        return { text: "Parent completed after retry", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "worker",
          description: "Implement",
          instructions: "PROFILE_WORKER",
          toolAccess: "all",
        },
      ],
      onAgentTreeEvent(event) {
        const child = event.tree.agents.find(
          ({ parentId }) => parentId === event.tree.rootId,
        );
        if (child) childId = child.id;
      },
    });
    const resultPromise = orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Implement",
    );
    await childStarted.promise;

    expect(orchestrator.cancel(childId)).toBe(true);
    const retried = orchestrator.retry(childId);
    expect(retried).toMatchObject({ retryOf: childId });
    expect(["queued", "running"]).toContain(retried?.status);

    const result = await resultPromise;
    expect(result.output).toBe("Parent completed after retry");
    expect(orchestrator.snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: childId, status: "cancelled" }),
        expect.objectContaining({ retryOf: childId, status: "completed" }),
      ]),
    );
  });

  it("lets the parent spawn, steer, wait, follow up, interrupt, and close one persistent child thread", async () => {
    const releaseInitialChild = Promise.withResolvers<void>();
    const holdStarted = Promise.withResolvers<void>();
    const childRequests: ModelRequest[] = [];
    const treeEvents: AgentTreeEvent[] = [];
    const checkpoints: AgentRuntimeSnapshot[] = [];
    let rootTurns = 0;
    let stableAgentId = "";
    let replacementAgentId = "";
    let replacementRuns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childRequests.push(request);
          if (request.input === "Inspect collaboration controls") {
            await releaseInitialChild.promise;
            expect(request.state).toBeUndefined();
            return {
              text: "Initial inspection complete.",
              toolCalls: [],
              state: { round: 1 },
            };
          }
          if (request.input?.includes("Additional user instruction")) {
            expect(request.input).toContain("Focus on lifecycle state");
            expect(request.state).toEqual({ round: 1 });
            return {
              text: "Steered inspection complete.",
              toolCalls: [],
              state: { round: 1, steered: true },
            };
          }
          if (request.input === "Run a deeper check") {
            expect(request.state).toEqual({ round: 1, steered: true });
            expect(request.history).toEqual([
              { role: "user", text: "Inspect collaboration controls" },
              { role: "assistant", text: "Steered inspection complete." },
            ]);
            return {
              text: "Starting a deeper check.",
              toolCalls: [
                { id: "hold-follow-up", name: "hold_read", arguments: {} },
              ],
              state: { round: 2 },
            };
          }
          if (request.input === "Inspect replacement") {
            expect(request.state).toBeUndefined();
            replacementRuns += 1;
            return {
              text: `Replacement attempt ${replacementRuns} complete.`,
              toolCalls: [],
              state: { replacement: replacementRuns },
            };
          }
          expect(request.input).toBe("Summarize safely");
          expect(request.state).toEqual({ round: 2 });
          expect(request.history).toEqual([
            { role: "user", text: "Inspect collaboration controls" },
            { role: "assistant", text: "Steered inspection complete." },
          ]);
          return {
            text: "Safe summary complete.",
            toolCalls: [],
            state: { round: 3 },
          };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          expect(request.tools.map(({ name }) => name)).toEqual(
            expect.arrayContaining([
              "spawn_agent",
              "follow_up_agent",
              "retry_agent",
              "check_agents",
              "wait_for_agents",
              "steer_agent",
              "interrupt_agent",
              "close_agent",
            ]),
          );
          return {
            text: "Spawning an explorer.",
            toolCalls: [
              {
                id: "spawn-explorer",
                name: "spawn_agent",
                arguments: {
                  role: "explorer",
                  task: "Inspect collaboration controls",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          const spawned = JSON.parse(request.toolResults![0]!.output) as {
            id: string;
            agentThreadId: string;
          };
          stableAgentId = spawned.agentThreadId;
          expect(spawned.id).toBe(stableAgentId);
          return {
            text: "Steering the explorer.",
            toolCalls: [
              {
                id: "steer-explorer",
                name: "steer_agent",
                arguments: {
                  agentId: stableAgentId,
                  input: "Focus on lifecycle state",
                },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          releaseInitialChild.resolve();
          return {
            text: "Waiting for the steered result.",
            toolCalls: [
              {
                id: "wait-initial",
                name: "wait_for_agents",
                arguments: { agentIds: [stableAgentId] },
              },
            ],
          };
        }
        if (rootTurns === 4) {
          expect(request.toolResults?.[0]?.output).toContain(
            "Steered inspection complete",
          );
          return {
            text: "Following up with the same thread.",
            toolCalls: [
              {
                id: "follow-up-deeper",
                name: "follow_up_agent",
                arguments: {
                  agentId: stableAgentId,
                  input: "Run a deeper check",
                },
              },
            ],
          };
        }
        if (rootTurns === 5) {
          await holdStarted.promise;
          return {
            text: "Interrupting only the current turn.",
            toolCalls: [
              {
                id: "interrupt-deeper",
                name: "interrupt_agent",
                arguments: { agentId: stableAgentId },
              },
            ],
          };
        }
        if (rootTurns === 6) {
          return {
            text: "Continuing from the interrupted checkpoint.",
            toolCalls: [
              {
                id: "follow-up-summary",
                name: "follow_up_agent",
                arguments: {
                  agentId: stableAgentId,
                  input: "Summarize safely",
                },
              },
            ],
          };
        }
        if (rootTurns === 7) {
          return {
            text: "Collecting the final follow-up.",
            toolCalls: [
              {
                id: "wait-summary",
                name: "wait_for_agents",
                arguments: { agentIds: [stableAgentId] },
              },
            ],
          };
        }
        if (rootTurns === 8) {
          expect(request.toolResults?.[0]?.output).toContain(
            "Safe summary complete",
          );
          return {
            text: "Closing the child thread.",
            toolCalls: [
              {
                id: "close-explorer",
                name: "close_agent",
                arguments: { agentId: stableAgentId },
              },
            ],
          };
        }
        if (rootTurns === 9) {
          return {
            text: "Verifying that close is final.",
            toolCalls: [
              {
                id: "follow-up-after-close",
                name: "follow_up_agent",
                arguments: {
                  agentId: stableAgentId,
                  input: "This must not run",
                },
              },
            ],
          };
        }
        if (rootTurns === 10) {
          expect(request.toolResults?.[0]).toMatchObject({ isError: true });
          expect(request.toolResults?.[0]?.output).toContain(
            "unavailable for follow-up",
          );
          return {
            text: "Reusing the released agent slot.",
            toolCalls: [
              {
                id: "spawn-replacement",
                name: "spawn_agent",
                arguments: {
                  role: "explorer",
                  task: "Inspect replacement",
                },
              },
            ],
          };
        }
        if (rootTurns === 11) {
          const spawned = JSON.parse(request.toolResults![0]!.output) as {
            agentThreadId: string;
          };
          replacementAgentId = spawned.agentThreadId;
          expect(replacementAgentId).not.toBe(stableAgentId);
          return {
            text: "Waiting for the replacement.",
            toolCalls: [
              {
                id: "wait-replacement",
                name: "wait_for_agents",
                arguments: { agentIds: [replacementAgentId] },
              },
            ],
          };
        }
        if (rootTurns === 12) {
          expect(request.toolResults?.[0]?.output).toContain(
            "Replacement attempt 1 complete",
          );
          return {
            text: "Retrying the replacement from fresh state.",
            toolCalls: [
              {
                id: "retry-replacement",
                name: "retry_agent",
                arguments: { agentId: replacementAgentId },
              },
            ],
          };
        }
        if (rootTurns === 13) {
          const retried = JSON.parse(request.toolResults![0]!.output) as {
            agentThreadId: string;
            retryOf: string;
          };
          expect(retried.agentThreadId).toBe(replacementAgentId);
          expect(retried.retryOf).toBe(replacementAgentId);
          return {
            text: "Waiting for the retry.",
            toolCalls: [
              {
                id: "wait-retry",
                name: "wait_for_agents",
                arguments: { agentIds: [replacementAgentId] },
              },
            ],
          };
        }
        if (rootTurns === 14) {
          expect(request.toolResults?.[0]?.output).toContain(
            "Replacement attempt 2 complete",
          );
          return {
            text: "Closing the replacement after retry.",
            toolCalls: [
              {
                id: "close-replacement",
                name: "close_agent",
                arguments: { agentId: replacementAgentId },
              },
            ],
          };
        }
        return { text: "Collaboration lifecycle complete.", toolCalls: [] };
      },
    };
    const holdRead = defineTool({
      name: "hold_read",
      description: "Wait until interrupted",
      parameters: { type: "object" },
      mutability: "read",
      async execute(_arguments, context) {
        holdStarted.resolve();
        return new Promise<string>((_resolve, reject) => {
          const rejectInterrupted = () => reject(context.signal.reason);
          if (context.signal.aborted) rejectInterrupted();
          else {
            context.signal.addEventListener("abort", rejectInterrupted, {
              once: true,
            });
          }
        });
      },
    });
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "explorer",
          description: "Inspect",
          instructions: "PROFILE_EXPLORER",
          toolAccess: "read-only",
        },
      ],
      maxAgents: 1,
      onAgentTreeEvent: (event) => treeEvents.push(event),
      onRuntimeCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    });

    const result = await orchestrator.run(
      defineAgent({
        name: "root",
        instructions: "ROOT",
        tools: [holdRead],
      }),
      "Exercise collaboration",
    );

    expect(result.output).toBe("Collaboration lifecycle complete.");
    expect(childRequests).toHaveLength(6);
    const allChildTurns = orchestrator.snapshot.agents.filter(
      ({ parentId }) => parentId === orchestrator.snapshot.rootId,
    );
    const childTurns = allChildTurns.filter(
      ({ agentThreadId }) => agentThreadId === stableAgentId,
    );
    expect(allChildTurns).toHaveLength(5);
    expect(childTurns).toEqual([
      expect.objectContaining({
        id: stableAgentId,
        agentThreadId: stableAgentId,
        status: "completed",
      }),
      expect.objectContaining({
        agentThreadId: stableAgentId,
        followUpOf: stableAgentId,
        status: "interrupted",
      }),
      expect.objectContaining({
        agentThreadId: stableAgentId,
        followUpOf: childTurns[1]!.id,
        status: "completed",
        output: "Safe summary complete.",
      }),
    ]);
    expect(childTurns.every(({ closedAt }) => closedAt !== undefined)).toBe(
      true,
    );
    const replacementTurns = allChildTurns.filter(
      ({ agentThreadId }) => agentThreadId === replacementAgentId,
    );
    expect(replacementTurns).toEqual([
      expect.objectContaining({
        id: replacementAgentId,
        status: "completed",
        closedAt: expect.any(String),
      }),
      expect.objectContaining({
        retryOf: replacementAgentId,
        status: "completed",
        closedAt: expect.any(String),
      }),
    ]);
    expect(treeEvents.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        "steered",
        "followed_up",
        "interrupted",
        "closed",
      ]),
    );
    const finalCheckpoint = checkpoints.at(-1)!;
    expect(
      finalCheckpoint.agents
        .filter(({ task }) => task.parentId === finalCheckpoint.rootId)
        .map(({ task, modelState }) => ({
          followUpOf: task.followUpOf,
          status: task.status,
          closedAt: task.closedAt,
          modelState,
        })),
    ).toEqual([
      expect.objectContaining({
        status: "completed",
        modelState: { round: 1, steered: true },
      }),
      expect.objectContaining({
        status: "interrupted",
        modelState: { round: 2 },
      }),
      expect.objectContaining({
        status: "completed",
        modelState: { round: 3 },
      }),
      expect.objectContaining({
        status: "completed",
        modelState: { replacement: 1 },
      }),
      expect.objectContaining({
        status: "completed",
        modelState: { replacement: 2 },
      }),
    ]);
  });

  it("continues a durable subagent thread in a later parent run", async () => {
    let rootTurns = 0;
    let childRequests = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          childRequests += 1;
          if (childRequests === 1) {
            expect(request.input).toBe("Continue the persisted work");
            expect(request.state).toEqual({ round: 1 });
            expect(request.history).toEqual([
              { role: "user", text: "Initial persisted task" },
              { role: "assistant", text: "Initial persisted result" },
            ]);
            return {
              text: "First resumed result",
              toolCalls: [],
              state: { round: 2 },
            };
          }
          expect(request.input).toBe("Continue once more");
          expect(request.state).toEqual({ round: 2 });
          expect(request.history).toEqual([
            { role: "user", text: "Initial persisted task" },
            { role: "assistant", text: "Initial persisted result" },
            { role: "user", text: "Continue the persisted work" },
            { role: "assistant", text: "First resumed result" },
          ]);
          return {
            text: "Second resumed result",
            toolCalls: [],
            state: { round: 3 },
          };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Continuing the prior child turn.",
            toolCalls: [
              {
                id: "resume-prior-task",
                name: "follow_up_agent",
                arguments: {
                  agentId: "first-task",
                  input: "Continue the persisted work",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          const resumed = JSON.parse(request.toolResults![0]!.output) as {
            id: string;
            agentThreadId: string;
            followUpOf: string;
          };
          expect(resumed.id).not.toBe("prior-task");
          expect(resumed.agentThreadId).toBe("durable-thread");
          expect(resumed.followUpOf).toBe("prior-task");
          return {
            text: "Waiting for the resumed child.",
            toolCalls: [
              {
                id: "wait-resumed-task",
                name: "wait_for_agents",
                arguments: { agentIds: ["durable-thread"] },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          expect(request.toolResults?.[0]?.output).toContain(
            "First resumed result",
          );
          return {
            text: "Continuing the restored thread again.",
            toolCalls: [
              {
                id: "resume-thread-again",
                name: "follow_up_agent",
                arguments: {
                  agentId: "durable-thread",
                  input: "Continue once more",
                },
              },
            ],
          };
        }
        if (rootTurns === 4) {
          return {
            text: "Waiting for the second continuation.",
            toolCalls: [
              {
                id: "wait-second-resume",
                name: "wait_for_agents",
                arguments: { agentIds: ["durable-thread"] },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "Second resumed result",
        );
        return { text: "Durable continuation complete.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "worker",
          description: "Implement",
          instructions: "PROFILE_WORKER",
          toolAccess: "all",
        },
      ],
      resumableThreads: [
        {
          agentThreadId: "durable-thread",
          taskIds: ["first-task", "prior-task"],
          profileName: "worker",
          latestTask: {
            id: "prior-task",
            parentId: "prior-root",
            agentThreadId: "durable-thread",
            name: "worker",
            role: "worker",
            task: "Initial persisted task",
            status: "completed",
            phase: "done",
            createdAt: "2026-08-08T10:00:00.000Z",
            completedAt: "2026-08-08T10:00:01.000Z",
            elapsedMs: 1_000,
            output: "Initial persisted result",
            activities: [],
            transcript: [],
          },
          history: [
            { role: "user", text: "Initial persisted task" },
            { role: "assistant", text: "Initial persisted result" },
          ],
          modelState: { round: 1 },
        },
      ],
      maxAgents: 1,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Continue earlier work",
    );

    expect(result.output).toBe("Durable continuation complete.");
    const childTurns = orchestrator.snapshot.agents.filter(
      ({ parentId }) => parentId === orchestrator.snapshot.rootId,
    );
    expect(childTurns).toHaveLength(2);
    expect(childTurns).toEqual([
      expect.objectContaining({
        agentThreadId: "durable-thread",
        followUpOf: "prior-task",
        status: "completed",
      }),
      expect.objectContaining({
        agentThreadId: "durable-thread",
        followUpOf: childTurns[0]!.id,
        status: "completed",
      }),
    ]);
  });

  it("counts open persisted threads against the conversation limit until explicitly closed", async () => {
    let rootTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          expect(request.input).toBe("Independent replacement");
          return { text: "Replacement complete", toolCalls: [] };
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Trying an independent task.",
            toolCalls: [
              {
                id: "spawn-before-close",
                name: "spawn_agent",
                arguments: {
                  role: "worker",
                  task: "Independent replacement",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          expect(request.toolResults?.[0]).toMatchObject({ isError: true });
          expect(request.toolResults?.[0]?.output).toContain(
            "Subagent limit reached (1)",
          );
          return {
            text: "Closing the old thread first.",
            toolCalls: [
              {
                id: "close-old-thread",
                name: "close_agent",
                arguments: { agentId: "old-task" },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          return {
            text: "Starting the independent replacement.",
            toolCalls: [
              {
                id: "spawn-after-close",
                name: "spawn_agent",
                arguments: {
                  role: "worker",
                  task: "Independent replacement",
                },
              },
            ],
          };
        }
        if (rootTurns === 4) {
          expect(request.toolResults?.[0]?.isError).toBeUndefined();
          return {
            text: "Collecting the replacement.",
            toolCalls: [
              {
                id: "wait-replacement",
                name: "wait_for_agents",
                arguments: {},
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "Replacement complete",
        );
        return { text: "The old slot was released.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "worker",
          description: "Implement",
          instructions: "PROFILE_WORKER",
          toolAccess: "all",
        },
      ],
      resumableThreads: [
        {
          agentThreadId: "old-thread",
          taskIds: ["old-task"],
          profileName: "worker",
          latestTask: {
            id: "old-task",
            parentId: "prior-root",
            agentThreadId: "old-thread",
            name: "worker",
            role: "worker",
            task: "Old task",
            status: "completed",
            phase: "done",
            createdAt: "2026-08-08T10:00:00.000Z",
            completedAt: "2026-08-08T10:00:01.000Z",
            elapsedMs: 1_000,
            output: "Old result",
            activities: [],
            transcript: [],
          },
          history: [
            { role: "user", text: "Old task" },
            { role: "assistant", text: "Old result" },
          ],
        },
      ],
      maxAgents: 1,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Manage conversation agent slots",
    );

    expect(result.output).toBe("The old slot was released.");
  });

  it("reports precise lifecycle errors and explicitly closes a dormant persisted thread", async () => {
    let rootTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Checking persisted lifecycle states.",
            toolCalls: [
              {
                id: "busy-follow-up",
                name: "follow_up_agent",
                arguments: { agentId: "busy-thread", input: "Continue" },
              },
              {
                id: "closed-follow-up",
                name: "follow_up_agent",
                arguments: { agentId: "closed-thread", input: "Continue" },
              },
              {
                id: "missing-follow-up",
                name: "follow_up_agent",
                arguments: { agentId: "missing-thread", input: "Continue" },
              },
              {
                id: "stateless-follow-up",
                name: "follow_up_agent",
                arguments: { agentId: "stateless-thread", input: "Continue" },
              },
              {
                id: "detached-steer",
                name: "steer_agent",
                arguments: { agentId: "dormant-thread", input: "Focus" },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          expect(request.toolResults?.map(({ error }) => error?.code)).toEqual([
            "agent_busy",
            "agent_closed",
            "agent_not_found",
            "agent_state_unavailable",
            "agent_not_attached",
          ]);
          return {
            text: "Closing the dormant thread.",
            toolCalls: [
              {
                id: "close-dormant",
                name: "close_agent",
                arguments: { agentId: "old-dormant-task" },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          expect(request.toolResults?.[0]?.isError).toBeUndefined();
          return {
            text: "Verifying the explicit close.",
            toolCalls: [
              {
                id: "follow-up-closed-dormant",
                name: "follow_up_agent",
                arguments: { agentId: "dormant-thread", input: "Continue" },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]).toMatchObject({
          isError: true,
          error: { code: "agent_closed", retryable: false },
        });
        return { text: "Lifecycle states are explicit.", toolCalls: [] };
      },
    };
    const task = (
      id: string,
      agentThreadId: string,
      status: "running" | "completed",
      closedAt?: string,
    ) => ({
      id,
      parentId: "prior-root",
      agentThreadId,
      name: "worker",
      role: "worker",
      task: `Task for ${id}`,
      status,
      phase: status === "running" ? ("thinking" as const) : ("done" as const),
      createdAt: "2026-08-08T10:00:00.000Z",
      ...(status === "running"
        ? { startedAt: "2026-08-08T10:00:01.000Z" }
        : { completedAt: "2026-08-08T10:00:01.000Z" }),
      ...(closedAt ? { closedAt } : {}),
      elapsedMs: 1_000,
      latestActivity: status === "running" ? "Thinking" : "Completed",
      activities: [],
      transcript: [],
    });
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "worker",
          description: "Implement",
          instructions: "PROFILE_WORKER",
          toolAccess: "all",
        },
      ],
      resumableThreads: [
        {
          agentThreadId: "busy-thread",
          taskIds: ["busy-task"],
          profileName: "worker",
          latestTask: task("busy-task", "busy-thread", "running"),
          history: [],
        },
        {
          agentThreadId: "closed-thread",
          taskIds: ["closed-task"],
          profileName: "worker",
          latestTask: task(
            "closed-task",
            "closed-thread",
            "completed",
            "2026-08-08T10:00:02.000Z",
          ),
          history: [{ role: "assistant", text: "Closed result" }],
        },
        {
          agentThreadId: "stateless-thread",
          taskIds: ["stateless-task"],
          profileName: "worker",
          latestTask: task("stateless-task", "stateless-thread", "completed"),
          history: [],
        },
        {
          agentThreadId: "dormant-thread",
          taskIds: ["old-dormant-task"],
          profileName: "worker",
          latestTask: {
            ...task("old-dormant-task", "dormant-thread", "completed"),
            output: "Dormant result",
          },
          history: [
            { role: "user", text: "Dormant task" },
            { role: "assistant", text: "Dormant result" },
          ],
          modelState: { durable: true },
        },
      ],
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Inspect lifecycle states",
    );

    expect(result.output).toBe("Lifecycle states are explicit.");
    expect(orchestrator.runtimeSnapshot.closedAgentThreads).toContainEqual({
      agentThreadId: "dormant-thread",
      closedAt: expect.any(String),
    });
  });

  it("checks status and returns partial mailbox or timeout snapshots without waiting for every agent", async () => {
    const releaseFast = Promise.withResolvers<void>();
    let rootTurns = 0;
    let fastAgentId = "";
    let stuckAgentId = "";
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          if (request.input === "Fast check") {
            await releaseFast.promise;
            return { text: "Fast result", toolCalls: [] };
          }
          if (request.input === "Recover after interrupt") {
            return { text: "Recovered follow-up", toolCalls: [] };
          }
          expect(request.input).toBe("Stuck check");
          return new Promise<ModelTurn>(() => undefined);
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting a fast and a stuck check.",
            toolCalls: [
              {
                id: "spawn-fast",
                name: "spawn_agent",
                arguments: { role: "explorer", task: "Fast check" },
              },
              {
                id: "spawn-stuck",
                name: "spawn_agent",
                arguments: { role: "explorer", task: "Stuck check" },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          const fast = JSON.parse(request.toolResults![0]!.output) as {
            agentThreadId: string;
          };
          const stuck = JSON.parse(request.toolResults![1]!.output) as {
            agentThreadId: string;
          };
          fastAgentId = fast.agentThreadId;
          stuckAgentId = stuck.agentThreadId;
          return {
            text: "Checking without blocking.",
            toolCalls: [
              {
                id: "check-both",
                name: "check_agents",
                arguments: { agentIds: [fastAgentId, stuckAgentId] },
              },
            ],
          };
        }
        if (rootTurns === 3) {
          const checked = JSON.parse(request.toolResults![0]!.output) as {
            activeAgentIds: string[];
            agents: Array<{ id: string; status: string }>;
          };
          expect(checked.agents).toEqual([
            expect.objectContaining({ id: fastAgentId, status: "running" }),
            expect.objectContaining({ id: stuckAgentId, status: "running" }),
          ]);
          expect(checked.activeAgentIds).toEqual([fastAgentId, stuckAgentId]);
          setTimeout(() => releaseFast.resolve(), 0);
          return {
            text: "Waiting for the first mailbox update.",
            toolCalls: [
              {
                id: "wait-first",
                name: "wait_for_agents",
                arguments: {
                  agentIds: [fastAgentId, stuckAgentId],
                  timeoutMs: 1_000,
                },
              },
            ],
          };
        }
        if (rootTurns === 4) {
          const partial = JSON.parse(request.toolResults![0]!.output) as {
            wakeReason: string;
            timedOut: boolean;
            activeAgentIds: string[];
            terminalAgentIds: string[];
            agents: Array<{ id: string; status: string; output?: string }>;
          };
          expect(partial.wakeReason).toBe("agent_updated");
          expect(partial.timedOut).toBe(false);
          expect(partial.activeAgentIds).toEqual([stuckAgentId]);
          expect(partial.terminalAgentIds).toEqual([fastAgentId]);
          expect(partial.agents).toEqual([
            expect.objectContaining({
              id: fastAgentId,
              status: "completed",
              output: "Fast result",
            }),
            expect.objectContaining({ id: stuckAgentId, status: "running" }),
          ]);
          return {
            text: "Taking a bounded snapshot of the stuck check.",
            toolCalls: [
              {
                id: "wait-timeout",
                name: "wait_for_agents",
                arguments: { agentIds: [stuckAgentId], timeoutMs: 10 },
              },
            ],
          };
        }
        if (rootTurns === 5) {
          const timedOut = JSON.parse(request.toolResults![0]!.output) as {
            wakeReason: string;
            timedOut: boolean;
            activeAgentIds: string[];
            agents: Array<{ id: string; status: string }>;
          };
          expect(timedOut).toMatchObject({
            wakeReason: "timeout",
            timedOut: true,
            activeAgentIds: [stuckAgentId],
          });
          expect(timedOut.agents).toEqual([
            expect.objectContaining({ id: stuckAgentId, status: "running" }),
          ]);
          return {
            text: "Checking the same threads after timeout.",
            toolCalls: [
              {
                id: "check-after-timeout",
                name: "check_agents",
                arguments: { agentIds: [fastAgentId, stuckAgentId] },
              },
            ],
          };
        }
        if (rootTurns === 6) {
          expect(request.toolResults?.[0]?.output).toContain('"running"');
          expect(request.toolResults?.[0]?.output).toContain('"completed"');
          return {
            text: "Interrupting the stuck check.",
            toolCalls: [
              {
                id: "interrupt-stuck",
                name: "interrupt_agent",
                arguments: { agentId: stuckAgentId },
              },
            ],
          };
        }
        if (rootTurns === 7) {
          return {
            text: "Collecting the interrupted terminal state.",
            toolCalls: [
              {
                id: "wait-interrupted",
                name: "wait_for_agents",
                arguments: { agentIds: [stuckAgentId], timeoutMs: 100 },
              },
            ],
          };
        }
        if (rootTurns === 8) {
          const interrupted = JSON.parse(request.toolResults![0]!.output) as {
            wakeReason: string;
            timedOut: boolean;
            agents: Array<{ status: string }>;
          };
          expect(interrupted).toMatchObject({
            wakeReason: "all_terminal",
            timedOut: false,
          });
          expect(interrupted.agents).toEqual([
            expect.objectContaining({ status: "interrupted" }),
          ]);
          return {
            text: "Following up after the unresponsive execution detached.",
            toolCalls: [
              {
                id: "follow-up-after-interrupt",
                name: "follow_up_agent",
                arguments: {
                  agentId: stuckAgentId,
                  input: "Recover after interrupt",
                },
              },
            ],
          };
        }
        if (rootTurns === 9) {
          return {
            text: "Collecting the recovered follow-up.",
            toolCalls: [
              {
                id: "wait-recovered",
                name: "wait_for_agents",
                arguments: { agentIds: [stuckAgentId], timeoutMs: 1_000 },
              },
            ],
          };
        }
        if (rootTurns === 10) {
          expect(request.toolResults?.[0]?.output).toContain(
            "Recovered follow-up",
          );
          return { text: "Bounded collaboration complete.", toolCalls: [] };
        }
        throw new Error(`Unexpected root turn ${rootTurns}`);
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "explorer",
          description: "Inspect",
          instructions: "PROFILE_EXPLORER",
          toolAccess: "read-only",
        },
      ],
      maxConcurrent: 2,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT", maxSteps: 14 }),
      "Exercise bounded waiting",
    );

    expect(result.output).toBe("Bounded collaboration complete.");
  });

  it("keeps tools activated during a turn visible to the parent model", async () => {
    let turns = 0;
    const tools: Tool[] = [
      defineTool({
        name: "activate_tool",
        description: "Activate another tool",
        parameters: { type: "object" },
        mutability: "read",
        async execute() {
          tools.push(
            defineTool({
              name: "dynamic_read",
              description: "Dynamically activated read",
              parameters: { type: "object" },
              mutability: "read",
              async execute() {
                return "dynamic";
              },
            }),
          );
          return "activated";
        },
      }),
    ];
    const provider: ModelProvider = {
      async generate(request) {
        turns += 1;
        if (turns === 1) {
          return {
            text: "Activating.",
            toolCalls: [
              { id: "activate", name: "activate_tool", arguments: {} },
            ],
          };
        }
        expect(request.tools.map(({ name }) => name)).toContain("dynamic_read");
        return { text: "Dynamic tool is visible", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "explorer",
          description: "Inspect",
          instructions: "Inspect",
          toolAccess: "read-only",
        },
      ],
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT", tools }),
      "Activate",
    );

    expect(result.output).toBe("Dynamic tool is visible");
  });

  it("supports nested delegation, stable task addressing, follow-up context, and child-to-parent messages", async () => {
    let rootTurns = 0;
    let coordinatorTurns = 0;
    let researcherTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (
          request.instructions.includes("You are /root/coordinator/evidence")
        ) {
          researcherTurns += 1;
          if (researcherTurns === 1) {
            expect(request.input).toBe("Collect the first fact");
            expect(request.tools.map(({ name }) => name)).toEqual(
              expect.arrayContaining([
                "spawn_agent",
                "send_message",
                "followup_task",
              ]),
            );
            return {
              text: "First fact",
              toolCalls: [],
              state: { evidenceRound: 1 },
            };
          }
          expect(request.input).toBe("Refine the fact");
          expect(request.state).toEqual({ evidenceRound: 1 });
          expect(request.history).toEqual([
            { role: "user", text: "Collect the first fact" },
            { role: "assistant", text: "First fact" },
          ]);
          return {
            text: "Refined fact",
            toolCalls: [],
            state: { evidenceRound: 2 },
          };
        }

        if (request.instructions.includes("You are /root/coordinator")) {
          coordinatorTurns += 1;
          if (coordinatorTurns === 1) {
            return {
              text: "Delegating evidence collection.",
              toolCalls: [
                {
                  id: "spawn-evidence",
                  name: "spawn_agent",
                  arguments: {
                    role: "reader",
                    taskName: "evidence",
                    task: "Collect the first fact",
                  },
                },
              ],
            };
          }
          if (coordinatorTurns === 2) {
            return {
              text: "Waiting for evidence.",
              toolCalls: [
                { id: "wait-evidence", name: "wait_for_agents", arguments: {} },
              ],
            };
          }
          if (coordinatorTurns === 3) {
            expect(request.toolResults?.[0]?.output).toContain("First fact");
            return {
              text: "Continuing the same researcher.",
              toolCalls: [
                {
                  id: "followup-evidence",
                  name: "followup_task",
                  arguments: {
                    target: "evidence",
                    message: "Refine the fact",
                  },
                },
              ],
            };
          }
          if (coordinatorTurns === 4) {
            return {
              text: "Waiting for refined evidence.",
              toolCalls: [
                {
                  id: "wait-refined-evidence",
                  name: "wait_for_agents",
                  arguments: { agentIds: ["evidence"] },
                },
              ],
            };
          }
          if (coordinatorTurns === 5) {
            expect(request.toolResults?.[0]?.output).toContain("Refined fact");
            return {
              text: "Reporting to the main agent.",
              toolCalls: [
                {
                  id: "message-root",
                  name: "send_message",
                  arguments: {
                    target: "/root",
                    message: "Nested research produced a refined fact.",
                  },
                },
              ],
            };
          }
          return { text: "Coordinator complete.", toolCalls: [] };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting a coordinator.",
            toolCalls: [
              {
                id: "spawn-coordinator",
                name: "spawn_agent",
                arguments: {
                  role: "reader",
                  taskName: "coordinator",
                  task: "Coordinate nested research",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Waiting for the hierarchy.",
            toolCalls: [
              {
                id: "wait-coordinator",
                name: "wait_for_agents",
                arguments: {},
              },
            ],
          };
        }
        expect(request.input).toContain("Message from coordinator");
        expect(request.input).toContain(
          "Nested research produced a refined fact.",
        );
        return { text: "Nested collaboration complete.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "reader",
          description: "Read and coordinate",
          instructions: "PROFILE_READER",
          toolAccess: "read-only",
        },
      ],
      maxConcurrent: 3,
      maxDepth: 3,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT", maxSteps: 12 }),
      "Run nested collaboration",
    );

    expect(result.output).toBe("Nested collaboration complete.");
    const coordinator = orchestrator.snapshot.agents.find(
      ({ agentPath }) => agentPath === "/root/coordinator",
    );
    const evidenceTurns = orchestrator.snapshot.agents.filter(
      ({ agentPath }) => agentPath === "/root/coordinator/evidence",
    );
    expect(coordinator).toEqual(
      expect.objectContaining({
        parentId: orchestrator.snapshot.rootId,
        name: "coordinator",
        status: "completed",
      }),
    );
    expect(evidenceTurns).toHaveLength(2);
    expect(evidenceTurns[0]).toEqual(
      expect.objectContaining({
        parentId: coordinator?.agentThreadId,
        name: "evidence",
        status: "completed",
      }),
    );
    expect(evidenceTurns[1]).toEqual(
      expect.objectContaining({
        agentThreadId: evidenceTurns[0]?.agentThreadId,
        followUpOf: evidenceTurns[0]?.id,
        messages: [
          expect.objectContaining({
            fromAgentName: "coordinator",
            delivery: "follow_up",
            text: "Refine the fact",
          }),
        ],
      }),
    );
    expect(
      orchestrator.snapshot.agents.find(
        ({ id }) => id === orchestrator.snapshot.rootId,
      )?.messages,
    ).toEqual([
      expect.objectContaining({
        fromAgentName: "coordinator",
        delivery: "active",
      }),
    ]);
  });

  it("lets a read-only peer continue another idle peer without root relaying", async () => {
    let rootTurns = 0;
    let firstPeerTurns = 0;
    let secondPeerTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("You are /root/peer_a")) {
          firstPeerTurns += 1;
          if (firstPeerTurns === 1) {
            return {
              text: "Peer A opening",
              toolCalls: [],
              state: { peerRound: 1 },
            };
          }
          expect(request.input).toBe("Reply directly to Peer B");
          expect(request.state).toEqual({ peerRound: 1 });
          expect(request.history).toEqual([
            { role: "user", text: "Publish an opening" },
            { role: "assistant", text: "Peer A opening" },
          ]);
          return {
            text: "Peer A direct reply",
            toolCalls: [],
            state: { peerRound: 2 },
          };
        }

        if (request.instructions.includes("You are /root/peer_b")) {
          secondPeerTurns += 1;
          if (secondPeerTurns === 1) {
            return {
              text: "Waiting for Peer A.",
              toolCalls: [
                {
                  id: "wait-peer-a-opening",
                  name: "wait_for_agents",
                  arguments: { agentIds: ["peer_a"] },
                },
              ],
            };
          }
          if (secondPeerTurns === 2) {
            expect(request.toolResults?.[0]?.output).toContain(
              "Peer A opening",
            );
            return {
              text: "Asking Peer A directly.",
              toolCalls: [
                {
                  id: "peer-followup",
                  name: "followup_task",
                  arguments: {
                    target: "peer_a",
                    message: "Reply directly to Peer B",
                  },
                },
              ],
            };
          }
          if (secondPeerTurns === 3) {
            return {
              text: "Waiting for the direct reply.",
              toolCalls: [
                {
                  id: "wait-peer-a-reply",
                  name: "wait_for_agents",
                  arguments: { agentIds: ["peer_a"] },
                },
              ],
            };
          }
          expect(request.toolResults?.[0]?.output).toContain(
            "Peer A direct reply",
          );
          return { text: "Peer dialogue complete.", toolCalls: [] };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting two peers.",
            toolCalls: [
              {
                id: "spawn-peer-a",
                name: "spawn_agent",
                arguments: {
                  role: "reader",
                  taskName: "peer_a",
                  task: "Publish an opening",
                },
              },
              {
                id: "spawn-peer-b",
                name: "spawn_agent",
                arguments: {
                  role: "reader",
                  taskName: "peer_b",
                  task: "Wait for peer_a, then continue it directly",
                },
              },
            ],
          };
        }
        const statusOutput = request.toolResults?.[0]?.output;
        const status = statusOutput?.startsWith("{")
          ? (JSON.parse(statusOutput) as { activeAgentIds?: string[] })
          : undefined;
        if (
          rootTurns === 2 ||
          (status?.activeAgentIds?.length ?? 0) > 0 ||
          request.input?.includes("Subagent")
        ) {
          return {
            text: "Waiting without relaying peer content.",
            toolCalls: [
              {
                id: `root-wait-${rootTurns}`,
                name: "wait_for_agents",
                arguments: {},
              },
            ],
          };
        }
        return { text: "Peer-to-peer flow complete.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "reader",
          description: "Read-only peer",
          instructions: "PROFILE_READER",
          toolAccess: "read-only",
        },
      ],
      maxConcurrent: 3,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT", maxSteps: 12 }),
      "Run peer dialogue",
    );

    expect(result.output).toBe("Peer-to-peer flow complete.");
    const peerATurns = orchestrator.snapshot.agents.filter(
      ({ agentPath }) => agentPath === "/root/peer_a",
    );
    expect(peerATurns).toHaveLength(2);
    expect(peerATurns[1]).toEqual(
      expect.objectContaining({
        followUpOf: peerATurns[0]?.id,
        messages: [
          expect.objectContaining({
            fromAgentName: "peer_b",
            delivery: "follow_up",
          }),
        ],
      }),
    );
    const root = orchestrator.snapshot.agents.find(
      ({ id }) => id === orchestrator.snapshot.rootId,
    );
    expect(
      root?.transcript
        .filter(({ kind }) => kind === "tool")
        .map((entry) => (entry.kind === "tool" ? entry.name : undefined)),
    ).not.toContain("followup_task");
  });

  it("rejects nested write ownership that could deadlock the hierarchy", async () => {
    let rootTurns = 0;
    let writerTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          writerTurns += 1;
          if (writerTurns === 1) {
            return {
              text: "Trying unsafe nested write delegation.",
              toolCalls: [
                {
                  id: "nested-writer",
                  name: "spawn_agent",
                  arguments: {
                    role: "writer",
                    taskName: "nested_writer",
                    task: "Write from a nested agent",
                  },
                },
              ],
            };
          }
          expect(request.toolResults?.[0]).toEqual(
            expect.objectContaining({
              isError: true,
              error: expect.objectContaining({ code: "agent_write_conflict" }),
            }),
          );
          return { text: "Unsafe delegation rejected.", toolCalls: [] };
        }

        rootTurns += 1;
        if (rootTurns === 1) {
          return {
            text: "Starting writer.",
            toolCalls: [
              {
                id: "spawn-writer",
                name: "spawn_agent",
                arguments: {
                  role: "writer",
                  taskName: "writer",
                  task: "Own the workspace",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Waiting for writer.",
            toolCalls: [
              { id: "wait-writer", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        return { text: "Write ownership remained safe.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "writer",
          description: "Write",
          instructions: "PROFILE_WRITER",
          toolAccess: "all",
        },
      ],
      maxConcurrent: 2,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Protect write ownership",
    );

    expect(result.output).toBe("Write ownership remained safe.");
    expect(
      orchestrator.snapshot.agents.filter(
        ({ agentPath }) => agentPath === "/root/writer/nested_writer",
      ),
    ).toHaveLength(0);
  });
});
