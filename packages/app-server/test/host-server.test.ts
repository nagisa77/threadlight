import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CodeHostDeliveryManager,
  ConversationChangeTracker,
  ProjectStore,
  SettingsStore,
  type CodeHostPullRequest,
  type CodeHostProvider,
} from "@threadlight/host-core";
import {
  browserTerminalProtocols,
  HttpHostClient,
} from "@threadlight/client";
import { createRemoteWebSession } from "@threadlight/web-runtime";
import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import type {
  TerminalSessionController,
} from "@threadlight/terminal-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";

import { ThreadlightHostServer } from "../src/host-server.js";
import type { RuntimePeer } from "../src/remote-runtime-peer.js";

const directories: string[] = [];
const servers: ThreadlightHostServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ThreadlightHostServer", () => {
  it("streams runtime notifications as SSE with periodic heartbeats", async () => {
    const root = temporaryDirectory("threadlight-host-sse-");
    const workspace = createWorkspace(root, "project", "sse");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => value,
        decrypt: (value) => value,
      },
    );
    const peer = new ScriptedRuntimePeer((request, emit) => {
      emit({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { name: "threadlight", protocolVersion: "0.1" },
      });
    });
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "SSE host",
      homePath: join(root, "home"),
      projects,
      settings,
      port: 0,
      eventHeartbeatIntervalMs: 10,
      createPeer: () => peer,
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const response = await fetch(
      `${endpoint}/v1/projects/project-1/runtime/events`,
      { headers: { Authorization: "Bearer test-token" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-cache, no-transform",
    );
    const events = new TestSseReader(response.body!);
    await expect(events.nextFrame()).resolves.toBe(": ping");
    await expect(events.nextFrame()).resolves.toBe(": ping");

    await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/rpc`,
      {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        },
      },
    );
    const notification = {
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: "thread-1", output: "done" },
    } satisfies JsonRpcOutgoing;
    peer.emit(notification);
    await expect(events.nextData()).resolves.toBe(
      JSON.stringify(notification),
    );
    await events.cancel();
  });

  it("serves multiple projects and host-owned settings with scripted peers", async () => {
    const root = temporaryDirectory("threadlight-host-");
    const firstWorkspace = createWorkspace(root, "first", "first");
    const secondWorkspace = createWorkspace(root, "second", "second");
    const systemFiles = join(root, "system-files");
    mkdirSync(join(systemFiles, "nested"), { recursive: true });
    writeFileSync(join(systemFiles, "notes.txt"), "remote notes\n");
    const ids = ["project-1", "project-2"];
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => ids.shift() ?? "unexpected",
    });
    projects.register(firstWorkspace);
    projects.register(secondWorkspace);
    projects.upsertConversation({
      projectId: "project-1",
      id: "usage-thread",
      title: "Remote usage",
    });
    const taskSearchWorkspace = join(root, "task-search-workspace");
    mkdirSync(taskSearchWorkspace, { recursive: true });
    writeFileSync(
      join(taskSearchWorkspace, "task-search-only.ts"),
      "export const remoteTaskSearch = true;\n",
    );
    projects.setConversationWorkspace(
      { projectId: "project-1", id: "usage-thread" },
      { mode: "folder", path: taskSearchWorkspace },
    );
    writeFileSync(
      join(
        firstWorkspace,
        ".threadlight",
        "conversations",
        "usage-thread.json",
      ),
      JSON.stringify({
        messages: [
          {
            id: "assistant-usage",
            role: "assistant",
            text: "private response content",
            diagnostics: {
              status: "completed",
              startedAt: "2026-07-30T01:00:00.000Z",
              completedAt: "2026-07-30T01:00:01.250Z",
              durationMs: 1_250,
              model: "scripted-model",
              usage: {
                inputTokens: 8,
                outputTokens: 5,
                totalTokens: 13,
              },
              modelSteps: [
                {
                  step: 1,
                  durationMs: 900,
                  usage: {
                    inputTokens: 8,
                    outputTokens: 5,
                    totalTokens: 13,
                  },
                },
              ],
              toolCalls: [
                {
                  callId: "tool-usage",
                  name: "inspect",
                  durationMs: 200,
                  isError: false,
                },
              ],
            },
          },
        ],
      }),
    );
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => `sealed:${value}`,
        decrypt: (value) => value.replace(/^sealed:/, ""),
      },
    );
    const peers = new Map<string, ScriptedRuntimePeer>();
    const oauthCallbackPrefixes = new Map<string, string | undefined>();
    const providerTests: Array<{
      request: { provider: string; model: string; apiKey?: string | null };
      storedApiKey?: string;
    }> = [];
    const transcriptions: Array<{
      audio: number[];
      mimeType: string;
      apiKey: string;
    }> = [];
    const oauthCallbacks: Array<{
      connectorId: string;
      code?: string;
      error?: string;
      state: string;
    }> = [];
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
      projects,
      settings,
      testProvider: async (request, runtimeSettings) => {
        providerTests.push({
          request,
          storedApiKey: runtimeSettings.openAIApiKey,
        });
        return {
          status: "success",
          code: "ok",
          provider: request.provider,
          model: request.model,
          endpoint: "https://api.openai.example/v1/models",
          checkedAt: "2026-07-30T00:00:00.000Z",
          latencyMs: 12,
          httpStatus: 200,
        };
      },
      transcribeAudio: async (request, options) => {
        transcriptions.push({
          audio: [...new Uint8Array(request.audio)],
          mimeType: request.mimeType,
          apiKey: options.apiKey,
        });
        return "远程语音转写结果";
      },
      acceptOAuthCallback: (input) => {
        oauthCallbacks.push(input);
        return input.state === "expected-state";
      },
      port: 0,
      allowedOrigins: [
        "https://threadlight.example",
        "http://192.168.50.186:5173",
      ],
      createPeer: ({ projectId, projectRoot, oauthCallbackUrlPrefix }) => {
        oauthCallbackPrefixes.set(projectId, oauthCallbackUrlPrefix);
        const peer = new ScriptedRuntimePeer((request, emit) => {
          emit({
            jsonrpc: "2.0",
            id: request.id ?? null,
            result: { threadId: `${projectId}-thread` },
          });
        });
        peers.set(`${projectId}:${projectRoot}`, peer);
        return peer;
      },
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const hostClient = new HttpHostClient({
      endpoint,
      token: "test-token",
    });
    await expect(hostClient.diagnostics("project-1")).resolves.toMatchObject({
      projectId: "project-1",
      projectName: "first",
      totals: {
        turns: 1,
        inputTokens: 8,
        outputTokens: 5,
        totalTokens: 13,
        modelSteps: 1,
        toolCalls: 1,
      },
      turns: [
        {
          threadId: "usage-thread",
          title: "Remote usage",
          model: "scripted-model",
        },
      ],
    });
    expect(
      JSON.stringify(await hostClient.diagnostics("project-1")),
    ).not.toContain("private response content");
    await expect(
      hostClient.search({
        projectId: "project-1",
        query: "private response",
        mode: "all",
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        kind: "message",
        threadId: "usage-thread",
        messageId: "assistant-usage",
        title: "Remote usage",
      }),
    );
    await expect(
      hostClient.search({
        projectId: "project-1",
        threadId: "usage-thread",
        query: "task-search-only",
        mode: "files",
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        kind: "file",
        path: "task-search-only.ts",
      }),
    );
    const callbackResponse = await fetch(
      `${endpoint}/v1/host/oauth/callback/gmail?code=fixture-code&state=expected-state`,
    );
    expect(callbackResponse.status).toBe(200);
    expect(oauthCallbacks).toEqual([
      {
        connectorId: "gmail",
        code: "fixture-code",
        state: "expected-state",
      },
    ]);

    await expect(
      hostClient.transcribeAudio({
        audio: Uint8Array.from([10, 11, 12]).buffer,
        mimeType: "audio/webm;codecs=opus",
      }),
    ).rejects.toThrow("配置 OpenAI API Key");

    const uploadedAttachment = await hostClient.uploadAttachment({
      projectId: "project-1",
      name: "../diagram.png",
      mimeType: "image/png",
      size: 5,
      content: Uint8Array.from([1, 2, 3, 4, 5]).buffer,
    });
    expect(uploadedAttachment).toMatchObject({
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image",
    });
    expect(dirname(uploadedAttachment.path)).toBe(
      join(realpathSync(firstWorkspace), ".threadlight", "uploads"),
    );
    expect([...readFileSync(uploadedAttachment.path)]).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect([
      ...new Uint8Array(
        await hostClient.downloadAttachment(
          "project-1",
          uploadedAttachment.id,
        ),
      ),
    ]).toEqual([1, 2, 3, 4, 5]);

    expect((await fetch(`${endpoint}/v1/health`)).status).toBe(401);
    const preflight = await fetch(`${endpoint}/v1/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://threadlight.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://threadlight.example",
    );
    const lanPreflight = await fetch(`${endpoint}/v1/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://192.168.50.186:5173",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(lanPreflight.status).toBe(204);
    expect(lanPreflight.headers.get("access-control-allow-origin")).toBe(
      "http://192.168.50.186:5173",
    );
    expect(await authenticatedJson(`${endpoint}/v1/health`)).toEqual({
      ok: true,
      protocolVersion: 2,
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
    });

    const snapshot = (await authenticatedJson(
      `${endpoint}/v1/host/projects`,
    )) as { projects: Array<{ id: string; basePath: string }> };
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.projects.map(({ basePath }) => basePath)).toEqual([
      realpathSync(firstWorkspace),
      realpathSync(secondWorkspace),
    ]);
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/directories?path=${encodeURIComponent(join(root, "f"))}`,
      ),
    ).toEqual({
      path: root,
      directories: [
        {
          name: "first",
          path: firstWorkspace,
        },
      ],
    });
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/files?path=${encodeURIComponent(systemFiles)}`,
      ),
    ).toEqual({
      path: realpathSync(systemFiles),
      parentPath: realpathSync(root),
      entries: [
        {
          name: "nested",
          path: join(realpathSync(systemFiles), "nested"),
          kind: "directory",
        },
        {
          name: "notes.txt",
          path: join(realpathSync(systemFiles), "notes.txt"),
          kind: "file",
        },
      ],
    });
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/file?path=${encodeURIComponent(join(systemFiles, "notes.txt"))}`,
      ),
    ).toEqual({
      path: realpathSync(join(systemFiles, "notes.txt")),
      name: "notes.txt",
      content: "remote notes\n",
      binary: false,
      size: 13,
    });

    const firstFile = await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/workspace/file?path=src%2Findex.ts`,
    );
    const secondFile = await authenticatedJson(
      `${endpoint}/v1/projects/project-2/runtime/workspace/file?path=src%2Findex.ts`,
    );
    expect(firstFile).toMatchObject({ content: "export const value = 'first';\n" });
    expect(secondFile).toMatchObject({ content: "export const value = 'second';\n" });
    expect(oauthCallbackPrefixes.get("project-1")).toBe(
      `${endpoint}/v1/host/oauth/callback`,
    );

    const rpcResponse = await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/rpc`,
      {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 42,
          method: "thread/start",
        },
      },
    );
    expect(rpcResponse).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { threadId: "project-1-thread" },
    });
    expect(
      [...peers.values()].find((peer) =>
        peer.requests.some(({ method }) => method === "thread/start"),
      )?.requests[0]?.id,
    ).toMatch(/^host:/);
    expect(
      [...peers.keys()].some((key) => key.startsWith("project-2:")),
    ).toBe(true);

    const oauthLocation = vi.fn();
    const closeOAuthWindow = vi.fn();
    const webSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
      openOAuthWindow: () => ({
        closed: false,
        location: { replace: oauthLocation },
        close: closeOAuthWindow,
      }),
    });
    const webProjects = await webSession.projects.load();
    expect(webProjects.projects[0]).toMatchObject({
      id: "project-1",
      runtime: {
        kind: "remote",
        endpoint,
        workspacePath: realpathSync(firstWorkspace),
      },
    });
    const listRemoteDirectories =
      webSession.projects.listRemoteDirectories;
    await expect(
      listRemoteDirectories?.(join(root, "f")),
    ).resolves.toEqual({
      path: root,
      directories: [
        {
          name: "first",
          path: firstWorkspace,
        },
      ],
    });
    await webSession.projects.activate("project-1");
    const parallelWebSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
    });
    await parallelWebSession.projects.activate("project-2");
    expect((await webSession.projects.load()).activeProjectId).toBe(
      "project-1",
    );
    expect((await parallelWebSession.projects.load()).activeProjectId).toBe(
      "project-2",
    );
    expect((await hostClient.projects()).activeProjectId).toBe("project-2");
    await Promise.all([
      webSession.client.initialize(),
      parallelWebSession.client.initialize(),
    ]);
    await expect(webSession.client.startThread()).resolves.toEqual({
      threadId: "project-1-thread",
    });
    await expect(parallelWebSession.client.startThread()).resolves.toEqual({
      threadId: "project-2-thread",
    });
    await expect(
      webSession.diagnostics.load("project-1"),
    ).resolves.toMatchObject({
      totals: {
        turns: 1,
        totalTokens: 13,
      },
      turns: [
        {
          threadId: "usage-thread",
          toolCalls: [
            {
              name: "inspect",
              durationMs: 200,
            },
          ],
        },
      ],
    });
    await expect(
      webSession.search.search(
        "project-1",
        undefined,
        "private response",
        "all",
      ),
    ).resolves.toContainEqual(
      expect.objectContaining({
        kind: "message",
        threadId: "usage-thread",
      }),
    );
    const loadedPreview = await webSession.attachmentPreview.loadImageUrl?.(
      uploadedAttachment,
    );
    expect(loadedPreview).toMatch(/^blob:/);
    expect([
      ...new Uint8Array(await (await fetch(loadedPreview!)).arrayBuffer()),
    ]).toEqual([1, 2, 3, 4, 5]);

    const webAttachment = await webSession.attachmentStage.stage(
      new File(
        [Uint8Array.from([6, 7, 8, 9])],
        "web-diagram.png",
        { type: "image/png" },
      ),
    );
    expect(webAttachment).toMatchObject({
      name: "web-diagram.png",
      mimeType: "image/png",
      size: 4,
      kind: "image",
    });
    expect(dirname(webAttachment.path)).toBe(
      join(realpathSync(firstWorkspace), ".threadlight", "uploads"),
    );
    expect(
      webSession.attachmentPreview.imageUrl(webAttachment),
    ).toMatch(/^blob:/);
    await expect(
      webSession.workspace.list("project-1", "src"),
    ).resolves.toContainEqual({
      name: "index.ts",
      path: "src/index.ts",
      type: "file",
    });
    await webSession.client.initialize();
    expect(
      [...peers.values()]
        .flatMap(({ requests }) => requests)
        .find(({ method }) => method === "initialize"),
    ).toMatchObject({
      method: "initialize",
      params: {
        capabilities: { executionApprovals: true },
      },
    });
    await expect(
      webSession.connectorAuthorization.authorize(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        server.publishConnectorAuthorization(
          "project-1",
          "https://accounts.example/authorize?state=fixture",
        );
        await waitFor(() => oauthLocation.mock.calls.length === 1);
        return "authorized";
      }),
    ).resolves.toBe("authorized");
    expect(oauthLocation).toHaveBeenCalledWith(
      "https://accounts.example/authorize?state=fixture",
    );
    expect(closeOAuthWindow).toHaveBeenCalledOnce();
    expect(webSession.settings.testProvider).toBeTypeOf("function");
    await expect(
      webSession.settings.testProvider?.({
        provider: "custom",
        model: "web-draft-model",
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
    ).resolves.toMatchObject({
      status: "success",
      code: "ok",
      provider: "custom",
      model: "web-draft-model",
    });
    parallelWebSession.dispose();
    webSession.dispose();

    const currentSettings = (await authenticatedJson(
      `${endpoint}/v1/host/settings`,
    )) as Record<string, unknown>;
    const updatedSettings = await authenticatedJson(
      `${endpoint}/v1/host/settings`,
      {
        method: "PUT",
        body: {
          ...currentSettings,
          provider: "openai",
          model: "scripted-model",
          openAIApiKey: "remote-only-key",
        },
      },
    );
    expect(updatedSettings).toMatchObject({
      model: "scripted-model",
      openAIApiKeyConfigured: true,
    });
    expect(settings.runtimeSettings().openAIApiKey).toBe("remote-only-key");

    await expect(
      hostClient.transcribeAudio({
        audio: Uint8Array.from([10, 11, 12]).buffer,
        mimeType: "audio/webm;codecs=opus",
      }),
    ).resolves.toBe("远程语音转写结果");

    const voiceWebSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
    });
    await expect(voiceWebSession.voiceInput.prepare?.()).resolves.toBeUndefined();
    await expect(
      voiceWebSession.voiceInput.transcribe({
        audio: Uint8Array.from([20, 21]).buffer,
        mimeType: "audio/mp4",
      }),
    ).resolves.toBe("远程语音转写结果");
    voiceWebSession.dispose();

    await expect(
      hostClient.testProvider({
        provider: "openai",
        model: "draft-model",
        apiKey: "draft-only-key",
      }),
    ).resolves.toMatchObject({
      status: "success",
      code: "ok",
      provider: "openai",
      model: "draft-model",
    });
    expect(providerTests).toEqual([
      {
        request: {
          provider: "custom",
          model: "web-draft-model",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
        storedApiKey: undefined,
      },
      {
        request: {
          provider: "openai",
          model: "draft-model",
          apiKey: "draft-only-key",
        },
        storedApiKey: "remote-only-key",
      },
    ]);
    expect(transcriptions).toEqual([
      {
        audio: [10, 11, 12],
        mimeType: "audio/webm;codecs=opus",
        apiKey: "remote-only-key",
      },
      {
        audio: [20, 21],
        mimeType: "audio/mp4",
        apiKey: "remote-only-key",
      },
    ]);
  });

  it("stores and runs Host-owned automations for web clients with a scripted runtime", async () => {
    const root = temporaryDirectory("threadlight-host-automation-");
    const projectPath = createWorkspace(root, "project", "automation");
    const homePath = join(root, "home");
    const projects = new ProjectStore(join(homePath, "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(projectPath);
    const settings = new SettingsStore(join(homePath, "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
    const peer = new ScriptedRuntimePeer((request, emit) => {
      if (request.method === "initialize") {
        emit({
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: { name: "threadlight", protocolVersion: "0.1" },
        });
        return;
      }
      if (request.method === "thread/start") {
        emit({
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: { threadId: "automation-thread" },
        });
        return;
      }
      if (request.method === "turn/start") {
        emit({
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: { turnId: "automation-turn" },
        });
        queueMicrotask(() => {
          emit({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: {
              threadId: "automation-thread",
              turnId: "automation-turn",
              output:
                "All scripted checks passed.\n\nAUTOMATION_STATUS: ok",
              diagnostics: {
                toolCalls: [{ name: "exec_command", isError: false }],
              },
            },
          });
        });
      }
    });
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Automation host",
      homePath,
      projects,
      settings,
      port: 0,
      createPeer: () => peer,
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const webSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
    });

    await expect(
      webSession.automations.load("project-1"),
    ).resolves.toMatchObject({
      projectId: "project-1",
      timeZone: expect.any(String),
      automations: [],
    });
    const created = await webSession.automations.create({
      projectId: "project-1",
      name: "Nightly scripted checks",
      kind: "custom",
      prompt: "Run the scripted offline checks.",
      enabled: true,
      schedule: { cadence: "daily", time: "09:00" },
    });
    expect(created.automations).toHaveLength(1);
    const automationId = created.automations[0]!.id;

    await webSession.automations.run("project-1", automationId);
    let completed = await webSession.automations.load("project-1");
    const deadline = Date.now() + 1_000;
    while (completed.automations[0]?.lastRun?.status === "running") {
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for scripted automation");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed = await webSession.automations.load("project-1");
    }

    expect(completed.automations[0]?.lastRun).toMatchObject({
      status: "succeeded",
      threadId: "automation-thread",
      summary: "All scripted checks passed.",
    });
    expect(
      peer.requests.find(({ method }) => method === "turn/start")?.params,
    ).toMatchObject({
      threadId: "automation-thread",
      input: expect.stringContaining("Run the scripted offline checks."),
    });
    expect(
      peer.requests.find(({ method }) => method === "turn/start")?.params,
    ).toMatchObject({
      input: expect.stringContaining("Run read-only checks only."),
    });
    expect(
      (await webSession.projects.load()).projects[0]?.conversations,
    ).toContainEqual(
      expect.objectContaining({
        id: "automation-thread",
        title: "⏱ Nightly scripted checks",
        unread: true,
      }),
    );

    await expect(
      webSession.automations.delete("project-1", automationId),
    ).resolves.toMatchObject({ automations: [] });
    webSession.dispose();
  });

  it("owns remote task recovery, worktree delivery, push, and draft PR flows", async () => {
    const root = temporaryDirectory("threadlight-host-delivery-");
    const projectPath = createWorkspace(root, "project", "baseline");
    writeFileSync(
      join(projectPath, ".gitignore"),
      ".venv/\ndata/library.db\n",
    );
    mkdirSync(join(projectPath, ".venv", "bin"), { recursive: true });
    writeFileSync(join(projectPath, ".venv", "bin", "python"), "runtime\n");
    mkdirSync(join(projectPath, "data"), { recursive: true });
    writeFileSync(join(projectPath, "data", "library.db"), "baseline data\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: projectPath });
    execFileSync("git", ["commit", "-qm", "ignore local runtime"], {
      cwd: projectPath,
    });
    const homePath = join(root, "home");
    const projects = new ProjectStore(join(homePath, "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(projectPath);
    const settings = new SettingsStore(join(homePath, "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
    const changes = new ConversationChangeTracker(
      join(homePath, "review-snapshots"),
    );
    const provider = new ScriptedCodeHostProvider();
    const peers: Array<{
      root: string;
      basePath: string;
      peer: ScriptedRuntimePeer;
    }> = [];
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath,
      projects,
      settings,
      conversationChanges: changes,
      codeHostDelivery: new CodeHostDeliveryManager(changes, provider),
      port: 0,
      createPeer: ({ projectRoot, projectBasePath }) => {
        const peer = new ScriptedRuntimePeer((request, emit) => {
          if (request.method === "initialize") {
            emit({
              jsonrpc: "2.0",
              id: request.id ?? null,
              result: { protocolVersion: 2 },
            });
            return;
          }
          if (request.method === "thread/start") {
            expect(
              readFileSync(join(projectRoot, ".venv", "bin", "python"), "utf8"),
            ).toBe("runtime\n");
            writeFileSync(
              join(projectRoot, "src", "index.ts"),
              "export const value = 'task change';\n",
            );
            writeFileSync(
              join(projectRoot, "data", "library.db"),
              "task data\n",
            );
            emit({
              jsonrpc: "2.0",
              id: request.id ?? null,
              result: { threadId: "thread-1" },
            });
          }
        });
        peers.push({
          root: projectRoot,
          basePath: projectBasePath,
          peer,
        });
        return peer;
      },
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const host = new HttpHostClient({ endpoint, token: "test-token" });

    await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/rpc`,
      {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            capabilities: { executionApprovals: true },
          },
        },
      },
    );
    await expect(
      authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "thread/start",
        },
      }),
    ).resolves.toMatchObject({
      result: { threadId: "thread-1" },
    });

    const conversation = (await host.projects()).projects[0]?.conversations.find(
      ({ id }) => id === "thread-1",
    );
    expect(conversation?.workspace).toMatchObject({
      mode: "worktree",
      branch: expect.stringMatching(/^threadlight\//),
      sourceBranch: expect.stringMatching(/^(main|master)$/),
    });
    if (conversation?.workspace?.mode !== "worktree") {
      throw new Error("Expected a Host-owned worktree");
    }
    const taskPath = conversation.workspace.path;
    expect(
      peers.find(({ root: peerRoot }) => peerRoot === taskPath)?.peer.requests
        .map(({ method }) => method),
    ).toEqual(["initialize", "thread/start"]);
    expect(
      peers.find(({ root: peerRoot }) => peerRoot === taskPath)?.basePath,
    ).toBe(realpathSync(projectPath));

    const firstChanges = await host.conversationChanges(
      "project-1",
      "thread-1",
    );
    expect(firstChanges.files).toContainEqual(
      expect.objectContaining({
        path: "src/index.ts",
        oldContent: "export const value = 'baseline';\n",
        newContent: "export const value = 'task change';\n",
      }),
    );
    expect(firstChanges.files).toContainEqual(
      expect.objectContaining({
        path: "data/library.db",
        localOnly: true,
        oldContent: "baseline data\n",
        newContent: "task data\n",
      }),
    );
    await expect(
      host.conversationWorkspaceFile(
        "project-1",
        "thread-1",
        "src/index.ts",
      ),
    ).resolves.toMatchObject({
      content: "export const value = 'task change';\n",
    });

    const restoreWebSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
    });
    await expect(
      restoreWebSession.workspace.restoreChanges?.(
        "project-1",
        "thread-1",
        firstChanges.revision,
        ["src/index.ts"],
      ),
    ).resolves.toMatchObject({
      files: [expect.objectContaining({ path: "data/library.db", localOnly: true })],
    });
    restoreWebSession.dispose();
    expect(readFileSync(join(taskPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'baseline';\n",
    );

    writeFileSync(
      join(taskPath, "src", "index.ts"),
      "export const value = 'delivered';\n",
    );
    const reviewed = await host.conversationChanges(
      "project-1",
      "thread-1",
    );
    const webSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
    });
    await expect(
      webSession.workspace.list("project-1", "src", "thread-1"),
    ).resolves.toContainEqual({
      name: "index.ts",
      path: "src/index.ts",
      type: "file",
    });
    await expect(
      webSession.workspace.preflightDelivery?.(
        "project-1",
        "thread-1",
        reviewed.revision,
      ),
    ).resolves.toMatchObject({
      files: 2,
      pendingFiles: 2,
      localOnlyFiles: 1,
      conflicts: [],
    });
    await expect(
      webSession.workspace.applyDelivery?.(
        "project-1",
        "thread-1",
        reviewed.revision,
      ),
    ).resolves.toMatchObject({ appliedFiles: 2 });
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'delivered';\n",
    );
    expect(readFileSync(join(projectPath, "data", "library.db"), "utf8")).toBe(
      "task data\n",
    );
    await expect(
      webSession.workspace.commitDelivery?.(
        "project-1",
        "thread-1",
        reviewed.revision,
        "Deliver remote task",
      ),
    ).resolves.toMatchObject({
      appliedFiles: 0,
      alreadyAppliedFiles: 2,
      localOnlyFiles: 1,
      commit: expect.stringMatching(/^[a-f0-9]{40}$/),
    });
    await expect(
      webSession.workspace.getCodeHostStatus?.(
        "project-1",
        "thread-1",
        reviewed.revision,
      ),
    ).resolves.toMatchObject({
      available: true,
      pushed: false,
    });

    await expect(
      webSession.workspace.commitAndPush?.(
        "project-1",
        "thread-1",
        reviewed.revision,
        "Ship remote task",
      ),
    ).resolves.toMatchObject({
      commit: expect.stringMatching(/^[a-f0-9]{40}$/),
      status: { available: true, pushed: true },
    });
    expect(provider.pushes).toEqual([
      {
        repositoryRoot: conversation.workspace.path,
        branch: conversation.workspace.branch,
      },
    ]);
    await expect(
      webSession.workspace.createDraftPullRequest?.(
        "project-1",
        "thread-1",
        reviewed.revision,
        "Remote task",
        "Created from Web",
      ),
    ).resolves.toMatchObject({
      pushed: true,
      pullRequest: {
        draft: true,
        title: "Remote task",
      },
    });
    webSession.dispose();

    await host.updateConversation({
      projectId: "project-1",
      id: "thread-1",
      archived: true,
    });
    await host.deleteConversation({
      projectId: "project-1",
      id: "thread-1",
    });
    expect(existsSync(conversation.workspace.root)).toBe(false);
  });

  it("fails pending RPC requests immediately when a runtime exits", async () => {
    const root = temporaryDirectory("threadlight-host-exit-");
    const workspace = createWorkspace(root, "project", "value");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => value,
        decrypt: (value) => value,
      },
    );
    let peer: ScriptedRuntimePeer;
    peer = new ScriptedRuntimePeer(() => {
      peer.exit(new Error("Runtime configuration is unavailable."));
    });
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
      projects,
      settings,
      port: 0,
      allowedOrigins: ["https://threadlight.example"],
      createPeer: () => peer,
    });
    servers.push(server);
    const address = await server.start();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/projects/project-1/runtime/rpc`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        }),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32002,
        message: "Runtime configuration is unavailable.",
      },
    });
  });

  it("owns interactive terminal sessions on the Host over an authenticated WebSocket", async () => {
    const root = temporaryDirectory("threadlight-host-terminal-");
    const workspace = createWorkspace(root, "project", "value");
    const taskWorkspace = join(root, "task-workspace");
    mkdirSync(taskWorkspace);
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    projects.setConversationWorkspace(
      { projectId: "project-1", id: "thread-1" },
      { mode: "folder", path: taskWorkspace },
    );
    const settings = new SettingsStore(
      join(root, "home", "settings.json"),
      {
        encrypt: (value) => value,
        decrypt: (value) => value,
      },
    );
    const terminalSessions: ScriptedTerminalSessions[] = [];
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath: join(root, "home"),
      projects,
      settings,
      port: 0,
      allowedOrigins: [
        "https://threadlight.example",
        "http://192.168.50.186:5173",
      ],
      createPeer: () => new ScriptedRuntimePeer(),
      createTerminalSessions: (send) => {
        const sessions = new ScriptedTerminalSessions(send);
        terminalSessions.push(sessions);
        return sessions;
      },
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    expect(await authenticatedJson(`${endpoint}/v1/health`)).toMatchObject({
      capabilities: { terminal: true },
    });

    const unauthorizedStatus = await rejectedWebSocketStatus(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
    );
    expect(unauthorizedStatus).toBe(401);

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
      {
        headers: { Authorization: "Bearer test-token" },
      },
    );
    await webSocketOpened(socket);
    const openedMessage = nextWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        type: "open",
        requestId: "open-1",
        projectId: "project-1",
        threadId: "thread-1",
        cols: 100,
        rows: 30,
      }),
    );
    expect(await openedMessage).toEqual({
      type: "opened",
      requestId: "open-1",
      session: { id: "terminal-1", shell: "zsh" },
    });
    expect(terminalSessions[0]?.creates).toEqual([
      { cwd: realpathSync(taskWorkspace), cols: 100, rows: 30 },
    ]);

    const dataMessage = nextWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        type: "input",
        sessionId: "terminal-1",
        data: "pwd\r",
      }),
    );
    expect(await dataMessage).toEqual({
      type: "data",
      sessionId: "terminal-1",
      data: "echo:pwd\r",
    });
    socket.send(
      JSON.stringify({
        type: "resize",
        sessionId: "terminal-1",
        cols: 120,
        rows: 36,
      }),
    );
    socket.send(
      JSON.stringify({
        type: "close",
        sessionId: "terminal-1",
      }),
    );
    await waitFor(() => terminalSessions[0]?.closed.length === 1);
    expect(terminalSessions[0]?.resizes).toEqual([
      { sessionId: "terminal-1", cols: 120, rows: 36 },
    ]);
    expect(terminalSessions[0]?.closed).toEqual(["terminal-1"]);

    socket.close();
    await webSocketClosed(socket);

    const browserSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
      [...browserTerminalProtocols("test-token")],
      { origin: "https://threadlight.example" },
    );
    await webSocketOpened(browserSocket);
    browserSocket.close();
    await webSocketClosed(browserSocket);

    const lanBrowserSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
      [...browserTerminalProtocols("test-token")],
      { origin: "http://192.168.50.186:5173" },
    );
    await webSocketOpened(lanBrowserSocket);
    lanBrowserSocket.close();
    await webSocketClosed(lanBrowserSocket);

    const rejectedBrowserStatus = await rejectedWebSocketStatus(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
      {
        protocols: [...browserTerminalProtocols("wrong-token")],
        origin: "https://threadlight.example",
      },
    );
    expect(rejectedBrowserStatus).toBe(401);

    await waitFor(() => terminalSessions[0]?.disposed === true);
    expect(terminalSessions[0]?.disposed).toBe(true);
  });

  it("routes standalone approval responses back to the task workspace runtime", async () => {
    const root = temporaryDirectory("threadlight-host-standalone-approval-");
    const homePath = join(root, "home");
    const projects = new ProjectStore(join(homePath, "project-map.json"), {
      standaloneRoot: join(homePath, "standalone"),
    });
    projects.activateStandalone();
    const settings = new SettingsStore(join(homePath, "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
    const peers: Array<{ root: string; peer: ScriptedRuntimePeer }> = [];
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Build host",
      homePath,
      projects,
      settings,
      port: 0,
      createPeer: ({ projectRoot }) => {
        const peer = new ScriptedRuntimePeer((request, emit) => {
          if (request.method === "turn/start") {
            emit({
              jsonrpc: "2.0",
              id: request.id ?? null,
              result: { turnId: "standalone-turn" },
            });
            queueMicrotask(() => {
              emit({
                jsonrpc: "2.0",
                method: "execution/approval-required",
                params: {
                  requestId: "approval-1",
                  threadId: "standalone-thread",
                  runId: "run-1",
                  toolName: "exec_command",
                  permissionKey: "exec:npm",
                  risk: "write",
                  summary: "Run npm install",
                  detail: "npm install",
                  external: true,
                },
              });
            });
            return;
          }
          emit({
            jsonrpc: "2.0",
            id: request.id ?? null,
            result:
              request.method === "thread/start"
                ? { threadId: "standalone-thread" }
                : request.method === "execution/approval/respond"
                  ? { accepted: true }
                  : { name: "threadlight", protocolVersion: "0.1" },
          });
        });
        peers.push({ root: projectRoot, peer });
        return peer;
      },
    });
    servers.push(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const webSession = await createRemoteWebSession({
      endpoint,
      token: "test-token",
    });
    await webSession.projects.createStandalone?.();
    await webSession.client.initialize();
    const { threadId } = await webSession.client.startThread();
    const workspace = projects
      .project("standalone")
      ?.conversations.find(({ id }) => id === threadId)
      ?.workspace;
    expect(workspace).toMatchObject({ mode: "standalone" });

    const approval = Promise.withResolvers<{
      requestId: string;
      projectScopeAvailable?: boolean;
    }>();
    const unsubscribe = webSession.executionPolicy.subscribe((request) => {
      approval.resolve(request);
    });
    await webSession.client.startTurn(threadId, "Install dependencies");
    await expect(approval.promise).resolves.toMatchObject({
      requestId: "approval-1",
      projectScopeAvailable: false,
    });
    unsubscribe();
    const replayed = Promise.withResolvers<string>();
    const unsubscribeReplay = webSession.executionPolicy.subscribe(
      (request) => replayed.resolve(request.requestId),
    );
    await expect(replayed.promise).resolves.toBe("approval-1");
    await webSession.executionPolicy.respond(
      "approval-1",
      "allow",
      "task",
    );

    expect(
      peers.find(({ root: peerRoot }) => peerRoot === workspace?.path)
        ?.peer.requests,
    ).toContainEqual(
      expect.objectContaining({
        method: "execution/approval/respond",
        params: expect.objectContaining({
          requestId: "approval-1",
          threadId,
        }),
      }),
    );
    unsubscribeReplay();
    webSession.dispose();
  });
});

