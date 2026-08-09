import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { AppServer } from "./app-server.js";
import type { JsonRpcRequest, SendMessage } from "./protocol.js";

const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

export interface JsonLineSenderOptions {
  maxBufferedBytes?: number;
  onError?(error: Error): void;
}

export function jsonLineSender(
  output: Writable,
  options: JsonLineSenderOptions = {},
): SendMessage {
  const maxBufferedBytes =
    options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new Error("maxBufferedBytes must be a positive safe integer");
  }

  const pending: { line: string; bytes: number }[] = [];
  let bufferedBytes = 0;
  let writing = false;
  let failed = false;

  const fail = (value: unknown) => {
    if (failed) return;
    failed = true;
    pending.length = 0;
    bufferedBytes = 0;
    options.onError?.(asError(value));
  };

  const flush = () => {
    if (failed || writing || pending.length === 0) return;
    if (output.destroyed || output.writableEnded) {
      fail(new Error("JSON line output is closed"));
      return;
    }

    const current = pending.shift()!;
    writing = true;
    try {
      output.write(current.line, (error) => {
        writing = false;
        if (failed) return;
        bufferedBytes -= current.bytes;
        if (error) {
          fail(error);
          return;
        }
        queueMicrotask(flush);
      });
    } catch (error) {
      writing = false;
      bufferedBytes -= current.bytes;
      fail(error);
    }
  };

  output.on("error", fail);

  return (message) => {
    if (failed) return;
    const line = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(line);
    if (bufferedBytes + bytes > maxBufferedBytes) {
      fail(
        new Error(
          `JSON line output exceeded ${maxBufferedBytes} buffered bytes`,
        ),
      );
      return;
    }
    pending.push({ line, bytes });
    bufferedBytes += bytes;
    flush();
  };
}

export function serveJsonLines(
  server: AppServer,
  input: Readable,
  onParseError: (error: unknown) => void = () => undefined,
): () => void {
  const lines = createInterface({ input });

  lines.on("line", (line) => {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      void server.receive(request);
    } catch (error) {
      onParseError(error);
    }
  });

  return () => lines.close();
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
