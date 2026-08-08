import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentTreePanel } from "../src/features/task-session/conversation-content.js";
import { AgentPanel } from "../src/features/task-session/agent-panel.js";

describe("AgentTreePanel", () => {
  const tree = {
    rootId: "root",
    maxConcurrent: 3,
    agents: [
      {
        id: "root",
        name: "threadlight",
        role: "root",
        task: "Implement multi-agent support",
        status: "running" as const,
        phase: "thinking" as const,
        createdAt: "2026-08-08T08:00:00.000Z",
        startedAt: "2026-08-08T08:00:00.000Z",
        elapsedMs: 1_000,
        activities: [],
      },
      {
        id: "explorer",
        parentId: "root",
        name: "explorer",
        role: "explorer",
        task: "Trace the protocol",
        status: "running" as const,
        phase: "working" as const,
        createdAt: "2026-08-08T08:00:01.000Z",
        startedAt: "2026-08-08T08:00:01.000Z",
        elapsedMs: 2_000,
        latestActivity: "workspace_inspect",
        activities: [
          {
            id: "inspect",
            name: "workspace_inspect",
            status: "running" as const,
          },
        ],
      },
    ],
  };

  it("keeps the root implicit and starts a live child-agent tree expanded", () => {
    const html = renderToStaticMarkup(<AgentTreePanel tree={tree} live />);

    expect(html).toContain('<details class="agent-tree live" open="">');
    expect(html).toContain("1 个运行中");
    expect(html).toContain("explorer");
    expect(html).toContain("Trace the protocol");
    expect(html).not.toContain("Implement multi-agent support");
  });

  it("starts a completed historical tree collapsed", () => {
    const completed = {
      ...tree,
      agents: tree.agents.map((agent) => ({
        ...agent,
        status: "completed" as const,
        phase: "done" as const,
      })),
    };
    const html = renderToStaticMarkup(<AgentTreePanel tree={completed} />);

    expect(html).toContain('<details class="agent-tree">');
    expect(html).not.toContain('<details class="agent-tree" open="">');
    expect(html).toContain("1 个已完成");
  });

  it("renders a conversation-like side panel with model, tool, and output details", () => {
    const detailed = {
      ...tree,
      agents: tree.agents.map((agent) =>
        agent.id !== "explorer"
          ? agent
          : {
              ...agent,
              transcript: [
                {
                  id: "model:1",
                  kind: "model" as const,
                  step: 1,
                  status: "completed" as const,
                  text: "I’ll inspect the protocol.",
                  startedAt: "2026-08-08T08:00:01.000Z",
                },
                {
                  id: "inspect",
                  kind: "tool" as const,
                  name: "workspace_inspect",
                  status: "completed" as const,
                  arguments: '{"path":"packages/protocol"}',
                  output: "Found the active-turn snapshot.",
                  startedAt: "2026-08-08T08:00:02.000Z",
                },
              ],
            },
      ),
    };
    const html = renderToStaticMarkup(<AgentPanel tree={detailed} live />);

    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("主 Agent");
    expect(html).toContain("I’ll inspect the protocol.");
    expect(html).toContain("workspace_inspect");
    expect(html).toContain("packages/protocol");
    expect(html).toContain("Found the active-turn snapshot.");
    expect(html).toContain("不包含 Provider 的隐藏推理");
  });
});
