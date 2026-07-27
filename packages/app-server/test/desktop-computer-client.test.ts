import { Duplex } from "node:stream";

import { describe, expect, it } from "vitest";

import { DesktopComputerClient } from "../src/desktop-computer-client.js";

interface ComputerRequest {
  id: number;
  method: string;
  params: unknown;
}

class ScriptedComputerTransport extends Duplex {
  readonly requests: ComputerRequest[] = [];

  override _read(): void {}

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const request = JSON.parse(chunk.toString("utf8")) as ComputerRequest;
    this.requests.push(request);
    callback();
    queueMicrotask(() => {
      this.push(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "computer/execute"
              ? { screenshot: "iVBORw==" }
              : {
                  mode:
                    request.method === "computer/clear"
                      ? "none"
                      : "applications",
                  targets: [],
                  pictureInPicture: false,
                  canvas: { width: 1440, height: 900 },
                  inputMode: "virtual",
                },
        })}\n`,
      );
    });
  }
}

describe("DesktopComputerClient", () => {
  it("clears only the run that still owns the shared computer session", async () => {
    const transport = new ScriptedComputerTransport();
    const client = new DesktopComputerClient(transport);
    const signal = new AbortController().signal;

    await client.configure(
      {
        mode: "applications",
        targetIds: ["application:42"],
        pictureInPicture: true,
        inputMode: "virtual",
      },
      { runId: "run-1", scopeId: "thread-1", signal },
    );

    await expect(client.clearForRun("other-run")).resolves.toBe(false);
    expect(transport.requests.map((request) => request.method)).toEqual([
      "computer/configure",
    ]);

    await expect(client.clearForRun("run-1")).resolves.toBe(true);
    expect(transport.requests.map((request) => request.method)).toEqual([
      "computer/configure",
      "computer/clear",
    ]);

    await client.configure(
      {
        mode: "applications",
        targetIds: ["application:42"],
        pictureInPicture: true,
        inputMode: "virtual",
      },
      { runId: "run-2", scopeId: "thread-2", signal },
    );
    await client.execute(
      [{ type: "screenshot" }],
      { runId: "run-3", scopeId: "thread-3", signal },
    );

    await expect(client.clearForRun("run-2")).resolves.toBe(false);
    await expect(client.clearForRun("run-3")).resolves.toBe(true);
    expect(transport.requests.map((request) => request.method)).toEqual([
      "computer/configure",
      "computer/clear",
      "computer/configure",
      "computer/execute",
      "computer/clear",
    ]);

    client.dispose();
  });

  it("sends task ownership with every computer request", async () => {
    const transport = new ScriptedComputerTransport();
    const client = new DesktopComputerClient(transport);
    const context = {
      runId: "run-1",
      scopeId: "thread-1",
      signal: new AbortController().signal,
    };

    await client.list(context);
    await client.execute([{ type: "screenshot" }], context);
    await client.clear(context);

    expect(transport.requests.map((request) => request.params)).toEqual([
      { runId: "run-1", threadId: "thread-1" },
      {
        actions: [{ type: "screenshot" }],
        runId: "run-1",
        threadId: "thread-1",
      },
      { runId: "run-1", threadId: "thread-1" },
    ]);

    client.dispose();
  });
});
