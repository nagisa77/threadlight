import { describe, expect, it } from "vitest";

import { AgentLoop } from "../src/agent-loop.js";
import { AgentOrchestrator } from "../src/agent-orchestrator.js";
import { defineAgent, type ModelProvider } from "../src/types.js";

describe("AgentOrchestrator context delivery", () => {
  it("delivers incremental summaries, reads exact results on demand, and prunes leaf context", async () => {
    const rootToolOutputs: Record<string, string> = {};
    let rootTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          expect(request.instructions).toContain("Leaf execution capsule");
          expect(request.instructions).toContain("PROJECT_RULE_CAPSULE");
          expect(request.instructions).not.toContain("ROOT_SECRET");
          expect(request.tools.map(({ name }) => name)).not.toEqual(
            expect.arrayContaining([
              "spawn_agent",
              "check_agents",
              "wait_for_agents",
              "read_agent_result",
            ]),
          );
          return {
            text: `${"A".repeat(400)}EXACT_TAIL`,
            toolCalls: [],
          };
        }

        rootTurns += 1;
        if (request.toolResults?.[0]) {
          rootToolOutputs[request.toolResults[0].name] =
            request.toolResults[0].output;
        }
        if (rootTurns === 1) {
          return {
            text: "Delegate",
            toolCalls: [
              {
                id: "spawn-leaf",
                name: "spawn_agent",
                arguments: {
                  role: "leaf",
                  task: "Return the exact probe output",
                  taskName: "probe",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Wait",
            toolCalls: [
              { id: "wait-leaf", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        if (rootTurns === 3) {
          expect(rootToolOutputs.wait_for_agents).toContain('"summary"');
          expect(rootToolOutputs.wait_for_agents).not.toContain("EXACT_TAIL");
          return {
            text: "Check again",
            toolCalls: [
              { id: "check-leaf", name: "check_agents", arguments: {} },
            ],
          };
        }
        if (rootTurns === 4) {
          expect(rootToolOutputs.check_agents).toContain('"agents":[]');
          expect(rootToolOutputs.check_agents).toContain('"unchangedAgentIds"');
          return {
            text: "Read exact result",
            toolCalls: [
              {
                id: "read-leaf",
                name: "read_agent_result",
                arguments: { target: "probe" },
              },
            ],
          };
        }
        expect(rootToolOutputs.read_agent_result).toContain("EXACT_TAIL");
        expect(rootToolOutputs.read_agent_result).toContain(
          '"truncated":false',
        );
        return { text: "Done", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles: [
        {
          name: "leaf",
          description: "Focused leaf",
          instructions: "LEAF_ONLY",
          toolAccess: "read-only",
          leaf: true,
        },
      ],
      createChildRunOptions: () => ({
        instructionCapsule: "PROJECT_RULE_CAPSULE",
      }),
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT_SECRET" }),
      "Run probe",
    );
    expect(result.output).toBe("Done");
  });
});
