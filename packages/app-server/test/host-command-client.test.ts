import { join } from "node:path";
import { realpathSync } from "node:fs";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type Agent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { ProjectStore, SettingsStore } from "@threadlight/host-core";
import { runRemoteTask } from "@threadlight/client";
import type { JsonRpcOutgoing, JsonRpcRequest } from "@threadlight/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { AppServer } from "../src/app-server.js";
import { ThreadlightHostServer } from "../src/host-server.js";
import type { RuntimePeer } from "../src/remote-runtime-peer.js";
import {
  cleanupHostFixtures,
  createWorkspace,
  temporaryDirectory,
  trackHostServer,
} from "./host-server-fixtures.js";

afterEach(cleanupHostFixtures);

describe("Threadlight Host command client", () => {
  it("runs a project task through the real app-server with an offline scripted model provider", async () => {
    const root = temporaryDirectory("threadlight-command-client-");
    const projectPath = createWorkspace(root, "project", "baseline");
    const homePath = join(root, "home");
    const projects = new ProjectStore(join(homePath, "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(projectPath);
    const settings = testSettings(homePath);
    let modelStep = 0;
    let writes = 0;
    const provider: ModelProvider = {
      async generate(request) {
        modelStep += 1;
        if (modelStep === 1) {
          expect(request.input).toContain("Update the scripted file");
        }
        return modelStep === 1
          ? {
              text: "I will update it.",
              toolCalls: [
                {
                  id: "write-1",
                  name: "write_file",
                  arguments: { path: "src/index.ts" },
                },
              ],
            }
          : { text: "Updated through the command client.", toolCalls: [] };
      },
    };
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-command",
      name: "Command host",
      homePath,
      projects,
      settings,
      port: 0,
      createPeer: () =>
        new AppServerRuntimePeer(
          provider,
          defineAgent({
            name: "scripted",
            instructions: "Complete the task",
            tools: [
              defineTool({
                name: "write_file",
                mutability: "write",
                description: "Write a project file",
                parameters: { type: "object" },
                async execute() {
                  writes += 1;
                  return { ok: true };
                },
              }),
            ],
          }),
        ),
    });
    trackHostServer(server);
    const address = await server.start();
    const approvals: string[] = [];

    const result = await runRemoteTask({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: "test-token",
      project: "project",
      prompt: "Update the scripted file",
      async approve({ request }) {
        approvals.push(request.permissionKey);
        return "allow";
      },
    });

    expect(result).toMatchObject({
      hostId: "host-command",
      projectId: "project-1",
      projectName: "project",
      created: true,
      status: "completed",
      output: "Updated through the command client.",
    });
    expect(approvals).toEqual(["tool:write_file"]);
    expect(writes).toBe(1);
    expect(
      projects
        .project("project-1")
        ?.conversations.find(({ id }) => id === result.threadId),
    ).toMatchObject({
      title: "Update the scripted file",
      status: "completed",
      workspace: { mode: "folder", path: realpathSync(projectPath) },
    });

    const continued = await runRemoteTask({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: "test-token",
      threadId: result.threadId,
      prompt: "Continue the same task",
    });
    expect(continued).toMatchObject({
      projectId: "project-1",
      threadId: result.threadId,
      created: false,
      status: "completed",
      output: "Updated through the command client.",
    });
  });

  it("creates Host-managed standalone storage and runs without a project", async () => {
    const root = temporaryDirectory("threadlight-command-standalone-");
    const homePath = join(root, "home");
    const projects = new ProjectStore(join(homePath, "project-map.json"), {
      standaloneRoot: join(homePath, "standalone"),
    });
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-standalone",
      name: "Standalone host",
      homePath,
      projects,
      settings: testSettings(homePath),
      port: 0,
      createPeer: () =>
        new AppServerRuntimePeer(
          {
            generate: async () => ({
              text: "Standalone result.",
              toolCalls: [],
            }),
          },
          defineAgent({ name: "scripted", instructions: "Respond" }),
        ),
    });
    trackHostServer(server);
    const address = await server.start();

    const result = await runRemoteTask({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: "test-token",
      standalone: true,
      prompt: "Research without a project",
      fullAccess: true,
    });

    expect(result).toMatchObject({
      projectId: "standalone",
      projectName: "Standalone",
      status: "completed",
      output: "Standalone result.",
    });
    expect(projects.project("standalone")?.scope).toBe("standalone");
    expect(
      projects
        .project("standalone")
        ?.conversations.find(({ id }) => id === result.threadId),
    ).toMatchObject({
      accessMode: "full",
      workspace: { mode: "standalone" },
    });
  });
});

class AppServerRuntimePeer implements RuntimePeer {
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();
  private readonly server: AppServer;

  constructor(provider: ModelProvider, agent: Agent) {
    this.server = new AppServer({
      loop: new AgentLoop(provider),
      agent,
      send: (message) => {
        for (const listener of this.listeners) listener(message);
      },
    });
  }

  async start(): Promise<void> {}

  send(message: JsonRpcRequest): void {
    void this.server.receive(message);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    await this.server.dispose();
  }
}

function testSettings(homePath: string): SettingsStore {
  return new SettingsStore(join(homePath, "settings.json"), {
    encrypt: (value) => value,
    decrypt: (value) => value,
  });
}
