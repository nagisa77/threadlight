import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { AppServer } from "./app-server.js";
import type { JsonRpcRequest, SendMessage } from "./protocol.js";

export function jsonLineSender(output: Writable): SendMessage {
  return (message) => {
    output.write(`${JSON.stringify(message)}\n`);
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
