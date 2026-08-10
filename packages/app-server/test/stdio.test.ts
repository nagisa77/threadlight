import { Writable } from "node:stream";

import {
  AgentLoop,
  defineAgent,
  defineTool,
  type ModelProvider,
} from "@threadlight/agent-loop";
import type { JsonRpcOutgoing } from "@threadlight/protocol";
import { describe, expect, it, vi } from "vitest";

import { AppServer } from "../src/app-server.js";
import { appServerOutputCoalesceKey, jsonLineSender } from "../src/stdio.js";

describe("jsonLineSender", () => {
  it("keeps only one transport write in flight while output is backpressured", async () => {
    const chunks: string[] = [];
    const callbacks: ((error?: Error | null) => void)[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString("utf8"));
        callbacks.push(callback);
      },
    });
    const write = vi.spyOn(output, "write");
    const send = jsonLineSender(output);

    send(notification(1));
    send(notification(2));
    send(notification(3));

    expect(write).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([`${JSON.stringify(notification(1))}\n`]);

    callbacks.shift()?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(write).toHaveBeenCalledTimes(2);
    expect(chunks).toHaveLength(2);

    callbacks.shift()?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(write).toHaveBeenCalledTimes(3);
    expect(chunks).toHaveLength(3);

    callbacks.shift()?.();
    output.destroy();
  });

  it("handles Socket-style output errors once instead of crashing unhandled", () => {
    const onError = vi.fn();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const write = vi.spyOn(output, "write");
    const send = jsonLineSender(output, { onError });
    const failure = Object.assign(new Error("write ENOBUFS"), {
      code: "ENOBUFS",
    });

    output.emit("error", failure);
    output.emit("error", failure);
    send(notification(1));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(write).not.toHaveBeenCalled();
    output.destroy();
  });

  it("coalesces obsolete snapshots while a large output transport is stalled", async () => {
    const chunks: string[] = [];
    const callbacks: ((error?: Error | null) => void)[] = [];
    const onError = vi.fn();
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString("utf8"));
        callbacks.push(callback);
      },
    });
    const sample = snapshotNotification(0);
    const lineBytes = Buffer.byteLength(`${JSON.stringify(sample)}\n`);
    const send = jsonLineSender(output, {
      maxBufferedBytes: lineBytes * 3,
      coalesceKey(message) {
        return "method" in message && message.method === "fixture/snapshot"
          ? "agent-tree:thread-1:turn-1"
          : undefined;
      },
      onError,
    });

    send(sample);
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      send(snapshotNotification(sequence));
    }
    send(notification(101));

    expect(onError).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);

    callbacks.shift()?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(JSON.parse(chunks[1]!)).toMatchObject({
      method: "fixture/snapshot",
      params: { sequence: 100 },
    });

    callbacks.shift()?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(JSON.parse(chunks[2]!)).toMatchObject({
      method: "fixture/event",
      params: { sequence: 101 },
    });

    callbacks.shift()?.();
    output.destroy();
  });

  it("finishes the in-flight JSON frame before reporting queue overflow", async () => {
    const callbacks: ((error?: Error | null) => void)[] = [];
    const onError = vi.fn();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callbacks.push(callback);
      },
    });
    const sample = notification(1);
    const lineBytes = Buffer.byteLength(`${JSON.stringify(sample)}\n`);
    const send = jsonLineSender(output, {
      maxBufferedBytes: lineBytes * 2,
      onError,
    });

    send(sample);
    send(notification(2));
    send(notification(3));

    expect(onError).not.toHaveBeenCalled();
    callbacks.shift()?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("buffered bytes"),
    });
    output.destroy();
  });

  it("delivers lifecycle completion after many scripted deltas stall stdout", async () => {
    const chunks: string[] = [];
    const callbacks: ((error?: Error | null) => void)[] = [];
    const rawMessages: JsonRpcOutgoing[] = [];
    const onError = vi.fn();
    const completed = Promise.withResolvers<void>();
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString("utf8"));
        callbacks.push(callback);
      },
    });
    const sendLine = jsonLineSender(output, {
      maxBufferedBytes: 512 * 1024,
      coalesceKey: appServerOutputCoalesceKey,
      onError,
    });
    let modelStep = 0;
    const provider: ModelProvider = {
      async generate(_request, options) {
        modelStep += 1;
        for (let index = 0; index < 6_000; index += 1) {
          options?.onEvent?.({ type: "output_text.delta", delta: "x" });
        }
        return modelStep === 1
          ? {
              text: "x".repeat(6_000),
              toolCalls: [{ id: "noop-1", name: "noop", arguments: {} }],
            }
          : { text: "done", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({
        name: "scripted",
        instructions: "Exercise transport backpressure",
        tools: [
          defineTool({
            name: "noop",
            description: "Return a fixed value",
            mutability: "read",
            parameters: { type: "object" },
            async execute() {
              return "ok";
            },
          }),
        ],
      }),
      send(message) {
        rawMessages.push(message);
        sendLine(message);
        if ("method" in message && message.method === "turn/completed") {
          completed.resolve();
        }
      },
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = (
      rawMessages.find((message) => "id" in message && message.id === 2) as {
        result: { threadId: string };
      }
    ).result.threadId;
    await server.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { threadId, input: "stream" },
    });
    await completed.promise;

    for (let index = 0; index < 100; index += 1) {
      if (
        chunks.some(
          (chunk) =>
            (JSON.parse(chunk) as { method?: string }).method ===
            "turn/completed",
        )
      ) {
        break;
      }
      callbacks.shift()?.();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }

    expect(onError).not.toHaveBeenCalled();
    const delivered = chunks.map(
      (chunk) => JSON.parse(chunk) as JsonRpcOutgoing,
    );
    const lifecycle = delivered.flatMap((message) => {
      if (!("method" in message)) return [];
      if (message.method === "turn/completed") return [message.method];
      if (message.method !== "agent/event") return [];
      const event = (message.params as { event?: { type?: string } }).event;
      return event?.type && event.type !== "model.output_text.delta"
        ? [event.type]
        : [];
    });
    expect(lifecycle).toEqual(
      expect.arrayContaining([
        "model.completed",
        "tool.started",
        "tool.completed",
        "turn/completed",
      ]),
    );
    expect(lifecycle.at(-1)).toBe("turn/completed");

    callbacks.shift()?.();
    output.destroy();
    await server.dispose();
  });
});

function notification(sequence: number): JsonRpcOutgoing {
  return {
    jsonrpc: "2.0",
    method: "fixture/event",
    params: { sequence },
  };
}

function snapshotNotification(sequence: number): JsonRpcOutgoing {
  return {
    jsonrpc: "2.0",
    method: "fixture/snapshot",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      sequence,
      transcript: "x".repeat(128 * 1024),
    },
  };
}
