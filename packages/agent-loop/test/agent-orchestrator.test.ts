import { describe, expect, it } from "vitest";

import { AgentLoop } from "../src/agent-loop.js";
import { AgentOrchestrator } from "../src/agent-orchestrator.js";
import { defineAgent, defineTool } from "../src/types.js";
import type {
  AgentTreeEvent,
  ModelProvider,
  ModelRequest,
  ModelTurn,
  Tool,
} from "../src/types.js";

describe("AgentOrchestrator", () => {
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
    expect(retried).toMatchObject({ retryOf: childId, status: "queued" });

    const result = await resultPromise;
    expect(result.output).toBe("Parent completed after retry");
    expect(orchestrator.snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: childId, status: "cancelled" }),
        expect.objectContaining({ retryOf: childId, status: "completed" }),
      ]),
    );
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
});
