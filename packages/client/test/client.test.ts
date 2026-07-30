import { describe, expect, it } from "vitest";

import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

import {
  ClientClosedError,
  RpcResponseError,
  ThreadlightClient,
  type ClientTransport,
} from "../src/index.js";

class ScriptedTransport implements ClientTransport {
  readonly sent: JsonRpcRequest[] = [];
  private listener?: (message: JsonRpcOutgoing) => void;

  send(message: JsonRpcRequest): void {
    this.sent.push(message);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(message: JsonRpcOutgoing): void {
    this.listener?.(message);
  }
}

describe("ThreadlightClient", () => {
  it("sends follow-up queue mutations", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const followUp = client.addFollowUp(
      "thread-1",
      "Check the smaller scope",
      "queued",
    );
    expect(transport.sent[0]).toMatchObject({
      method: "turn/follow-up",
      params: {
        threadId: "thread-1",
        input: "Check the smaller scope",
        delivery: "queued",
      },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: {
        item: {
          id: "item-1",
          input: "Check the smaller scope",
          delivery: "queued",
          createdAt: "2026-07-29T10:00:00.000Z",
        },
      },
    });
    await expect(followUp).resolves.toMatchObject({
      item: { id: "item-1" },
    });

    const reordered = client.reorderQueuedTurn(
      "thread-1",
      "item-1",
      "item-2",
    );
    expect(transport.sent[1]).toMatchObject({
      method: "turn/queue/reorder",
      params: {
        threadId: "thread-1",
        itemId: "item-1",
        beforeItemId: "item-2",
      },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[1].id ?? null,
      result: { queuedTurns: [] },
    });
    await reordered;

    const canceled = client.cancelQueuedTurn("thread-1", "item-1");
    expect(transport.sent[2]).toMatchObject({
      method: "turn/queue/cancel",
      params: { threadId: "thread-1", itemId: "item-1" },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[2].id ?? null,
      result: { canceled: true, queuedTurns: [] },
    });
    await expect(canceled).resolves.toMatchObject({ canceled: true });
    client.dispose();
  });

  it("lists task capabilities and sends selected references", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const listed = client.listCapabilities("thread-1");
    expect(transport.sent[0]).toMatchObject({
      method: "capability/list",
      params: { threadId: "thread-1" },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: {
        capabilities: [
          {
            id: "skill:documents",
            kind: "skill",
            name: "documents",
            description: "Create documents",
          },
        ],
      },
    });
    await expect(listed).resolves.toMatchObject({
      capabilities: [{ id: "skill:documents" }],
    });

    const started = client.startTurn(
      "thread-1",
      "Create a brief",
      [],
      "default",
      ["skill:documents"],
    );
    expect(transport.sent[1]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: "Create a brief",
        capabilityRefs: ["skill:documents"],
      },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[1].id ?? null,
      result: { turnId: "turn-1" },
    });
    await expect(started).resolves.toEqual({ turnId: "turn-1" });
    client.dispose();
  });

  it("sends an explicit user-selected Plan mode with the turn", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const started = client.startTurn("thread-1", "Build this", [], "plan");

    expect(transport.sent[0]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: "Build this",
        mode: "plan",
      },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: { turnId: "turn-1" },
    });
    await expect(started).resolves.toEqual({ turnId: "turn-1" });
    client.dispose();
  });

  it("sends full access only when the conversation explicitly selects it", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const started = client.startTurn(
      "thread-1",
      "Use the trusted workspace",
      [],
      "default",
      [],
      "full",
    );

    expect(transport.sent[0]).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: "Use the trusted workspace",
        accessMode: "full",
      },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: { turnId: "turn-1" },
    });
    await expect(started).resolves.toEqual({ turnId: "turn-1" });
    client.dispose();
  });

  it("sends connector configuration and authorization requests", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const configured = client.configureConnector(
      "thread-1",
      "mcp:gmail",
      "client-id",
      "client-secret",
    );
    const authorized = client.authorizeConnector("thread-1", "mcp:gmail");
    const disconnected = client.disconnectConnector(
      "thread-1",
      "mcp:gmail",
    );

    expect(transport.sent).toMatchObject([
      {
        method: "connector/configure",
        params: {
          threadId: "thread-1",
          capabilityId: "mcp:gmail",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      },
      {
        method: "connector/authorize",
        params: {
          threadId: "thread-1",
          capabilityId: "mcp:gmail",
        },
      },
      {
        method: "connector/disconnect",
        params: {
          threadId: "thread-1",
          capabilityId: "mcp:gmail",
        },
      },
    ]);
    for (const request of transport.sent) {
      transport.emit({
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          capabilityId: "mcp:gmail",
          connectorId: "gmail",
          name: "Gmail",
          status: "ready",
          configured: true,
          authorized: true,
          redirectUrl:
            "http://127.0.0.1:43119/oauth/callback/gmail",
        },
      });
    }
    await Promise.all([configured, authorized, disconnected]);
    client.dispose();
  });

  it("correlates responses independently of their arrival order", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const initialized = client.initialize();
    const started = client.startThread();
    const [initializeRequest, startRequest] = transport.sent;

    transport.emit({
      jsonrpc: "2.0",
      id: startRequest.id ?? null,
      result: { threadId: "thread-1" },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: initializeRequest.id ?? null,
      result: { name: "threadlight", protocolVersion: "0.1" },
    });

    await expect(initialized).resolves.toEqual({
      name: "threadlight",
      protocolVersion: "0.1",
    });
    await expect(started).resolves.toEqual({ threadId: "thread-1" });
  });

  it("exposes typed notification subscriptions", () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);
    const events: string[] = [];

    client.on("turn/completed", ({ output }) => events.push(output));
    transport.emit({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        output: "done",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    });

    expect(events).toEqual(["done"]);
  });

  it("sends a typed task deletion request", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const deleted = client.deleteThread("thread-1");
    expect(transport.sent[0]).toMatchObject({
      method: "thread/delete",
      params: { threadId: "thread-1" },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: { deleted: true },
    });

    await expect(deleted).resolves.toEqual({ deleted: true });
  });

  it("requests three opening questions in the selected language", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const suggested = client.suggestQuestions("thread-1", "zh-CN");
    expect(transport.sent[0]).toMatchObject({
      method: "thread/suggestions",
      params: { threadId: "thread-1", language: "zh-CN" },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: {
        suggestions: ["问题一？", "问题二？", "问题三？"],
      },
    });

    await expect(suggested).resolves.toEqual({
      suggestions: ["问题一？", "问题二？", "问题三？"],
    });
  });

  it("sends a typed managed-process termination request", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);
    const killed = client.killProcess("session-1");
    expect(transport.sent[0]).toMatchObject({
      method: "process/kill",
      params: { sessionId: "session-1" },
    });
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      result: {
        sessionId: "session-1",
        command: "sleep 10",
        cwd: "/workspace",
        status: "terminated",
        exitCode: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
        truncated: false,
        startedAt: "2026-07-22T08:00:00.000Z",
        completedAt: "2026-07-22T08:00:01.000Z",
      },
    });

    await expect(killed).resolves.toMatchObject({
      sessionId: "session-1",
      status: "terminated",
    });
  });

  it("rejects RPC errors and pending requests on disposal", async () => {
    const transport = new ScriptedTransport();
    const client = new ThreadlightClient(transport);

    const failed = client.initialize();
    transport.emit({
      jsonrpc: "2.0",
      id: transport.sent[0].id ?? null,
      error: { code: -32002, message: "not ready" },
    });
    await expect(failed).rejects.toEqual(
      expect.objectContaining<RpcResponseError>({
        code: -32002,
        message: "not ready",
      }),
    );

    const pending = client.startThread();
    client.dispose();
    await expect(pending).rejects.toBeInstanceOf(ClientClosedError);
    await expect(client.startThread()).rejects.toBeInstanceOf(
      ClientClosedError,
    );
  });
});