class ScriptedCodeHostProvider implements CodeHostProvider {
  readonly pushes: Array<{
    repositoryRoot: string;
    branch: string;
  }> = [];
  private pullRequest?: CodeHostPullRequest;

  status(
    _repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
  ) {
    return Promise.resolve({
      provider: "github" as const,
      available: true,
      repository: "threadlight/example",
      remote: "origin",
      taskBranch: headBranch,
      baseBranch,
      pushed: this.pushes.length > 0,
      ahead: 1,
      ...(this.pullRequest ? { pullRequest: this.pullRequest } : {}),
    });
  }

  push(repositoryRoot: string, branch: string): Promise<void> {
    this.pushes.push({ repositoryRoot, branch });
    return Promise.resolve();
  }

  createDraftPullRequest(
    _repositoryRoot: string,
    headBranch: string,
    baseBranch: string,
    input: { title: string; body?: string },
  ): Promise<CodeHostPullRequest> {
    this.pullRequest = {
      number: 12,
      url: "https://github.example/threadlight/example/pull/12",
      title: input.title,
      state: "open",
      draft: true,
      headBranch,
      baseBranch,
      ciStatus: "none",
      checks: [],
      comments: [],
    };
    return Promise.resolve(this.pullRequest);
  }
}

class ScriptedTerminalSessions implements TerminalSessionController {
  readonly creates: Array<{ cwd: string; cols: number; rows: number }> = [];
  readonly writes: Array<{ sessionId: string; data: string }> = [];
  readonly resizes: Array<{
    sessionId: string;
    cols: number;
    rows: number;
  }> = [];
  readonly closed: string[] = [];
  disposed = false;

