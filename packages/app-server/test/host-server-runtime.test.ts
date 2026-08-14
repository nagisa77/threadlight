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

describe("ThreadlightHostServer runtime", () => {
  it("owns remote local/worktree selection and keeps completed worktree changes isolated", async () => {
    const root = temporaryDirectory("threadlight-host-delivery-");
    const projectPath = createWorkspace(root, "project", "baseline");
    writeFileSync(join(projectPath, ".gitignore"), ".venv/\ndata/library.db\n");
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
              result: { protocolVersion: 3 },
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
            return;
          }
          if (request.method === "turn/start") {
            const input = (request.params as { input?: unknown } | undefined)
              ?.input;
            const failed = input === "Fail safely";
            const conflict = input === "Conflict sync";
            const turnId = failed
              ? "turn-failed"
              : conflict
                ? "turn-conflict"
                : "turn-worktree";
            writeFileSync(
              join(projectRoot, "src", "index.ts"),
              failed
                ? "export const value = 'failed turn';\n"
                : conflict
                  ? "export const value = 'conflicting turn';\n"
                  : "export const value = 'worktree turn';\n",
            );
            emit({
              jsonrpc: "2.0",
              id: request.id ?? null,
              result: { turnId },
            });
            queueMicrotask(() => {
              emit({
                jsonrpc: "2.0",
                method: failed ? "turn/failed" : "turn/completed",
                params: {
                  threadId: "thread-1",
                  turnId,
                  ...(failed
                    ? { error: "Scripted turn failed" }
                    : { output: "Updated worktree" }),
                },
              });
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
    trackHostServer(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const host = new HttpHostClient({ endpoint, token: "test-token" });

    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          capabilities: { executionApprovals: true },
        },
      },
    });
    await expect(
      authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
        method: "POST",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "thread/start",
          params: { developmentMode: "worktree" },
        },
      }),
    ).resolves.toMatchObject({
      result: { threadId: "thread-1" },
    });

    const conversation = (
      await host.projects()
    ).projects[0]?.conversations.find(({ id }) => id === "thread-1");
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
      peers
        .find(({ root: peerRoot }) => peerRoot === taskPath)
        ?.peer.requests.map(({ method }) => method),
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
      host.conversationWorkspaceFile("project-1", "thread-1", "src/index.ts"),
    ).resolves.toMatchObject({
      content: "export const value = 'task change';\n",
    });
    expect(
      Buffer.from(
        await host.downloadConversationWorkspaceFile(
          "project-1",
          "thread-1",
          "src/index.ts",
        ),
      ).toString("utf8"),
    ).toBe("export const value = 'task change';\n");

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
      files: [
        expect.objectContaining({ path: "data/library.db", localOnly: true }),
      ],
    });
    restoreWebSession.dispose();
    expect(readFileSync(join(taskPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'baseline';\n",
    );

    writeFileSync(
      join(taskPath, "src", "index.ts"),
      "export const value = 'delivered';\n",
    );
    const reviewed = await host.conversationChanges("project-1", "thread-1");
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
    await expect(
      webSession.workspace.getDeliveryHistory?.("project-1", "thread-1"),
    ).resolves.toMatchObject({
      synchronizedFiles: 2,
      undoPoint: {
        revision: reviewed.revision,
        files: expect.arrayContaining(["src/index.ts", "data/library.db"]),
      },
      entries: [
        expect.objectContaining({
          status: "synced",
          revision: reviewed.revision,
        }),
      ],
    });
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'delivered';\n",
    );
    expect(readFileSync(join(projectPath, "data", "library.db"), "utf8")).toBe(
      "task data\n",
    );
    await expect(
      webSession.workspace.undoDelivery?.(
        "project-1",
        "thread-1",
        reviewed.revision,
      ),
    ).resolves.toMatchObject({
      targetBranch: expect.stringMatching(/^(main|master)$/),
      revertedFiles: 2,
    });
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'baseline';\n",
    );
    await expect(
      webSession.workspace.applyDelivery?.(
        "project-1",
        "thread-1",
        reviewed.revision,
      ),
    ).resolves.toMatchObject({ appliedFiles: 2, undoAvailable: true });
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
      webSession.workspace.createPullRequest?.(
        "project-1",
        "thread-1",
        reviewed.revision,
        "Remote task",
        "Created from Web",
        true,
      ),
    ).resolves.toMatchObject({
      pushed: true,
      pullRequest: {
        draft: true,
        title: "Remote task",
      },
    });

    const deliveryStates: string[] = [];
    let completedTurnObserved = false;
    let failedTurnObserved = false;
    const unsubscribeDeliverySyncing = webSession.client.on(
      "delivery/syncing",
      ({ threadId }) => {
        if (threadId === "thread-1") deliveryStates.push("syncing");
      },
    );
    const unsubscribeDeliverySynced = webSession.client.on(
      "delivery/synced",
      ({ threadId }) => {
        if (threadId === "thread-1") deliveryStates.push("synced");
      },
    );
    const unsubscribeDeliveryConflict = webSession.client.on(
      "delivery/conflict",
      (event) => {
        if (event.threadId !== "thread-1") return;
        deliveryStates.push("conflict");
      },
    );
    const unsubscribeDeliveryFailed = webSession.client.on(
      "delivery/failed",
      (event) => {
        if (event.threadId === "thread-1") {
          deliveryStates.push("failed");
        }
      },
    );
    const unsubscribeCompletedTurn = webSession.client.on(
      "turn/completed",
      ({ threadId }) => {
        if (threadId === "thread-1") completedTurnObserved = true;
      },
    );
    const unsubscribeFailedTurn = webSession.client.on(
      "turn/failed",
      ({ threadId }) => {
        if (threadId === "thread-1") failedTurnObserved = true;
      },
    );

    const originalBeforeCompletedTurn = readFileSync(
      join(projectPath, "src", "index.ts"),
      "utf8",
    );
    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "turn/start",
        params: { threadId: "thread-1", input: "Update the value" },
      },
    });
    await waitFor(() => completedTurnObserved);
    expect(readFileSync(join(taskPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'worktree turn';\n",
    );
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf8")).toBe(
      originalBeforeCompletedTurn,
    );
    expect(deliveryStates).toEqual([]);

    writeFileSync(
      join(projectPath, "src", "index.ts"),
      "export const value = 'manual original';\n",
    );
    completedTurnObserved = false;
    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "turn/start",
        params: { threadId: "thread-1", input: "Conflict sync" },
      },
    });
    await waitFor(() => completedTurnObserved);
    expect(deliveryStates).toEqual([]);
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'manual original';\n",
    );
    const completedConversation = (
      await host.projects()
    ).projects[0]?.conversations.find(({ id }) => id === "thread-1");
    expect(completedConversation).toMatchObject({ status: "completed" });

    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "turn/start",
        params: { threadId: "thread-1", input: "Fail safely" },
      },
    });
    await waitFor(() => failedTurnObserved);
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf8")).toBe(
      "export const value = 'manual original';\n",
    );
    expect(deliveryStates).toEqual([]);

    writeFileSync(
      join(projectPath, "src", "index.ts"),
      "export const value = 'manual original';\n",
    );
    execFileSync("git", ["switch", "-c", "other"], { cwd: projectPath });
    const failedDeliveryChanges = await host.conversationChanges(
      "project-1",
      "thread-1",
    );
    await expect(
      webSession.workspace.applyDelivery?.(
        "project-1",
        "thread-1",
        failedDeliveryChanges.revision,
      ),
    ).rejects.toThrow("original worktree is now on other");
    unsubscribeDeliverySyncing();
    unsubscribeDeliverySynced();
    unsubscribeDeliveryConflict();
    unsubscribeDeliveryFailed();
    unsubscribeCompletedTurn();
    unsubscribeFailedTurn();
    const deliveryJournalDirectory = join(
      projectPath,
      ".threadlight",
      "delivery-journal",
    );
    expect(existsSync(deliveryJournalDirectory)).toBe(true);
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
    expect(existsSync(deliveryJournalDirectory)).toBe(true);
    expect(readdirSync(deliveryJournalDirectory)).toEqual([]);
  }, 20_000);

  it("fails pending RPC requests immediately when a runtime exits", async () => {
    const root = temporaryDirectory("threadlight-host-exit-");
    const workspace = createWorkspace(root, "project", "value");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    const settings = new SettingsStore(join(root, "home", "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
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
    trackHostServer(server);
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

  it("marks running tasks for attention and forwards the transport failure into recovery", async () => {
    const root = temporaryDirectory("threadlight-host-runtime-failure-");
    const workspace = createWorkspace(root, "project", "runtime failure");
    const projects = new ProjectStore(join(root, "home", "project-map.json"), {
      createId: () => "project-1",
    });
    projects.register(workspace);
    projects.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Backpressured task",
    });
    projects.markConversationPending({
      projectId: "project-1",
      id: "thread-1",
    });
    const firstPeer = new ScriptedRuntimePeer((request, emit) => {
      emit({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: { name: "threadlight", protocolVersion: "0.1" },
      });
    });
    const secondPeer = new ScriptedRuntimePeer((request, emit) => {
      emit({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result:
          request.method === "thread/resume"
            ? {
                threadId: "thread-1",
                messages: [],
                queuedTurns: [],
                revision: 2,
              }
            : { name: "threadlight", protocolVersion: "0.1" },
      });
    });
    const peers = [firstPeer, secondPeer];
    const server = new ThreadlightHostServer({
      token: "test-token",
      hostId: "host-1",
      name: "Runtime failure host",
      homePath: join(root, "home"),
      projects,
      settings: new SettingsStore(join(root, "home", "settings.json"), {
        encrypt: (value) => value,
        decrypt: (value) => value,
      }),
      port: 0,
      createPeer: () => peers.shift()!,
    });
    trackHostServer(server);
    const address = await server.start();
    const endpoint = `http://127.0.0.1:${address.port}`;

    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    firstPeer.emit({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        revision: 7,
        mode: "default",
        activeTurn: {
          turnId: "turn-1",
          revision: 7,
          mode: "default",
          isThinking: true,
          streamingText: "working",
          progress: [],
        },
      },
    });
    const response = await fetch(
      `${endpoint}/v1/projects/project-1/runtime/events`,
      { headers: { Authorization: "Bearer test-token" } },
    );
    const events = new TestSseReader(response.body!);
    const transportError =
      "Remote runtime app-server exited with code 1: App-server output transport failed: JSON line output exceeded 67108864 buffered bytes";

    firstPeer.exit(new Error(transportError));

    await expect(events.nextData()).resolves.toBe(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/failed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          revision: 8,
          message: {
            id: "runtime-exited:turn-1",
            role: "assistant",
            text: transportError,
            error: true,
          },
          error: transportError,
        },
      }),
    );
    expect(
      projects
        .snapshot()
        .projects[0]?.conversations.find(({ id }) => id === "thread-1"),
    ).toMatchObject({ status: "attention", unread: true });

    await authenticatedJson(`${endpoint}/v1/projects/project-1/runtime/rpc`, {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "thread/resume",
        params: { threadId: "thread-1" },
      },
    });
    expect(
      secondPeer.requests.find(({ method }) => method === "thread/resume"),
    ).toMatchObject({
      params: { threadId: "thread-1", runtimeError: transportError },
    });
    await events.cancel();
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
    const settings = new SettingsStore(join(root, "home", "settings.json"), {
      encrypt: (value) => value,
      decrypt: (value) => value,
    });
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
    trackHostServer(server);
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
      session: {
        id: "terminal-1",
        shell: "zsh",
        cwd: realpathSync(taskWorkspace),
      },
    });
    expect(terminalSessions[0]?.creates).toEqual([
      { cwd: realpathSync(taskWorkspace), cols: 100, rows: 30 },
    ]);

    const originalOpenedMessage = nextWebSocketMessage(socket);
    socket.send(
      JSON.stringify({
        type: "open",
        requestId: "open-original",
        projectId: "project-1",
        threadId: "thread-1",
        workspace: "original",
        cols: 90,
        rows: 26,
      }),
    );
    expect(await originalOpenedMessage).toEqual({
      type: "opened",
      requestId: "open-original",
      session: {
        id: "terminal-1",
        shell: "zsh",
        cwd: realpathSync(workspace),
        branch: execFileSync(
          "git",
          ["-C", workspace, "branch", "--show-current"],
          { encoding: "utf8" },
        ).trim(),
      },
    });
    expect(terminalSessions[0]?.creates).toEqual([
      { cwd: realpathSync(taskWorkspace), cols: 100, rows: 30 },
      { cwd: realpathSync(workspace), cols: 90, rows: 26 },
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

    const sameOriginBrowserSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/v1/host/terminal`,
      [...browserTerminalProtocols("test-token")],
      { origin: endpoint },
    );
    await webSocketOpened(sameOriginBrowserSocket);
    sameOriginBrowserSocket.close();
    await webSocketClosed(sameOriginBrowserSocket);

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
    trackHostServer(server);
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
      ?.conversations.find(({ id }) => id === threadId)?.workspace;
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
    const unsubscribeReplay = webSession.executionPolicy.subscribe((request) =>
      replayed.resolve(request.requestId),
    );
    await expect(replayed.promise).resolves.toBe("approval-1");
    await webSession.executionPolicy.respond("approval-1", "allow", "task");

    expect(
      peers.find(({ root: peerRoot }) => peerRoot === workspace?.path)?.peer
        .requests,
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
              output: "All scripted checks passed.\n\nAUTOMATION_STATUS: ok",
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
    trackHostServer(server);
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
});
