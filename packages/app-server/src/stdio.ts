import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { AppServer } from "./app-server.js";
import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
  SendMessage,
} from "./protocol.js";

const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024 * 1024;

export interface JsonLineSenderOptions {
  maxBufferedBytes?: number;
  /** Replace an older queued snapshot with the latest one for the same key. */
  coalesceKey?(message: JsonRpcOutgoing): string | undefined;
  onError?(error: Error): void;
}

interface PendingJsonLine {
  line: string;
  bytes: number;
  coalesceKey?: string;
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

  const pending: PendingJsonLine[] = [];
  const coalescible = new Map<string, PendingJsonLine>();
  let bufferedBytes = 0;
  let writing = false;
  let failed = false;
  let failure: Error | undefined;
  let failureNotified = false;
  let current: PendingJsonLine | undefined;

  const notifyFailure = () => {
    if (failureNotified || !failure) return;
    failureNotified = true;
    options.onError?.(failure);
  };

  const fail = (value: unknown, afterCurrentWrite = false) => {
    if (failed) return;
    failed = true;
    failure = asError(value);
    pending.length = 0;
    coalescible.clear();
    bufferedBytes = current?.bytes ?? 0;
    if (!afterCurrentWrite || !writing) notifyFailure();
  };

  const flush = () => {
    if (failed || writing || pending.length === 0) return;
    if (output.destroyed || output.writableEnded) {
      fail(new Error("JSON line output is closed"));
      return;
    }

    current = pending.shift()!;
    if (current.coalesceKey) coalescible.delete(current.coalesceKey);
    writing = true;
    try {
      output.write(current.line, (error) => {
        const completed = current;
        current = undefined;
        writing = false;
        bufferedBytes -= completed?.bytes ?? 0;
        if (failed) {
          notifyFailure();
          return;
        }
        if (error) {
          fail(error);
          return;
        }
        queueMicrotask(flush);
      });
    } catch (error) {
      const completed = current;
      current = undefined;
      writing = false;
      bufferedBytes -= completed?.bytes ?? 0;
      fail(error);
    }
  };

  output.on("error", fail);

  return (message) => {
    if (failed) return;
    const line = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(line);
    const coalesceKey = options.coalesceKey?.(message);
    if (coalesceKey) {
      const previous = coalescible.get(coalesceKey);
      if (previous) {
        const index = pending.indexOf(previous);
        if (index >= 0) pending.splice(index, 1);
        bufferedBytes -= previous.bytes;
        coalescible.delete(coalesceKey);
      }
    }
    if (bufferedBytes + bytes > maxBufferedBytes) {
      fail(
        new Error(
          `JSON line output exceeded ${maxBufferedBytes} buffered bytes`,
        ),
        true,
      );
      return;
    }
    const item: PendingJsonLine = {
      line,
      bytes,
      ...(coalesceKey ? { coalesceKey } : {}),
    };
    pending.push(item);
    if (coalesceKey) coalescible.set(coalesceKey, item);
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