  constructor(
    private readonly send: (event: TerminalSessionEvent) => void,
  ) {}

  create(cwd: string, cols: number, rows: number) {
    this.creates.push({ cwd, cols, rows });
    return { id: "terminal-1", shell: "zsh" };
  }

  write(sessionId: string, data: string): void {
    this.writes.push({ sessionId, data });
    this.send({ type: "data", sessionId, data: `echo:${data}` });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.resizes.push({ sessionId, cols, rows });
  }

  close(sessionId: string): void {
    this.closed.push(sessionId);
  }

  dispose(): void {
    this.disposed = true;
  }
}

class ScriptedRuntimePeer implements RuntimePeer {
  readonly requests: JsonRpcRequest[] = [];
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();
  private readonly exitListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly script?: (
      request: JsonRpcRequest,
      emit: (message: JsonRpcOutgoing) => void,
    ) => void,
  ) {}

  async start(): Promise<void> {}

  send(request: JsonRpcRequest): void {
    this.requests.push(request);
    this.script?.(request, (message) => this.emit(message));
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emit(message: JsonRpcOutgoing): void {
    for (const listener of this.listeners) listener(message);
  }

  exit(error: Error): void {
    for (const listener of this.exitListeners) listener(error);
  }

  async stop(): Promise<void> {}
}

class TestSseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async nextFrame(): Promise<string> {
    while (true) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 2);
        return frame;
      }
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("SSE stream ended before the next frame");
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  async nextData(): Promise<string> {
    while (true) {
      const frame = await this.nextFrame();
      if (frame.startsWith("data: ")) return frame.slice("data: ".length);
    }
  }

  cancel(): Promise<void> {
    return this.reader.cancel();
  }
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function createWorkspace(
  root: string,
  name: string,
  value: string,
): string {
  const workspace = join(root, name);
  mkdirSync(join(workspace, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "test@threadlight.local"], {
    cwd: workspace,
  });
  execFileSync("git", ["config", "user.name", "Threadlight Test"], {
    cwd: workspace,
  });
  writeFileSync(
    join(workspace, "src", "index.ts"),
    `export const value = '${value}';\n`,
  );
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: workspace });
  return workspace;
}

async function authenticatedJson(
  url: string,
  options: { method?: "POST" | "PUT"; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: "Bearer test-token",
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

function webSocketOpened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function webSocketClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", resolve));
}

function nextWebSocketMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData) => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

function rejectedWebSocketStatus(
  url: string,
  options: {
    protocols?: string[];
    origin?: string;
  } = {},
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const socket = options.protocols
      ? new WebSocket(url, options.protocols, {
          ...(options.origin ? { origin: options.origin } : {}),
        })
      : new WebSocket(url, {
          ...(options.origin ? { origin: options.origin } : {}),
        });
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("Unauthenticated WebSocket unexpectedly opened"));
    });
    socket.once("error", () => {
      // The status arrives through unexpected-response.
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for terminal event");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
