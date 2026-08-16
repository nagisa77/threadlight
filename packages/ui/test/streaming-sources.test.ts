import { describe, expect, it } from "vitest";

import { initialSessionState, sessionReducer } from "../src/session.js";

describe("streaming sources", () => {
  it("hydrates citations before the assistant response completes", () => {
    const state = sessionReducer(initialSessionState, {
      type: "agent.event",
      revision: 2,
      activeTurn: {
        turnId: "turn-1",
        revision: 2,
        mode: "default",
        isThinking: false,
        streamingText: "Fact.[1](threadlight-source:citation-1)",
        progress: [],
        sources: [
          {
            id: "s1",
            title: "Threadlight",
            url: "https://threadlight.xyz",
            domain: "threadlight.xyz",
          },
        ],
        citations: [
          {
            id: "citation-1",
            sourceIds: ["s1"],
            excerpt: "Fact.",
          },
        ],
      },
      event: {
        type: "model.completed",
        runId: "run-1",
        step: 1,
        text: "Fact.[[source:s1]]",
        toolCalls: [],
      },
    });

    expect(state.streamingText).toContain("threadlight-source:citation-1");
    expect(state.streamingSources).toMatchObject([{ id: "s1" }]);
    expect(state.streamingCitations).toMatchObject([
      { id: "citation-1", sourceIds: ["s1"] },
    ]);
  });
});
