import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AgentTreePanel } from "../src/features/task-session/conversation-content.js";
import { AgentPanel } from "../src/features/task-session/agent-panel.js";
import { resolveAgentPanelTree } from "../src/features/delivery/controller.js";
import {
  agentTaskRepresentedByMessage,
  agentThreadTree,
  groupAgentThreads,
} from "../src/features/task-session/agent-threads.js";

describe("AgentTreePanel", () => {
  const openAgent = vi.fn();
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

  it("keeps the root implicit and renders child agents as panel navigation", () => {
    const html = renderToStaticMarkup(
      <AgentTreePanel tree={tree} onOpenInPanel={openAgent} />,
    );

    expect(html).toContain('<section class="agent-tree" aria-label="Agents">');
    expect(html).toContain("1 个运行中");
    expect(html).toContain("explorer");
    expect(html).toContain("Trace the protocol");
    expect(html).not.toContain("Implement multi-agent support");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("agent-inspector");
  });

  it("keeps completed historical agents visible", () => {
    const completed = {
      ...tree,
      agents: tree.agents.map((agent) => ({
        ...agent,
        status: "completed" as const,
        phase: "done" as const,
      })),
    };
    const html = renderToStaticMarkup(
      <AgentTreePanel tree={completed} onOpenInPanel={openAgent} />,
    );

    expect(html).toContain('<section class="agent-tree"');
    expect(html).toContain("explorer");
    expect(html).toContain("1 个已完成");
  });

  it("resolves the agent tree that owns a clicked historical row", () => {
    const historical = {
      ...tree,
      rootId: "historical-root",
      agents: tree.agents.map((agent) =>
        agent.id === tree.rootId
          ? { ...agent, id: "historical-root" }
          : { ...agent, parentId: "historical-root" },
      ),
    };

    expect(
      resolveAgentPanelTree(
        {
          agentTree: tree,
          messages: [{ agentTree: historical }],
        },
        historical.rootId,
      ),
    ).toBe(historical);
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
    const html = renderToStaticMarkup(
      <AgentTreePanel tree={interrupted} onOpenInPanel={openAgent} />,
    );

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
    const html = renderToStaticMarkup(
      <AgentTreePanel tree={rootOnly} onOpenInPanel={openAgent} />,
    );

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
    const html = renderToStaticMarkup(
      <AgentTreePanel tree={closed} onOpenInPanel={openAgent} />,
    );

    expect(html).toContain('class="agent-status closed"');
    expect(html).toContain("已关闭");
    expect(html).not.toContain(">重试<");
  });

  it("keeps follow-up turns inside one stable logical agent", () => {
    const followedUp = {
      ...tree,
      agents: [
        {
          ...tree.agents[0]!,
          status: "completed" as const,
          phase: "done" as const,
        },
        {
          ...tree.agents[1]!,
          agentThreadId: "explorer",
          status: "completed" as const,
          phase: "done" as const,
          output: "Initial protocol findings",
        },
        {
          ...tree.agents[1]!,
          id: "explorer-follow-up",
          agentThreadId: "explorer",
          followUpOf: "explorer",
          task: "Verify the recovery path",
          status: "completed" as const,
          phase: "done" as const,
          createdAt: "2026-08-08T08:01:00.000Z",
          messages: [
            {
              id: "follow-up-message",
              fromAgentId: "root",
              fromAgentThreadId: "root",
              fromAgentName: "threadlight",
              toAgentThreadId: "explorer",
              text: "Verify the recovery path",
              createdAt: "2026-08-08T08:01:00.000Z",
              delivery: "follow_up" as const,
            },
          ],
          output: "Recovery path verified",
        },
      ],
    };
    const childThreads = groupAgentThreads(
      followedUp.agents.filter(({ parentId }) => parentId === tree.rootId),
    );

    expect(childThreads).toHaveLength(1);
    expect(childThreads[0]).toMatchObject({
      id: "explorer",
      latest: { id: "explorer-follow-up" },
    });
    expect(childThreads[0]?.turns).toHaveLength(2);

    const treeHtml = renderToStaticMarkup(
      <AgentTreePanel tree={followedUp} onOpenInPanel={openAgent} />,
    );
    expect(treeHtml).toContain("1 个已完成");
    expect(treeHtml).toContain("2 轮");
    expect(treeHtml.match(/class="agent-row pressable/g)).toHaveLength(1);

    const panelHtml = renderToStaticMarkup(<AgentPanel tree={followedUp} />);
    expect(panelHtml.match(/class="agent-panel-agent pressable/g)).toHaveLength(
      2,
    );
    expect(panelHtml).toContain("第 1 轮");
    expect(panelHtml).toContain("第 2 轮");
    expect(panelHtml).toContain("Initial protocol findings");
    expect(panelHtml).toContain("Verify the recovery path");
    expect(panelHtml).not.toContain(
      'class="agent-turn-task">Verify the recovery path',
    );
    expect(panelHtml).toContain("Recovery path verified");
    expect(agentTaskRepresentedByMessage(followedUp.agents[2]!)).toBe(true);
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
    expect(html).not.toContain('class="agent-turn"');
    expect(html).not.toContain("第 1 轮");
    expect(html.indexOf('class="agent-conversation"')).toBeLessThan(
      html.indexOf('class="agent-panel-list"'),
    );
  });

  it("renders nested logical agents in hierarchy order and exposes peer messages", () => {
    const nested = {
      ...tree,
      agents: [
        tree.agents[0]!,
        {
          ...tree.agents[1]!,
          id: "coordinator",
          agentThreadId: "coordinator-thread",
          agentPath: "/root/coordinator",
          name: "coordinator",
          task: "Coordinate nested research",
          messages: [
            {
              id: "peer-message",
              fromAgentId: "evidence-turn",
              fromAgentThreadId: "evidence-thread",
              fromAgentName: "evidence",
              toAgentThreadId: "coordinator-thread",
              text: "The nested evidence is ready.",
              createdAt: "2026-08-08T08:00:03.000Z",
              delivery: "active" as const,
            },
          ],
        },
        {
          ...tree.agents[1]!,
          id: "evidence-turn",
          parentId: "coordinator-thread",
          agentThreadId: "evidence-thread",
          agentPath: "/root/coordinator/evidence",
          name: "evidence",
          task: "Collect evidence",
          status: "completed" as const,
          phase: "done" as const,
        },
      ],
    };

    const hierarchy = agentThreadTree(nested.agents, nested.rootId, {
      includeRoot: false,
    });
    expect(hierarchy.map(({ id, depth }) => ({ id, depth }))).toEqual([
      { id: "coordinator-thread", depth: 0 },
      { id: "evidence-thread", depth: 1 },
    ]);

    const treeHtml = renderToStaticMarkup(
      <AgentTreePanel tree={nested} onOpenInPanel={openAgent} />,
    );
    expect(treeHtml).toContain('data-depth="0"');
    expect(treeHtml).toContain('data-depth="1"');
    expect(treeHtml.indexOf("coordinator")).toBeLessThan(
      treeHtml.indexOf("evidence"),
    );

    const selectedPanelHtml = renderToStaticMarkup(
      <AgentPanel tree={nested} live initialAgentId="evidence-thread" />,
    );
    expect(selectedPanelHtml).toMatch(
      /class="agent-panel-agent pressable selected"[^>]*aria-current="true"[^>]*>[\s\S]*?<strong>evidence<\/strong>/,
    );
    const panelHtml = renderToStaticMarkup(<AgentPanel tree={nested} live />);
    expect(panelHtml).toContain("The nested evidence is ready.");
    expect(panelHtml).toContain(
      'class="agent-transcript-message agent-transcript-agent-message"',
    );
  });
});
