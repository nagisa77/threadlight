import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AgentTreePanel,
  groupAdjacentAgentActivities,
} from "../src/features/task-session/conversation-content.js";
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
    const html = renderToStaticMarkup(
      <AgentTreePanel tree={tree} live onOpenInPanel={vi.fn()} />,
    );

    expect(html).toContain('<details class="agent-tree live" open="">');
    expect(html).toContain("1 个运行中");
    expect(html).toContain("explorer");
    expect(html).toContain("Trace the protocol");
    expect(html).not.toContain("Implement multi-agent support");
    expect(html).toContain('aria-label="在右侧面板查看"');
    expect(html.indexOf('class="agent-tree-open-panel')).toBeLessThan(
      html.indexOf('class="agent-tree-count"'),
    );
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

  it("keeps a recovered interruption visible as a distinct terminal state", () => {
    const interrupted = {
      ...tree,
      agents: tree.agents.map((agent) => ({
        ...agent,
        status: "interrupted" as const,
        phase: "done" as const,
      })),
    };
    const html = renderToStaticMarkup(<AgentTreePanel tree={interrupted} />);

    expect(html).toContain('<details class="agent-tree" open="">');
    expect(html).toContain('class="agent-status interrupted"');
    expect(html).toContain("已中断");
  });

  it("hides the panel when the tree only contains the main agent", () => {
    const rootOnly = {
      ...tree,
      agents: [
        {
          ...tree.agents[0]!,
          status: "interrupted" as const,
          phase: "done" as const,
          latestActivity: "exec_command",
        },
      ],
    };
    const html = renderToStaticMarkup(<AgentTreePanel tree={rootOnly} live />);

    expect(html).toBe("");
  });

  it("renders a closed thread as final without offering retry", () => {
    const closed = {
      ...tree,
      agents: tree.agents.map((agent) => ({
        ...agent,
        status: "interrupted" as const,
        phase: "done" as const,
        closedAt: "2026-08-08T08:05:00.000Z",
      })),
    };
    const html = renderToStaticMarkup(<AgentTreePanel tree={closed} live />);

    expect(html).toContain('class="agent-status closed"');
    expect(html).toContain("已关闭");
    expect(html).not.toContain(">重试<");
  });

  it("groups only adjacent repeated agent activities", () => {
    expect(
      groupAdjacentAgentActivities([
        { id: "search-1", name: "web_search", status: "completed" },
        { id: "search-2", name: "web_search", status: "completed" },
        { id: "read-1", name: "read_file", status: "completed" },
        { id: "search-3", name: "web_search", status: "running" },
      ]),
    ).toEqual([
      {
        id: "search-1",
        name: "web_search",
        status: "completed",
        count: 2,
      },
      { id: "read-1", name: "read_file", status: "completed", count: 1 },
      { id: "search-3", name: "web_search", status: "running", count: 1 },
    ]);
  });

  it("renders a conversation-like side panel with model, tool, and output details", () => {
    const detailed = {
      ...tree,
      agents: tree.agents.map((agent) =>
        agent.id !== "explorer"
          ? agent
          : {
              ...agent,
              task: "Trace the protocol, persistence model, runtime recovery, provider boundaries, and every failure path before reporting the result.",
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
    const html = renderToStaticMarkup(
      <AgentPanel
        tree={detailed}
        live
        controls={{
          threadId: "thread",
          client: {
            cancelAgent: vi.fn(),
            retryAgent: vi.fn(),
            steerAgent: vi.fn(),
          },
        }}
      />,
    );

    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("主 Agent");
    expect(html).toContain("I’ll inspect the protocol.");
    expect(html).toContain("workspace_inspect");
    expect(html).toContain("packages/protocol");
    expect(html).toContain("Found the active-turn snapshot.");
    expect(html).toContain("不包含 Provider 的隐藏推理");
    expect(html).toContain('aria-label="收起 Agent 列表"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="agent-conversation-task"');
    expect(html).toContain('aria-label="展开任务详情"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="agent-action danger pressable"');
    expect(html).toContain('aria-label="停止"');
    expect(html).toContain("<span>停止</span>");
    expect(html.indexOf('class="agent-conversation"')).toBeLessThan(
      html.indexOf('class="agent-panel-list"'),
    );
  });
});
