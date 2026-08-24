import { describe, expect, it, vi } from "vitest";

import { ModelSession } from "../src/model-session.js";
import { mergeAdditionalInput, skippedToolResult } from "../src/run-input.js";
import { RunStatistics } from "../src/run-statistics.js";
import { defineAgent, defineTool } from "../src/types.js";

describe("agent-loop runtime modules", () => {
  it("keeps token and duration accounting isolated from loop state", () => {
    let clock = 10;
    const statistics = new RunStatistics(() => clock);
    const startedAt = statistics.now();

    statistics.addUsage({ inputTokens: 7, totalTokens: 9 });
    statistics.addUsage({ outputTokens: 3, totalTokens: 3 });
    clock = 15.26;

    expect(statistics.elapsedSince(startedAt)).toBe(5.3);
    expect(statistics.snapshot()).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 12,
    });
  });

  it("owns opaque state and visible fallback replacement as one model session", async () => {
    const agent = defineAgent({ name: "worker", instructions: "Inspect" });
    const session = new ModelSession({
      history: [{ role: "user", text: "Earlier" }],
      modelState: { opaque: "initial" },
    });
    const first = session.createRequest({
      runId: "run-1",
      step: 1,
      agent,
      request: {
        instructions: agent.instructions,
        input: "Start",
        toolResults: [],
        tools: [],
      },
    });
    expect(first.request).toMatchObject({
      state: { opaque: "initial" },
      history: [{ role: "user", text: "Earlier" }],
    });

    session.completeTurn({
      text: "Checking",
      toolCalls: [{ id: "call-1", name: "read", arguments: { path: "a" } }],
      state: { opaque: "call-1" },
      usage: { totalTokens: 90 },
    });
    const beforeModelRequest = vi.fn(async ({ fallbackHistory }) => ({
      history: fallbackHistory,
      clearModelState: true as const,
      consumePendingContext: true as const,
    }));
    const second = await session.prepareRequest({
      runId: "run-1",
      step: 2,
      agent,
      request: {
        instructions: agent.instructions,
        input: "Continue",
        toolResults: [{ callId: "call-1", name: "read", output: "contents" }],
        tools: [],
      },
      beforeModelRequest,
    });

    expect(beforeModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        previousModelUsage: { totalTokens: 90 },
        request: expect.objectContaining({ state: { opaque: "call-1" } }),
      }),
    );
    expect(second.request).toMatchObject({
      input: undefined,
      state: undefined,
      toolResults: [],
    });
    expect(second.request.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCalls: [expect.objectContaining({ id: "call-1", name: "read" })],
        }),
        expect.objectContaining({
          toolResults: [
            expect.objectContaining({
              callId: "call-1",
              name: "read",
              output: "contents",
            }),
          ],
        }),
        expect.objectContaining({ role: "user", text: "Continue" }),
      ]),
    );
    expect(
      second.request.history?.map(({ text }) => text).join("\n"),
    ).not.toContain("<tool_call>");
    expect(session.compactionCheckpoint(2, statisticsUsage())).toMatchObject({
      phase: "context_compacted",
      modelState: undefined,
      contextTokens: 0,
      contextHistory: expect.any(Array),
    });
  });

  it("isolates active-run input merging and skipped tool results", () => {
    const tool = defineTool({
      name: "read",
      description: "Read",
      parameters: { type: "object" },
      kind: "computer",
      async execute() {},
    });

    expect(mergeAdditionalInput("Initial", "  New direction  ")).toBe(
      "Initial\n\n[Additional user instruction received while the run was active]\nNew direction",
    );
    expect(
      skippedToolResult({ id: "call-1", name: "read", arguments: {} }, [tool]),
    ).toMatchObject({
      callId: "call-1",
      name: "read",
      kind: "computer",
      isError: true,
    });
  });
});

function statisticsUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}
