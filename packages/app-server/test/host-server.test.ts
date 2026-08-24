import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
  WorktreeDeliveryManager,
  type CodeHostPullRequest,
  type CodeHostProvider,
} from "@threadlight/host-core";
import { browserTerminalProtocols, HttpHostClient } from "@threadlight/client";
import { createRemoteWebSession } from "@threadlight/web-runtime";
import { VOICE_INPUT_ERROR_CODES } from "@threadlight/protocol";
import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
  TerminalSessionEvent,
} from "@threadlight/protocol";
import type { TerminalSessionController } from "@threadlight/terminal-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";

import { ThreadlightHostServer } from "../src/host-server.js";
import type { RuntimePeer } from "../src/remote-runtime-peer.js";

import {
  cleanupHostFixtures,
  trackHostServer,
  ScriptedCodeHostProvider,
  ScriptedTerminalSessions,
  ScriptedRuntimePeer,
  TestSseReader,
  temporaryDirectory,
  createWorkspace,
  authenticatedJson,
  webSocketOpened,
  webSocketClosed,
  nextWebSocketMessage,
  rejectedWebSocketStatus,
  waitFor,
} from "./host-server-fixtures.js";

afterEach(cleanupHostFixtures);

describe("ThreadlightHostServer", () => {
  it("serves the bundled Web SPA from the Host origin without exposing APIs", async () => {
    const root = temporaryDirectory("threadlight-host-web-");
    const webRoot = join(root, "web");
    mkdirSync(join(webRoot, "assets"), { recursive: true });
    writeFileSync(
      join(webRoot, "index.html"),
      '<!doctype html><div id="root">Threadlight Web</div>',
    );
    writeFileSync(join(webRoot, "assets", "app-ABC123.js"), "export {};\n");
    const projects = new ProjectStore(join(root, "home", "project-map.json"));
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Bundled Web host",
      homePath: join(root, "home"),
      projects,
      settings: new SettingsStore(join(root, "home", "settings.json"), {
        encrypt: (value) => value,
        decrypt: (value) => value,
      }),
      webRoot,
      port: 0,
      createPeer: () => new ScriptedRuntimePeer(),
    });
    trackHostServer(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;

    const page = await fetch(`${endpoint}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(await page.text()).toContain("Threadlight Web");

    const taskRoute = await fetch(`${endpoint}/tasks/thread-1`);
    expect(taskRoute.status).toBe(200);
    expect(await taskRoute.text()).toContain("Threadlight Web");

    const asset = await fetch(`${endpoint}/assets/app-ABC123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(asset.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await asset.text()).toBe("export {};\n");

    expect((await fetch(`${endpoint}/missing.js`)).status).toBe(404);
    expect((await fetch(`${endpoint}/v1/health`)).status).toBe(401);
    await expect(
      authenticatedJson(`${endpoint}/v1/health`),
    ).resolves.toMatchObject({ ok: true, name: "Bundled Web host" });
  });

  it("repairs legacy no-change attention without hiding real delivery failures", async () => {
    const root = temporaryDirectory("threadlight-host-delivery-repair-");
    const workspace = createWorkspace(root, "project", "delivery repair");
    const taskWorkspace = join(root, "task-workspace");
    mkdirSync(taskWorkspace);
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const gitWorkspace = {
      mode: "worktree" as const,
      path: taskWorkspace,
      root: taskWorkspace,
      repositoryRoot: workspace,
      branch: "threadlight/project-repair",
      baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        encoding: "utf8",
      }).trim(),
      sourceBranch: "main",
    };
    for (const id of ["no-changes", "real-failure"]) {
      projects.upsertConversation({ projectId: "project-1", id, title: id });
      projects.setConversationWorkspace(
        { projectId: "project-1", id },
        gitWorkspace,
      );
      projects.markConversationAttention({ projectId: "project-1", id });
    }
    const changes = new ConversationChangeTracker(
      join(root, "home", "review-snapshots"),
    );
    const delivery = new WorktreeDeliveryManager(changes);
    await delivery.recordFailure(
      {
        projectId: "project-1",
        threadId: "no-changes",
        revision: "empty-revision",
        projectPath: workspace,
        workspace: gitWorkspace,
      },
      "This task has no changes to deliver",
    );
    await delivery.recordFailure(
      {
        projectId: "project-1",
        threadId: "real-failure",
        revision: "failed-revision",
        projectPath: workspace,
        workspace: gitWorkspace,
      },
      "Target file changed after review",
    );
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Repair host",
      homePath: join(root, "home"),
      projects,
      settings: new SettingsStore(join(root, "home", "settings.json"), {
        encrypt: (value) => value,
        decrypt: (value) => value,
      }),
      worktreeDelivery: delivery,
      port: 0,
      createPeer: () => new ScriptedRuntimePeer(),
    });
    trackHostServer(server);

    await server.start();

    const conversations = projects.snapshot().projects[0]?.conversations;
    expect(
      conversations?.find((conversation) => conversation.id === "no-changes")
        ?.status,
    ).toBe("completed");
    expect(
      conversations?.find((conversation) => conversation.id === "real-failure")
        ?.status,
    ).toBe("attention");
  });

  it("streams runtime notifications as SSE with periodic heartbeats", async () => {
    const root = temporaryDirectory("threadlight-host-sse-");
    const workspace = createWorkspace(root, "project", "sse");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const settings = new SettingsStore(join(root, "home", "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
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
    trackHostServer(server);
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

    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      },
    });
    const notification = {
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: "thread-1", output: "done" },
    } satisfies JsonRpcOutgoing;
    peer.emit(notification);
    await expect(events.nextData()).resolves.toBe(JSON.stringify(notification));
    await events.cancel();
  });

  it("reports live threads after a display client refreshes", async () => {
    const root = temporaryDirectory("threadlight-host-running-threads-");
    const workspace = createWorkspace(root, "project", "running threads");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    projects.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Long running task",
    });
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
      name: "Running thread host",
      homePath: join(root, "home"),
      projects,
      settings: new SettingsStore(join(root, "home", "settings.json"), {
        encrypt: (value) => value,
        decrypt: (value) => value,
      }),
      port: 0,
      createPeer: () => peer,
    });
    trackHostServer(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const hostClient = new HttpHostClient({
      endpoint,
      token: "test-token",
    });

    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    peer.emit({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        revision: 1,
        mode: "default",
        activeTurn: {
          turnId: "turn-1",
          revision: 1,
          mode: "default",
          isThinking: true,
          streamingText: "",
          progress: [],
        },
      },
    });

    await expect(hostClient.projects()).resolves.toMatchObject({
      runningThreadIds: ["thread-1"],
    });

    peer.emit({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        revision: 2,
        output: "done",
      },
    });
    await expect(hostClient.projects()).resolves.toMatchObject({
      runningThreadIds: [],
    });
  });

  it("serves multiple projects and host-owned settings with scripted peers", async () => {
    const root = temporaryDirectory("threadlight-host-");
    const firstWorkspace = createWorkspace(root, "first", "first");
    const secondWorkspace = createWorkspace(root, "second", "second");
    const hiddenWorkspace = join(root, ".hidden");
    mkdirSync(hiddenWorkspace);
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
    const settings = new SettingsStore(join(root, "home", "settings.json"), {
      encrypt: (value) => `sealed:${value}`,
      decrypt: (value) => value.replace(/^sealed:/, ""),
    });
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
    trackHostServer(server);
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
      hostClient.diagnosticBundle("project-1"),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      environment: { runtime: "host" },
      conversations: [
        {
          threadId: "usage-thread",
          record: {
            messages: [{ text: "private response content" }],
          },
        },
      ],
      timeline: [
        expect.objectContaining({
          kind: "turn",
          durationMs: 1_250,
        }),
        expect.objectContaining({ kind: "model", durationMs: 900 }),
        expect.objectContaining({ kind: "tool", durationMs: 200 }),
      ],
    });
    await expect(
      hostClient.diagnosticBundle("project-1", ["usage-thread"]),
    ).resolves.toMatchObject({
      project: {
        exportScope: "conversations",
        conversationIds: ["usage-thread"],
      },
      conversations: [{ threadId: "usage-thread" }],
    });
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
    ).rejects.toThrow(VOICE_INPUT_ERROR_CODES.openAiKeyRequired);

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
    expect([...readFileSync(uploadedAttachment.path)]).toEqual([1, 2, 3, 4, 5]);
    expect([
      ...new Uint8Array(
        await hostClient.downloadAttachment("project-1", uploadedAttachment.id),
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
      protocolVersion: 5,
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
      parentPath: dirname(root),
      directories: [
        {
          name: "first",
          path: firstWorkspace,
        },
      ],
    });
    const rootDirectories = (await authenticatedJson(
      `${endpoint}/v1/host/directories?path=${encodeURIComponent(root)}`,
    )) as { directories: Array<{ name: string; path: string }> };
    expect(rootDirectories.directories).not.toContainEqual({
      name: ".hidden",
      path: hiddenWorkspace,
    });
    expect(
      await authenticatedJson(
        `${endpoint}/v1/host/directories?path=${encodeURIComponent(`${root}/.`)}`,
      ),
    ).toEqual({
      path: root,
      parentPath: dirname(root),
      directories: [
        {
          name: ".hidden",
          path: hiddenWorkspace,
        },
      ],
    });
    const strictDirectoriesWithHidden = (await authenticatedJson(
      `${endpoint}/v1/host/directories?${new URLSearchParams({
        path: root,
        showHidden: "true",
        strict: "true",
      })}`,
    )) as {
      path: string;
      parentPath?: string;
      directories: Array<{ name: string; path: string }>;
    };
    expect(strictDirectoriesWithHidden).toMatchObject({
      path: root,
      parentPath: dirname(root),
    });
    expect(strictDirectoriesWithHidden.directories).toContainEqual({
      name: ".hidden",
      path: hiddenWorkspace,
    });
    expect(strictDirectoriesWithHidden.directories).toContainEqual({
      name: "first",
      path: firstWorkspace,
    });
    const strictDirectoriesWithoutHidden = (await authenticatedJson(
      `${endpoint}/v1/host/directories?${new URLSearchParams({
        path: root,
        strict: "true",
      })}`,
    )) as {
      directories: Array<{ name: string; path: string }>;
    };
    expect(strictDirectoriesWithoutHidden.directories).not.toContainEqual({
      name: ".hidden",
      path: hiddenWorkspace,
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
    expect(
      Buffer.from(
        await hostClient.downloadFile(join(systemFiles, "notes.txt")),
      ).toString("utf8"),
    ).toBe("remote notes\n");

    const firstFile = await authenticatedJson(
      `${endpoint}/v1/projects/project-1/runtime/workspace/file?path=src%2Findex.ts`,
    );
    const secondFile = await authenticatedJson(
      `${endpoint}/v1/projects/project-2/runtime/workspace/file?path=src%2Findex.ts`,
    );
    expect(firstFile).toMatchObject({
      content: "export const value = 'first';\n",
    });
    expect(secondFile).toMatchObject({
      content: "export const value = 'second';\n",
    });
    const runtimeDownload = await fetch(
      `${endpoint}/v1/projects/project-1/runtime/workspace/download?path=src%2Findex.ts`,
      { headers: { Authorization: "Bearer test-token" } },
    );
    expect(await runtimeDownload.text()).toBe(
      "export const value = 'first';\n",
    );
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
    expect([...peers.keys()].some((key) => key.startsWith("project-2:"))).toBe(
      true,
    );

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
    const listRemoteDirectories = webSession.projects.listRemoteDirectories;
    await expect(listRemoteDirectories?.(join(root, "f"))).resolves.toEqual({
      path: root,
      parentPath: dirname(root),
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
    const loadedPreview =
      await webSession.attachmentPreview.loadImageUrl?.(uploadedAttachment);
    expect(loadedPreview).toMatch(/^blob:/);
    expect([
      ...new Uint8Array(await (await fetch(loadedPreview!)).arrayBuffer()),
    ]).toEqual([1, 2, 3, 4, 5]);

    const webAttachment = await webSession.attachmentStage.stage(
      new File([Uint8Array.from([6, 7, 8, 9])], "web-diagram.png", {
        type: "image/png",
      }),
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
    expect(webSession.attachmentPreview.imageUrl(webAttachment)).toMatch(
      /^blob:/,
    );
    await expect(
      webSession.workspace.list("project-1", "src"),
    ).resolves.toContainEqual({
      name: "index.ts",
      path: "src/index.ts",
      type: "file",
    });
    expect(
      Buffer.from(
        await webSession.workspace.download?.("project-1", "src/index.ts")!,
      ).toString("utf8"),
    ).toBe("export const value = 'first';\n");
    expect(
      Buffer.from(
        await webSession.workspace.downloadSystemFile?.(
          join(systemFiles, "notes.txt"),
        )!,
      ).toString("utf8"),
    ).toBe("remote notes\n");
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
    await expect(
      voiceWebSession.voiceInput.prepare?.(),
    ).resolves.toBeUndefined();
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

  it("deletes a project from the Host index without clearing its .threadlight chats", async () => {
    const root = temporaryDirectory("threadlight-host-project-delete-");
    const firstWorkspace = createWorkspace(root, "first", "first");
    const secondWorkspace = createWorkspace(root, "second", "second");
    const homePath = join(root, "home");
    let nextId = 0;
    const projects = new ProjectStore(join(homePath, "project-map.json"), {
      createId: () => `project-${++nextId}`,
    });
    projects.register(firstWorkspace);
    projects.register(secondWorkspace);
    const conversationPath = join(
      firstWorkspace,
      ".threadlight",
      "conversations",
      "thread-1.json",
    );
    mkdirSync(dirname(conversationPath), { recursive: true });
    writeFileSync(
      conversationPath,
      JSON.stringify({
        version: 1,
        threadId: "thread-1",
        createdAt: "2026-07-30T01:00:00.000Z",
        updatedAt: "2026-07-30T01:05:00.000Z",
        title: "Kept chat",
        messages: [],
      }),
    );
    const settings = new SettingsStore(join(homePath, "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
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
      name: "Project delete host",
      homePath,
      projects,
      settings,
      port: 0,
      createPeer: () => peer,
    });
    trackHostServer(server);
    const address = await server.start();
    const webSession = await createRemoteWebSession({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: "test-token",
    });

    const snapshot = await webSession.projects.deleteProject("project-1");
    expect(snapshot.projects.map(({ id }) => id)).toEqual(["project-2"]);
    expect(snapshot.activeProjectId).toBe("project-2");
    expect(existsSync(conversationPath)).toBe(true);

    // Reopening the folder restores the kept conversation from disk.
    const restored = await webSession.projects.openFolder(firstWorkspace);
    const firstProject = restored.projects.find(
      (project) => project.basePath === realpathSync(firstWorkspace),
    );
    expect(firstProject?.conversations.map(({ id }) => id)).toEqual([
      "thread-1",
    ]);
    expect(firstProject?.conversations[0]).toMatchObject({
      title: "Kept chat",
      createdAt: "2026-07-30T01:00:00.000Z",
    });
    webSession.dispose();
  });
});
