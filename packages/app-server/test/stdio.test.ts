import { Writable } from "node:stream";

import type { JsonRpcOutgoing } from "@threadlight/protocol";
import { describe, expect, it, vi } from "vitest";

import { jsonLineSender } from "../src/stdio.js";

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

  it("fails safely when a stalled transport exceeds its bounded queue", () => {
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

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      message: expect.stringContaining("buffered bytes"),
    });

    callbacks.shift()?.();
    output.destroy();
  });
});

function notification(sequence: number): JsonRpcOutgoing {
  return {
    jsonrpc: "2.0",
    method: "fixture/event",
    params: { sequence },
  };
}
