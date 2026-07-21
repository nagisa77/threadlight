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
