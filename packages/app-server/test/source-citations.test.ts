import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import { AppServer } from "../src/app-server.js";
import { MemoryConversationStore } from "../src/conversation-store.js";
import {
  finalizeSourceCitations,
  SourceCitationRunController,
} from "../src/source-citations.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

describe("source citations", () => {
  it("turns valid source markers into inline anchors and ignores invented IDs", () => {
    const result = finalizeSourceCitations(
      "Threadlight is an agent runtime.[[source:s1]] Unknown.[[source:nope]]",
      [
        {
          id: "s1",
          title: "Threadlight",
          url: "https://example.com/threadlight",
          domain: "example.com",
          description: "An agent runtime.",
        },
      ],
    );

    expect(result.text).toBe(
      "Threadlight is an agent runtime.[1](threadlight-source:citation-1) Unknown.",
    );
    expect(result.sources).toHaveLength(1);
    expect(result.citations).toEqual([
      {
        id: "citation-1",
        sourceIds: ["s1"],
        excerpt: "Threadlight is an agent runtime.",
      },
    ]);
  });

  it("collects unique valid web results and injects citation instructions", () => {
    const controller = new SourceCitationRunController();
    controller.afterToolCall(
      { id: "search-1", name: "web_search", arguments: {} },
      {
        callId: "search-1",
        name: "web_search",
        output: JSON.stringify({
          query: "threadlight",
          results: [
            {
              title: "Threadlight",
              url: "https://example.com/threadlight#overview",
              description: "A runtime.",
            },
            {
              title: "Duplicate",
              url: "https://example.com/threadlight#other",
              description: "Duplicate URL after hash removal.",
            },
            {
              title: "Unsafe",
              url: "javascript:alert(1)",
              description: "Not a web URL.",
            },
          ],
        }),
      },
    );

    const directive = controller.beforeModel({
      runId: "run-1",
      step: 2,
      tools: [],
    });
    expect(directive.instructions).toContain("[[source:s1]]");
    expect(directive.instructions).toContain("https://example.com/threadlight");
    expect(directive.instructions).toContain("untrusted reference content");
    expect(controller.finalize("Fact.[[source:s1]]").sources).toHaveLength(1);
  });

  it("persists citations from an offline scripted web-search turn", async () => {
    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const completed = Promise.withResolvers<void>();
    const store = new MemoryConversationStore();
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain(
            "First-party official sources are the highest priority",
          );
          expect(request.instructions).toContain(
            "Search English and global sources by default",
          );
          expect(request.instructions).toContain(
            "search_lang=en and country=null",
          );
          expect(request.instructions).toContain(
            "Add Chinese-language searches only as a supplement",
          );
          expect(request.instructions).toContain(
            "Do not infer source language from the user's response language",
          );
          expect(request.instructions).toContain(
            "do not use a potentially stale year",
          );
          return {
            text: "I’ll verify that.",
            toolCalls: [
              {
                id: "search-1",
                name: "web_search",
                arguments: { query: "Threadlight" },
              },
            ],
            state: { turn: 1 },
          };
        }
        expect(request.instructions).toContain("[[source:s1]]");
        expect(request.instructions).toContain("[[source:s1,s2]]");
        return {
          text: "Threadlight is an agent runtime.[[source:s1]] It supports observable workflows.[[source:s1,s2]]",
          toolCalls: [],
          state: { turn: 2 },
        };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "researcher",
        instructions: "Research accurately",
        tools: [
          defineTool({
            name: "web_search",
            mutability: "read",
            description: "Search the web",
            parameters: { type: "object" },
            async execute() {
              return {
                query: "Threadlight",
                results: [
                  {
                    title: "Threadlight",
                    url: "https://example.com/threadlight",
                    description: "An agent runtime.",
                  },
                  {
                    title: "Observable workflows",
                    url: "https://docs.example.org/workflows",
                    description: "Workflow documentation.",
                  },
                ],
              };
            },
          }),
        ],
      }),
      conversationStore: store,
      send(message) {
        messages.push(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = (
      messages.find((message) => "id" in message && message.id === 2)
        ?.result as { threadId: string }
    ).threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "What is Threadlight?" },
    });
    await completed.promise;

    const completion = messages.find(
      (message) => "method" in message && message.method === "turn/completed",
    );
    expect(
      completion && "method" in completion ? completion.params : undefined,
    ).toMatchObject({
      output: expect.stringContaining("threadlight-source:citation-1"),
      sources: [
        { id: "s1", domain: "example.com" },
        { id: "s2", domain: "docs.example.org" },
      ],
      citations: [
        { id: "citation-1", sourceIds: ["s1"] },
        { id: "citation-2", sourceIds: ["s1", "s2"] },
      ],
    });
    expect((await store.load(threadId))?.messages.at(-1)).toMatchObject({
      sources: [{ id: "s1" }, { id: "s2" }],
      citations: [{ id: "citation-1" }, { id: "citation-2" }],
    });
    expect(requests.at(-1)?.state).toEqual({ turn: 1 });
    await server.dispose();
  });
});
