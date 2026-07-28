import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";
import { createProjectMemoryTool } from "@threadlight/builtin-tools";
import { ProjectMemoryStore } from "@threadlight/project-memory";
import { describe, expect, it } from "vitest";

import { AppServer } from "../src/app-server.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";
import {
  createWorkspaceAgentFactory,
  LOCAL_RESOURCE_LINK_INSTRUCTIONS,
} from "../src/workspace-agent.js";
import { loadWorkspaceContext } from "../src/workspace-context.js";

class RecordingProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  async generate(request: ModelRequest) {
    this.requests.push(request);
    return { text: "ok", toolCalls: [] };
  }
}

describe("workspace context", () => {
  it("takes a fresh workspace snapshot for each new thread", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-workspace-"));

    try {
      await writeFile(join(workspaceRoot, "AGENTS.md"), "Use the first policy.");
      await writeFile(join(workspaceRoot, "README.md"), "Example project overview.");
      const memory = new ProjectMemoryStore(workspaceRoot);
      const initialMemory = await memory.ensure();
      await memory.write(
        "# Project memory\n\n## Decisions\n\n- Use the first database.",
        initialMemory.revision,
      );

      const provider = new RecordingProvider();
      const messages: JsonRpcOutgoing[] = [];
      let completeTurn: (() => void) | undefined;
      const server = new AppServer({
        loop: new AgentLoop(provider),
        agentFactory: createWorkspaceAgentFactory({
          workspaceRoot,
          baseInstructions: "Base instructions.",
        }),
        send(message) {
          messages.push(message);
          if ("method" in message && message.method === "turn/completed") {
            completeTurn?.();
            completeTurn = undefined;
          }
        },
      });

      await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
      await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
      const firstThreadId = responseThreadId(messages, 2);

      await writeFile(join(workspaceRoot, "AGENTS.md"), "Use the second policy.");
      const firstMemory = await memory.read();
      await memory.write(
        "# Project memory\n\n## Decisions\n\n- Use the second database.",
        firstMemory.revision,
      );
      await startTurnAndWait(server, firstThreadId, 3, () => {
        return new Promise<void>((resolve) => {
          completeTurn = resolve;
        });
      });

      expect(provider.requests[0]?.instructions).toContain("Base instructions.");
      expect(provider.requests[0]?.instructions).toContain(
        LOCAL_RESOURCE_LINK_INSTRUCTIONS,
      );
      expect(provider.requests[0]?.instructions).toContain(
        "Use the first policy.",
      );
      expect(provider.requests[0]?.instructions).toContain(
        "Example project overview.",
      );
      expect(provider.requests[0]?.instructions).toContain(
        "Use the first database.",
      );
      expect(provider.requests[0]?.instructions).not.toContain(
        "Use the second database.",
      );
      expect(provider.requests[0]?.instructions).not.toContain(
        "Use the second policy.",
      );

      await server.receive({ jsonrpc: "2.0", id: 4, method: "thread/start" });
      const secondThreadId = responseThreadId(messages, 4);
      await startTurnAndWait(server, secondThreadId, 5, () => {
        return new Promise<void>((resolve) => {
          completeTurn = resolve;
        });
      });

      expect(provider.requests[1]?.instructions).toContain(
        "Use the second policy.",
      );
      expect(provider.requests[1]?.instructions).not.toContain(
        "Use the first policy.",
      );
      expect(provider.requests[1]?.instructions).toContain(
        "Use the second database.",
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("limits captured text and rejects documents outside the workspace", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "threadlight-context-"));
    const workspaceRoot = join(temporaryRoot, "workspace");
    const outsideInstructions = join(temporaryRoot, "outside-agents.md");

    try {
      await mkdir(workspaceRoot);
      await writeFile(outsideInstructions, "Do not load this.");
      await symlink(outsideInstructions, join(workspaceRoot, "AGENTS.md"));
      await writeFile(join(workspaceRoot, "README.md"), "1234567890");

      const context = await loadWorkspaceContext(workspaceRoot, {
        maxFileChars: 4,
        maxTotalChars: 4,
      });

      expect(context.documents).toEqual([
        {
          path: "README.md",
          kind: "reference",
          content: "1234",
          truncated: true,
        },
      ]);
      expect(context.warnings).toContain(
        "AGENTS.md resolves outside the workspace",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("persists a scripted model memory update for the next task", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-memory-loop-"));

    try {
      const memory = new ProjectMemoryStore(workspaceRoot);
      await memory.ensure();
      const provider = new ScriptedMemoryProvider();
      const messages: JsonRpcOutgoing[] = [];
      let completeTurn: (() => void) | undefined;
      const server = new AppServer({
        loop: new AgentLoop(provider),
        agentFactory: createWorkspaceAgentFactory({
          workspaceRoot,
          baseInstructions: "Maintain durable project memory.",
          tools: [createProjectMemoryTool({ store: memory })],
        }),
        send(message) {
          messages.push(message);
          if ("method" in message && message.method === "turn/completed") {
            completeTurn?.();
            completeTurn = undefined;
          }
        },
      });

      await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
      await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
      await startTurnAndWait(server, responseThreadId(messages, 2), 3, () =>
        new Promise<void>((resolve) => {
          completeTurn = resolve;
        }),
      );

      expect((await memory.read()).content).toContain(
        "- The API uses cursor pagination.",
      );

      await server.receive({ jsonrpc: "2.0", id: 4, method: "thread/start" });
      await startTurnAndWait(server, responseThreadId(messages, 4), 5, () =>
        new Promise<void>((resolve) => {
          completeTurn = resolve;
        }),
      );

      expect(provider.requests[3]?.instructions).toContain(
        "- The API uses cursor pagination.",
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

class ScriptedMemoryProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  async generate(request: ModelRequest) {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return {
        text: "",
        toolCalls: [
          {
            id: "memory-read",
            name: "project_memory",
            arguments: {
              action: "read",
              content: null,
              read_token: null,
            },
          },
        ],
      };
    }
    if (this.requests.length === 2) {
      const current = JSON.parse(request.toolResults?.[0]?.output ?? "{}") as {
        content: string;
        read_token: string;
      };
      return {
        text: "",
        toolCalls: [
          {
            id: "memory-write",
            name: "project_memory",
            arguments: {
              action: "write",
              content: `${current.content.trimEnd()}\n\n- The API uses cursor pagination.\n`,
              read_token: current.read_token,
            },
          },
        ],
      };
    }
    return {
      text: this.requests.length === 3 ? "Remembered." : "Recalled.",
      toolCalls: [],
    };
  }
}

async function startTurnAndWait(
  server: AppServer,
  threadId: string,
  id: number,
  createCompletion: () => Promise<void>,
): Promise<void> {
  const completed = createCompletion();
  await server.receive({
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: { threadId, input: "Hello" },
  });
  await completed;
}

function responseThreadId(messages: readonly JsonRpcOutgoing[], id: number): string {
  const response = messages.find(
    (message) => "id" in message && message.id === id,
  );
  return (response?.result as { threadId: string }).threadId;
}
