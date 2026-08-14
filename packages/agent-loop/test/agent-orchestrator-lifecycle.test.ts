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

describe("AgentOrchestrator lifecycle", () => {
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
